import path from "node:path";
import type { NextConfig } from "next";
import { SECURITY_HEADERS, VIEW_AS_HEADERS } from "./src/lib/security/response-headers";

// Set by open-next.config.ts `buildCommand` for the Cloudflare Workers build only.
// That build swaps the image engine (sharp cannot load in workerd) so the Worker
// bundle never contains sharp; the plain `next build` keeps the Node module.
const WORKERS_BUILD = process.env.ALADDIN_BUILD_TARGET === "workers";
const IMAGE_RUNTIME = /[\\/]server[\\/]storage[\\/]image-processing[\\/]runtime\.ts$/;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Revocable media must never enter the optimizer cache, even through a crafted URL.
  images: { qualities: [65, 75], localPatterns: ["assets", "brand", "demo", "images", "installer-auth", "landing-brand", "landing-v2", "preview", "_next/static/media"]
    .map((directory) => ({ pathname: `/${directory}/**`, search: "" })) },
  // App Router is the default in Next 15. No Vite, no custom SPA routing.
  webpack(config, { webpack, isServer }) {
    if (WORKERS_BUILD && config.cache && typeof config.cache === "object") {
      // A separate persistent cache: otherwise a later Node build on the same
      // machine reuses the swapped module graph (and would ship without sharp).
      config.cache.name = `${config.cache.name ?? `${config.name}-${config.mode}`}-workers`;
    }
    if (WORKERS_BUILD && isServer) {
      const workersRuntime = path.join(__dirname, "src/server/storage/image-processing/runtime.workers.ts");
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(IMAGE_RUNTIME, (resource: { createData?: { resource?: string } }) => {
        if (resource.createData?.resource) resource.createData.resource = workersRuntime;
      }));
    }
    return config;
  },

  // Baseline security headers on every response (security audit 2026-10-22).
  async headers() {
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      // Admin View-As: private account data, never cached, indexed or referred (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §9).
      { source: "/admin/users/:id/view/:path*", headers: [...VIEW_AS_HEADERS] },
      { source: "/admin/users/:id/view", headers: [...VIEW_AS_HEADERS] },
    ];
  },

  // Compatibility for links to routes that moved: permanent (308) redirects to the promoted routes.
  // The query string is carried over by Next.js as-is; the destination pages
  // validate anything they read from it (e.g. `next` via sanitizeNext).
  // The retired phone entry pages (`/installer/*`, `/showroom/sign-in|sign-up`, `/temporary/craftsman/*`,
  // ADR-0025) have no redirect any more. all of them answer 404 (the two /showroom ones through route handlers, so the dynamic /showroom/[page] guard never sees them).
  async redirects() {
    return [
      // Showroom V2 was reviewed under /preview/showroom-suite-v2; it now lives at /showroom (links stay valid).
      { source: "/preview/showroom-suite-v2", destination: "/showroom", permanent: true },
      { source: "/preview/showroom-suite-v2/:path*", destination: "/showroom/:path*", permanent: true },
      // The Admin dashboard was reviewed under /admin/preview; it now owns the Admin routes.
      { source: "/admin/preview", destination: "/admin", permanent: true },
      { source: "/admin/preview/:path*", destination: "/admin/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
