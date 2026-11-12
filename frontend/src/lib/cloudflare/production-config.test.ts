import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import {
  checkBackend,
  checkCutoverStage,
  checkMediaMode,
  checkVersionMatchesLive,
  effectiveMediaFlags,
  fetchLiveMediaFlags,
  fetchVersionMediaFlags,
  mediaFlagsFromBindings,
  MEDIA_MODES,
  mediaModeArgs,
  R2_ONLY_FLAGS,
  checkFrontend,
  checkLiveValues,
  jwtProjectRef,
  LIVE_SUPABASE_URL,
  parseJsonc,
} from "../../../scripts/check-cloudflare-production.mjs";

const FRONTEND = join(__dirname, "..", "..", "..");
const frontendConfig = () => parseJsonc(readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8"));
const backendConfig = () => parseJsonc(readFileSync(join(FRONTEND, "..", "edge", "backend-worker", "wrangler.jsonc"), "utf8"));

// Unsigned JWT-shaped keys: only the payload's `ref` matters to the guard.
const keyFor = (ref: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ ref, role: "anon" })).toString("base64url")}.sig`;
const live = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: keyFor("kkpkgjrweysgvhvkhzun"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAFE_live",
};

describe("Cloudflare production config (committed Wrangler files)", () => {
  it("passes for the frontend and backend production environments", () => {
    expect(checkFrontend(frontendConfig())).toEqual([]);
    expect(checkBackend(backendConfig())).toEqual([]);
  });

  it("binds the production backend, so /api/backend never answers 503", () => {
    const services = frontendConfig().env.production.services;
    expect(services).toContainEqual({ binding: "BACKEND", service: "aladdin-backend-production" });
  });

  it("reaches the WhatsApp delivery Worker only through its own environment's private service binding", () => {
    const config = frontendConfig() as unknown as { env: { production: { services: { binding: string; service: string }[] }; preview: { services: { binding: string; service: string }[] } } };
    expect(config.env.production.services).toContainEqual({ binding: "OTP_WORKER", service: "aladdin-whatsapp-otp-production" });
    expect(config.env.preview.services).toContainEqual({ binding: "OTP_WORKER", service: "aladdin-whatsapp-otp-preview" });
    expect(config.env.production.services.filter((s) => s.binding === "OTP_WORKER")).toHaveLength(1);
    expect(config.env.preview.services.filter((s) => s.binding === "OTP_WORKER")).toHaveLength(1);
  });

  it("refuses a frontend with no BACKEND binding", () => {
    const config = frontendConfig();
    config.env.production.services = config.env.production.services.filter((s) => s.binding !== "BACKEND");
    expect(checkFrontend(config)).toContain("frontend production: BACKEND must bind aladdin-backend-production");
  });

  it("requires R2-only media: R2 on, production writes approved and Supabase Storage writes closed", () => {
    const vars = frontendConfig().env.production.vars;
    expect(vars.R2_STORAGE_ENABLED).toBe("true");
    expect(vars.R2_PRODUCTION_WRITES_APPROVED).toBe("true");
    expect(vars.MEDIA_LEGACY_STORAGE_WRITES).toBe("false");
    for (const [flag, bad] of [["R2_STORAGE_ENABLED", "false"], ["R2_PRODUCTION_WRITES_APPROVED", "false"], ["MEDIA_LEGACY_STORAGE_WRITES", "true"]] as const) {
      const config = frontendConfig();
      config.env.production.vars[flag] = bad;
      expect(checkFrontend(config).some((p) => p.includes(flag))).toBe(true);
    }
    const config = frontendConfig();
    delete config.env.production.vars.MEDIA_LEGACY_STORAGE_WRITES;
    expect(checkFrontend(config).some((p) => p.includes("MEDIA_LEGACY_STORAGE_WRITES"))).toBe(true);
  });

  it("refuses an immediate deploy until the owner's cutover approval is recorded", () => {
    expect(checkCutoverStage("frontend", undefined)).toHaveLength(1);
    expect(checkCutoverStage("frontend", "false")).toHaveLength(1);
    expect(checkCutoverStage("frontend", "true")).toEqual([]);
    for (const stage of ["check", "backend", "frontend-upload", undefined]) expect(checkCutoverStage(stage, undefined)).toEqual([]);
  });

  it("refuses a public address, an acceptance resource or Redis switched on", () => {
    const config = frontendConfig();
    config.env.production.workers_dev = true;
    config.env.production.vars.R2_PRIVATE_BUCKET = "aladdin-r2-acceptance-20261011-private";
    config.env.production.vars.REDIS_CACHE_ENABLED = "true";
    const problems = checkFrontend(config);
    expect(problems.some((p) => p.includes("workers_dev"))).toBe(true);
    expect(problems.some((p) => p.includes("acceptance"))).toBe(true);
    expect(problems.some((p) => p.includes("REDIS_CACHE_ENABLED"))).toBe(true);
  });

  it("refuses Turnstile hostnames outside the live domain", () => {
    const config = frontendConfig();
    config.env.production.vars.TURNSTILE_ALLOWED_HOSTNAMES = "aladdindecore.com,www.aladdindecore.com,evil.example";
    expect(checkFrontend(config)).toContain("frontend production: Turnstile hostname outside aladdindecore.com: evil.example");
  });

  it("refuses a backend production pointing at the acceptance project", () => {
    const config = backendConfig();
    config.env.production.vars.SUPABASE_URL = "https://nxossqhdfltcqdwvbewi.supabase.co";
    const problems = checkBackend(config);
    expect(problems.some((p) => p.includes("nxossqhdfltcqdwvbewi"))).toBe(true);
    expect(problems.some((p) => p.includes("SUPABASE_URL is a secret"))).toBe(true);
  });
});

describe("Production build values", () => {
  it("accept the live project only", () => {
    expect(checkLiveValues(live)).toEqual([]);
  });

  it("refuse the acceptance project's URL and anon key", () => {
    const problems = checkLiveValues({
      ...live,
      NEXT_PUBLIC_SUPABASE_URL: "https://nxossqhdfltcqdwvbewi.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: keyFor("nxossqhdfltcqdwvbewi"),
    });
    expect(problems).toContain(`NEXT_PUBLIC_SUPABASE_URL must be exactly ${LIVE_SUPABASE_URL}`);
    expect(problems).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to another Supabase project");
  });

  it("refuse a secret key, a missing value or a Cloudflare test site key", () => {
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" })).toHaveLength(1);
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_APP_ENV: "staging" })).toContain("NEXT_PUBLIC_APP_ENV must be production");
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }))
      .toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key");
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined })).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");
  });

  it("read the project ref from a legacy anon key and ignore other key formats", () => {
    expect(jwtProjectRef(keyFor("kkpkgjrweysgvhvkhzun"))).toBe("kkpkgjrweysgvhvkhzun");
    expect(jwtProjectRef("sb_publishable_abc")).toBeNull();
  });
});

const run = promisify(execFile);
const LIVE_FLAGS = { R2_STORAGE_ENABLED: "true", R2_PRODUCTION_WRITES_APPROVED: "true", MEDIA_LEGACY_STORAGE_WRITES: "false" };
const bindingsFor = (flags: Record<string, string | undefined>) =>
  [
    { name: "NEXT_PUBLIC_APP_ENV", type: "plain_text", text: "production" },
    ...Object.entries(flags).filter(([, v]) => v !== undefined).map(([name, text]) => ({ name, type: "plain_text", text })),
    { name: "SUPABASE_SERVICE_ROLE_KEY", type: "secret_text" },
  ];

/** A local stand-in for the Cloudflare Workers API (deployments + version detail), so the CLI and the sourced helper run for real. */
function cloudflareStandIn() {
  const state = {
    status: 200,
    deployments: [{ versions: [{ version_id: "11111111-1111-4111-8111-111111111111", percentage: 100 }] }] as unknown[],
    versions: {
      "11111111-1111-4111-8111-111111111111": LIVE_FLAGS,
      "22222222-2222-4222-8222-222222222222": LIVE_FLAGS,
    } as Record<string, Record<string, string | undefined>>,
    seenAuth: [] as (string | undefined)[],
  };
  let server: Server;
  const start = () =>
    new Promise<string>((resolve) => {
      server = createServer((req, res) => {
        state.seenAuth.push(req.headers.authorization);
        const send = (code: number, body: unknown) => {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (state.status !== 200) return send(state.status, { success: false });
        const url = req.url ?? "";
        if (/\/workers\/scripts\/aladdin-frontend-production\/deployments$/.test(url)) return send(200, { success: true, result: { deployments: state.deployments } });
        const m = /\/workers\/scripts\/aladdin-frontend-production\/versions\/([0-9a-f-]+)$/.exec(url);
        if (m && state.versions[m[1]!]) return send(200, { success: true, result: { resources: { bindings: bindingsFor(state.versions[m[1]!]!) } } });
        return send(404, { success: false });
      }).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    });
  return { state, start, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("Production release media modes (match-live is fail-closed and never reopens Supabase Storage writes)", () => {
  const workflow = () => readFileSync(join(FRONTEND, "..", ".github", "workflows", "cloudflare-production.yml"), "utf8");
  const standIn = cloudflareStandIn();
  let base = "";
  beforeAll(async () => {
    base = await standIn.start();
  });
  afterAll(async () => {
    await standIn.stop();
  });
  const reset = () => {
    standIn.state.status = 200;
    standIn.state.deployments = [{ versions: [{ version_id: "11111111-1111-4111-8111-111111111111", percentage: 100 }] }];
    standIn.state.versions["11111111-1111-4111-8111-111111111111"] = LIVE_FLAGS;
    standIn.state.versions["22222222-2222-4222-8222-222222222222"] = LIVE_FLAGS;
    standIn.state.seenAuth.length = 0;
  };
  const params = () => ({ accountId: "acct", token: "tok", worker: "aladdin-frontend-production", base });
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_API_TOKEN: "tok",
    CLOUDFLARE_API_BASE: base,
    ...extra,
  });
  const guard = (args: string[], e: NodeJS.ProcessEnv) =>
    run("node", [join(FRONTEND, "scripts", "check-cloudflare-production.mjs"), ...args], { encoding: "utf8", env: e }).then(
      (r) => ({ status: 0, stdout: r.stdout, stderr: r.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({ status: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }),
    );

  it("there is no legacy-hold mode: the only modes are match-live and r2-only, and the committed config is R2-only", () => {
    expect(MEDIA_MODES).toEqual(["match-live", "r2-only"]);
    expect(checkMediaMode(frontendConfig(), "legacy-hold", LIVE_FLAGS)[0]).toMatch(/media_mode must be one of match-live, r2-only/);
    expect(() => mediaModeArgs("legacy-hold")).toThrow(/unknown media mode/);
    const committed = frontendConfig().env.production.vars;
    for (const [flag, want] of Object.entries(R2_ONLY_FLAGS)) expect(committed[flag]).toBe(want);
    expect(checkFrontend(frontendConfig())).toEqual([]);
  });

  it("match-live carries exactly the live flags as --var pairs; r2-only adds none", () => {
    expect(mediaModeArgs("match-live", LIVE_FLAGS)).toEqual([
      "--var", "R2_STORAGE_ENABLED:true", "--var", "R2_PRODUCTION_WRITES_APPROVED:true", "--var", "MEDIA_LEGACY_STORAGE_WRITES:false",
    ]);
    expect(effectiveMediaFlags(frontendConfig(), "match-live", LIVE_FLAGS)).toEqual(LIVE_FLAGS);
    expect(checkMediaMode(frontendConfig(), "match-live", LIVE_FLAGS)).toEqual([]);
    expect(mediaModeArgs("r2-only")).toEqual([]);
    expect(checkMediaMode(frontendConfig(), "r2-only")).toEqual([]);
    expect(() => mediaModeArgs("match-live")).toThrow(/needs the live/);
  });

  it("match-live without readable live flags is refused, and NO mode may carry legacy storage writes", () => {
    expect(checkMediaMode(frontendConfig(), "match-live", undefined)[0]).toMatch(/could not be read/);
    const reopened = { ...LIVE_FLAGS, MEDIA_LEGACY_STORAGE_WRITES: "true" };
    expect(checkMediaMode(frontendConfig(), "match-live", reopened).join()).toMatch(/never reopens Supabase Storage writes/);
    const tampered = frontendConfig();
    tampered.env.production.vars.MEDIA_LEGACY_STORAGE_WRITES = "true";
    expect(checkMediaMode(tampered, "r2-only").join()).toMatch(/never reopens Supabase Storage writes/);
    tampered.env.production.vars.R2_STORAGE_ENABLED = "false";
    expect(checkMediaMode(tampered, "r2-only").join()).toMatch(/R2_STORAGE_ENABLED would be "false"/);
  });

  it("reads the media flags out of plain-text bindings only", () => {
    expect(mediaFlagsFromBindings(bindingsFor(LIVE_FLAGS))).toEqual(LIVE_FLAGS);
    expect(mediaFlagsFromBindings([{ name: "R2_STORAGE_ENABLED", type: "secret_text", text: "true" }])).toEqual({ R2_STORAGE_ENABLED: undefined, R2_PRODUCTION_WRITES_APPROVED: undefined, MEDIA_LEGACY_STORAGE_WRITES: undefined });
    expect(mediaFlagsFromBindings(undefined).R2_STORAGE_ENABLED).toBeUndefined();
  });

  it("fetchLiveMediaFlags reads the active deployment's version and sends the bearer token", async () => {
    reset();
    const live = await fetchLiveMediaFlags(params());
    expect(live).toEqual({ flags: LIVE_FLAGS, versionIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(standIn.state.seenAuth.every((h) => h === "Bearer tok")).toBe(true);
  });

  it("fetchLiveMediaFlags fails closed: no credentials, API error, no active version, a missing flag, or versions that disagree", async () => {
    reset();
    await expect(fetchLiveMediaFlags({ ...params(), token: "" })).rejects.toThrow(/required/);
    standIn.state.status = 500;
    await expect(fetchLiveMediaFlags(params())).rejects.toThrow(/HTTP 500/);
    reset();
    standIn.state.deployments = [];
    await expect(fetchLiveMediaFlags(params())).rejects.toThrow(/no active deployment/);
    standIn.state.deployments = [{ versions: [{ version_id: "11111111-1111-4111-8111-111111111111", percentage: 0 }] }];
    await expect(fetchLiveMediaFlags(params())).rejects.toThrow(/no active deployment/);
    reset();
    standIn.state.versions["11111111-1111-4111-8111-111111111111"] = { R2_STORAGE_ENABLED: "true", R2_PRODUCTION_WRITES_APPROVED: "true" };
    await expect(fetchLiveMediaFlags(params())).rejects.toThrow(/does not carry MEDIA_LEGACY_STORAGE_WRITES/);
    reset();
    standIn.state.deployments = [{ versions: [
      { version_id: "11111111-1111-4111-8111-111111111111", percentage: 50 },
      { version_id: "22222222-2222-4222-8222-222222222222", percentage: 50 },
    ] }];
    standIn.state.versions["22222222-2222-4222-8222-222222222222"] = { ...LIVE_FLAGS, MEDIA_LEGACY_STORAGE_WRITES: "true" };
    await expect(fetchLiveMediaFlags(params())).rejects.toThrow(/disagree on MEDIA_LEGACY_STORAGE_WRITES/);
    // A gradual rollout whose versions agree is fine.
    standIn.state.versions["22222222-2222-4222-8222-222222222222"] = LIVE_FLAGS;
    expect((await fetchLiveMediaFlags(params())).versionIds).toHaveLength(2);
  });

  it("an uploaded version must equal the live flags (and never carry legacy writes)", async () => {
    reset();
    expect(checkVersionMatchesLive(LIVE_FLAGS, LIVE_FLAGS)).toEqual([]);
    expect(checkVersionMatchesLive({ ...LIVE_FLAGS, R2_STORAGE_ENABLED: "false" }, LIVE_FLAGS).join()).toMatch(/R2_STORAGE_ENABLED/);
    expect(checkVersionMatchesLive({ ...LIVE_FLAGS, MEDIA_LEGACY_STORAGE_WRITES: undefined }, LIVE_FLAGS).join()).toMatch(/MEDIA_LEGACY_STORAGE_WRITES/);
    expect(await fetchVersionMediaFlags({ ...params(), versionId: "22222222-2222-4222-8222-222222222222" })).toEqual(LIVE_FLAGS);
  });

  it("the CLI: --verify-version passes for a matching version and fails for a reverted or unreadable one", async () => {
    reset();
    const ok = await guard(["--verify-version", "22222222-2222-4222-8222-222222222222"], env());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/carries the live media flags/);
    standIn.state.versions["22222222-2222-4222-8222-222222222222"] = { R2_STORAGE_ENABLED: "false", R2_PRODUCTION_WRITES_APPROVED: "false", MEDIA_LEGACY_STORAGE_WRITES: "true" };
    const reverted = await guard(["--verify-version", "22222222-2222-4222-8222-222222222222"], env());
    expect(reverted.status).toBe(1);
    expect(reverted.stderr).toMatch(/R2_STORAGE_ENABLED is "false" on the version but "true" on the live Worker/);
    expect(reverted.stderr).toMatch(/MEDIA_LEGACY_STORAGE_WRITES is "true" on the version/);
    const unknown = await guard(["--verify-version", "33333333-3333-4333-8333-333333333333"], env());
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/cannot read version/);
    reset();
    expect((await guard(["--verify-version", "22222222-2222-4222-8222-222222222222"], env({ CLOUDFLARE_API_TOKEN: "" }))).status).toBe(1);
  });

  it("the CLI: match-live prints the live flags as wrangler arguments and fails closed when the live Worker cannot be read", async () => {
    reset();
    const ok = await guard(["--media-var-args", "match-live"], env({ STAGE: "frontend-upload" }));
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim().split("\n")).toEqual(["--var", "R2_STORAGE_ENABLED:true", "--var", "R2_PRODUCTION_WRITES_APPROVED:true", "--var", "MEDIA_LEGACY_STORAGE_WRITES:false"]);
    standIn.state.status = 503;
    const down = await guard(["--media-var-args", "match-live"], env({ STAGE: "frontend-upload" }));
    expect(down.status).toBe(1);
    expect(down.stdout).toBe("");
    expect(down.stderr).toMatch(/cannot read the live Worker/);
    reset();
    standIn.state.versions["11111111-1111-4111-8111-111111111111"] = { ...LIVE_FLAGS, MEDIA_LEGACY_STORAGE_WRITES: "true" };
    const legacyLive = await guard(["--media-var-args", "match-live"], env({ STAGE: "frontend-upload" }));
    expect(legacyLive.status).toBe(1);
    expect(legacyLive.stderr).toMatch(/never reopens Supabase Storage writes/);
  });

  it("the workflow defaults to match-live, drops legacy-hold, reads the live version in every step that builds, and verifies the upload", () => {
    const text = workflow();
    expect(text).toMatch(/media_mode:[\s\S]*?options: \[match-live, r2-only\][\s\S]*?default: match-live/);
    expect(text).not.toMatch(/options: \[[^\]]*legacy-hold/);
    expect(text).not.toContain("MEDIA_LEGACY_STORAGE_WRITES:true");
    expect(text).toContain('--verify-media-mode "$MEDIA_MODE"');
    expect(text).toContain('--verify-version "$version_id"');
    const blocks = text.split("- name:").filter((block) => /working-directory: frontend\b/.test(block) && /wrangler (deploy|versions upload)/.test(block));
    // frontend dry run, upload and deploy
    expect(blocks.length).toBe(3);
    for (const block of blocks) {
      expect(block).toContain("source ../frontend/scripts/production-media-vars.sh");
      expect(block).toContain('"${MEDIA_VARS[@]}"');
      expect(block).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    }
    const releaseFlags = text.split("- name:").find((block) => block.startsWith(" Release flags"))!;
    expect(releaseFlags).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    // The API base override is for tests only: the workflow must never set it.
    expect(text).not.toContain("CLOUDFLARE_API_BASE");
  });

  it("the sourced helper yields 6 args for match-live, 0 for r2-only, and stops (no args) when the live Worker cannot be read or the mode is unknown", async () => {
    reset();
    const source = (mode: string, e: NodeJS.ProcessEnv) =>
      run("bash", ["-e", "-c", `cd "${join(FRONTEND, "scripts")}" && export MEDIA_MODE=${mode} && source ./production-media-vars.sh && echo "n=\${#MEDIA_VARS[@]}"`], { encoding: "utf8", env: e }).then(
        (r) => ({ status: 0, stdout: r.stdout }),
        (error: { code?: number; stdout?: string }) => ({ status: error.code ?? 1, stdout: error.stdout ?? "" }),
      );
    const live = await source("match-live", env());
    expect(live.status).toBe(0);
    expect(live.stdout.trim()).toBe("n=6");
    const cutover = await source("r2-only", env());
    expect(cutover.status).toBe(0);
    expect(cutover.stdout.trim()).toBe("n=0");
    standIn.state.status = 500;
    const down = await source("match-live", env());
    expect(down.status).not.toBe(0);
    expect(down.stdout).not.toContain("n=");
    const noToken = await source("match-live", env({ CLOUDFLARE_API_TOKEN: "" }));
    expect(noToken.status).not.toBe(0);
    const bad = await source("legacy-hold", env());
    expect(bad.status).not.toBe(0);
    expect(bad.stdout).not.toContain("n=");
    reset();
  });

  it("the cutover approval reaches every guard invocation: it is job-level env, and an approved stage=frontend passes in both modes", async () => {
    reset();
    const text = workflow();
    const jobEnv = text.slice(text.indexOf("    env:\n      STAGE:"), text.indexOf("    steps:"));
    expect(jobEnv).toContain("R2_CUTOVER_APPROVED: ${{ vars.R2_CUTOVER_APPROVED }}");
    expect(text.match(/R2_CUTOVER_APPROVED: \$\{\{/g)?.length).toBe(1);
    for (const mode of MEDIA_MODES) {
      expect((await guard(["--verify-media-mode", mode], env({ STAGE: "frontend", R2_CUTOVER_APPROVED: "true" }))).status).toBe(0);
      expect((await guard(["--verify-media-mode", mode], env({ STAGE: "frontend", R2_CUTOVER_APPROVED: "" }))).status).toBe(1);
      expect((await guard(["--verify-media-mode", mode], env({ STAGE: "frontend-upload", R2_CUTOVER_APPROVED: "" }))).status).toBe(0);
    }
    const helper = (approved: string) =>
      spawnSync("bash", ["-e", "-c", `cd "${join(FRONTEND, "scripts")}" && export MEDIA_MODE=r2-only STAGE=frontend R2_CUTOVER_APPROVED=${approved} && source ./production-media-vars.sh && echo "n=\${#MEDIA_VARS[@]}"`], { encoding: "utf8" });
    expect(helper("true").stdout.trim()).toBe("n=0");
  });
});
