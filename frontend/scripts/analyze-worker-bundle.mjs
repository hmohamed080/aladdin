#!/usr/bin/env node
// Where do the bytes of the Cloudflare Worker bundle come from?
//
// Usage: node scripts/analyze-worker-bundle.mjs <bundle.js> [--metafile meta.json] [--top 25]
//
// Two sources, because OpenNext pre-bundles the server handler, so wrangler's own metafile sees it as ONE input:
//   1. the esbuild metafile (wrangler deploy --dry-run --metafile): bytes per input file that wrangler itself bundled;
//   2. banner comments (`// path/to/file.js`) that esbuild leaves in an unminified bundle: bytes per original module,
//      attributed to an npm package or to an app area. A minified bundle has no banners; the report says so.
// Output: Markdown on stdout (CI appends it to the job summary). Nothing here changes the build.
import { readFileSync } from "node:fs";

const MIB = 1024 * 1024;
const fmt = (bytes) => (bytes >= MIB ? `${(bytes / MIB).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`);

/** `node_modules/.pnpm/pkg@1.2.3_peer/node_modules/@scope/pkg/dist/x.js` -> `@scope/pkg`; app files -> an area. */
export function groupOf(path) {
  const clean = path.replace(/\\/g, "/");
  const nm = clean.lastIndexOf("node_modules/");
  if (nm !== -1) {
    const rest = clean.slice(nm + "node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const app = /(?:^|\/)src\/app\/(.+)$/.exec(clean);
  if (app) {
    const segments = app[1].split("/").filter((s) => !s.startsWith("(") && !s.startsWith("["));
    return `app/${segments[0] ?? "(root)"}`;
  }
  const feature = /(?:^|\/)src\/features\/([^/]+)/.exec(clean);
  if (feature) return `features/${feature[1]}`;
  const src = /(?:^|\/)src\/([^/]+)/.exec(clean);
  if (src) return `src/${src[1]}`;
  return clean.startsWith(".next/") || clean.includes("/.next/") ? ".next (compiled routes)" : "other";
}

/** Bytes per banner-delimited module in an unminified esbuild bundle. */
export function bannerSizes(text) {
  const sizes = new Map();
  const banner = /^\/\/ ((?:[\w@.\-~+]+\/)+[\w@.\-~+]*\.[cm]?[jt]sx?)$/gm;
  let last = null;
  let match;
  while ((match = banner.exec(text))) {
    if (last) sizes.set(last.path, (sizes.get(last.path) ?? 0) + Buffer.byteLength(text.slice(last.at, match.index)));
    last = { path: match[1], at: match.index };
  }
  if (last) sizes.set(last.path, (sizes.get(last.path) ?? 0) + Buffer.byteLength(text.slice(last.at)));
  return sizes;
}

function table(title, entries, top, total) {
  const rows = [...entries].sort((a, b) => b[1] - a[1]).slice(0, top);
  const lines = [`### ${title}`, "", "| # | Source | Size | Share |", "|--:|---|--:|--:|"];
  rows.forEach(([name, bytes], i) => lines.push(`| ${i + 1} | \`${name}\` | ${fmt(bytes)} | ${((bytes / total) * 100).toFixed(1)}% |`));
  return lines.concat("").join("\n");
}

function aggregate(sizes) {
  const groups = new Map();
  for (const [path, bytes] of sizes) {
    const key = groupOf(path);
    groups.set(key, (groups.get(key) ?? 0) + bytes);
  }
  return groups;
}

export function report({ bundleText, metafile, top = 25 }) {
  const total = Buffer.byteLength(bundleText);
  const out = [`## Worker bundle analysis`, "", `Bundle size: **${fmt(total)}** (${total.toLocaleString("en-US")} bytes, uncompressed).`, ""];

  if (metafile) {
    const inputs = Object.entries(metafile.inputs ?? {}).map(([path, info]) => [path, info.bytes ?? 0]);
    const inputTotal = inputs.reduce((sum, [, bytes]) => sum + bytes, 0);
    out.push(table("Largest inputs seen by wrangler", inputs, Math.min(top, 10), inputTotal || 1));
  }

  const banners = bannerSizes(bundleText);
  const attributed = [...banners.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (banners.size < 50) {
    out.push("_The bundle has few or no `// path` banners (it is probably minified), so it cannot be split by package. Build unminified to get the breakdown below._", "");
  } else {
    out.push(`Attributed ${fmt(attributed)} (${((attributed / total) * 100).toFixed(1)}%) to ${banners.size.toLocaleString("en-US")} modules.`, "");
    out.push(table("By package or app area", aggregate(banners), top, total));
    out.push(table("Largest single modules", banners, top, total));
    const routes = [...banners].filter(([path]) => /src\/app\/.+\/(page|route)\.[jt]sx?$/.test(path));
    out.push(table("Route entry files (page.tsx / route.ts) - own code only, not what they import", routes, top, total));
  }
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("analyze-worker-bundle.mjs")) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const bundle = args.find((a) => !a.startsWith("--") && a !== flag("--metafile") && a !== flag("--top"));
  if (!bundle) {
    console.error("usage: analyze-worker-bundle.mjs <bundle.js> [--metafile meta.json] [--top 25]");
    process.exit(2);
  }
  const metaPath = flag("--metafile");
  console.log(report({ bundleText: readFileSync(bundle, "utf8"), metafile: metaPath ? JSON.parse(readFileSync(metaPath, "utf8")) : null, top: Number(flag("--top", "25")) }));
}
