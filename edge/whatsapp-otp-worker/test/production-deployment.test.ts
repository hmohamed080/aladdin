import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkBindings, checkConfigFile, checkDeployment, checkPrivacy, checkSchedules, checkSwitch, expectedBindings, parseJsonc, reachedWorker, run, SWITCH_SQL,
} from "../scripts/check-production-deployment.mjs";

const config = parseJsonc(readFileSync(fileURLToPath(new URL("../wrangler.production.jsonc", import.meta.url)), "utf8"));
const expected = expectedBindings(config);

/** A deployed view that matches the config exactly (shapes follow the Workers API). */
function goodView() {
  const bindings: Record<string, unknown>[] = [];
  for (const [name, w] of Object.entries(expected) as [string, any][]) {
    if (w.kind === "var") bindings.push({ name, type: "plain_text", text: w.text });
    else if (w.kind === "service") bindings.push({ name, type: "service", service: w.service, environment: "production" });
    else if (w.kind === "secret") bindings.push({ name, type: "secrets_store_secret", store_id: w.store_id, secret_name: w.secret_name });
    else bindings.push({ name, type: "d1", id: w.id });
  }
  return { resources: { bindings } };
}
const withBinding = (fn: (b: Record<string, any>[]) => Record<string, any>[]) => ({ resources: { bindings: fn(goodView().resources.bindings as any) } });

test("the declared configuration is what the check expects: private, delivery false, no routes", () => {
  assert.deepEqual(checkConfigFile(config), []);
  assert.equal(expected.WHATSAPP_DELIVERY_ENABLED.text, "false");
  assert.equal(expected.OTP_RECIPIENT_MODE.text, "open");
  assert.equal(expected.APP_NOTIFY.service, "aladdin-frontend-production");
  assert.equal(Object.values(expected).filter((e: any) => e.kind === "secret").length, 5);
  assert.match(checkConfigFile({ ...config, workers_dev: true }).join(), /workers_dev/);
  assert.match(checkConfigFile({ ...config, routes: [{ pattern: "x/*" }] }).join(), /routes/);
  assert.match(checkConfigFile({ ...config, vars: { ...config.vars, WHATSAPP_DELIVERY_ENABLED: "true" } }).join(), /must be "false"/);
});

test("deployment: exactly one version at 100%", () => {
  assert.deepEqual(checkDeployment({ versions: [{ version_id: "v1", percentage: 100 }] }), { problems: [], versionId: "v1" });
  assert.equal(checkDeployment({ versions: [{ version_id: "a", percentage: 50 }, { version_id: "b", percentage: 50 }] }).problems.length, 1);
  assert.equal(checkDeployment({ versions: [] }).problems.length, 1);
});

test("a deployed configuration identical to the declared one passes", () => {
  assert.deepEqual(checkBindings(goodView(), expected), []);
});

test("missing, extra and changed bindings and safety variables are refused", () => {
  assert.match(checkBindings(withBinding((b) => b.filter((x) => x.name !== "APP_NOTIFY")), expected).join(), /APP_NOTIFY is MISSING/);
  assert.match(checkBindings(withBinding((b) => [...b, { name: "OTP_ADMIN_GRANT_SECRET_EXTRA", type: "secret_text" }]), expected).join(), /unexpected binding/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "WHATSAPP_DELIVERY_ENABLED" ? { ...x, text: "true" } : x))), expected).join(), /WHATSAPP_DELIVERY_ENABLED/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "OTP_RECIPIENT_MODE" ? { ...x, text: "allowlist" } : x))), expected).join(), /OTP_RECIPIENT_MODE/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "APP_NOTIFY" ? { ...x, service: "somewhere-else" } : x))), expected).join(), /must be type=service to aladdin-frontend-production[^]*service=somewhere-else/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "OTP_SIGNING_SECRET" ? { ...x, secret_name: "OTHER" } : x))), expected).join(), /must be type=secrets_store_secret/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "IDEMPOTENCY_DB" ? { ...x, id: "other-db" } : x))), expected).join(), /D1 binding/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "OTP_ENVIRONMENT" ? { ...x, text: "preview" } : x))), expected).join(), /OTP_ENVIRONMENT/);
});

test("D1 switch tables must be empty and the alert seed row present", () => {
  const rows = (r: Record<string, number>) => [{ results: [r] }];
  assert.deepEqual(checkSwitch(rows({ sw: 0, au: 0, att: 0, al: 1 })), []);
  assert.match(checkSwitch(rows({ sw: 1, au: 0, att: 0, al: 1 })).join(), /otp_delivery_switch has 1/);
  assert.match(checkSwitch(rows({ sw: 0, au: 2, att: 0, al: 1 })).join(), /otp_delivery_audit/);
  assert.match(checkSwitch(rows({ sw: 0, au: 0, att: 1, al: 1 })).join(), /otp_delivery_attestation/);
  assert.match(checkSwitch(rows({ sw: 0, au: 0, att: 0, al: 0 })).join(), /seed row/);
  assert.equal(checkSwitch([]).length, 1);
});

test("the Worker's own answer is recognised; anything else is not the Worker", () => {
  assert.equal(reachedWorker({ status: 404, contentType: "application/json", body: "{}" }), true);
  assert.equal(reachedWorker({ status: 200, contentType: "text/html", body: "<html>" }), true, "a 2xx is never acceptable");
  assert.equal(reachedWorker({ status: 404, contentType: "text/html; charset=utf-8", body: "<html>not found</html>" }), false);
  assert.equal(reachedWorker({ status: 404, contentType: "text/plain", body: "error code: 1042" }), false);
  assert.equal(reachedWorker({ status: 530, contentType: "text/html", body: "<html>1042</html>" }), false);
});

// ---- the whole run, with fakes: only reads, never anything else ----
function fakes(over: { view?: unknown; d1?: unknown; status?: unknown; get?: (url: string) => Promise<any>; wranglerFails?: string; evidence?: Record<string, unknown> } = {}) {
  const calls: string[][] = [];
  const urls: string[] = [];
  const wrangler = (args: string[]) => {
    calls.push(args);
    if (over.wranglerFails && args.includes(over.wranglerFails)) return { status: 1, stdout: "", stderr: "Worker does not exist" };
    const j = (o: unknown) => ({ status: 0, stdout: JSON.stringify(o), stderr: "" });
    if (args[0] === "deployments") return j(over.status ?? { versions: [{ version_id: "v-live", percentage: 100 }] });
    if (args[0] === "versions") return j(over.view ?? goodView());
    if (args[0] === "d1") return j(over.d1 ?? [{ results: [{ sw: 0, au: 0, att: 0, al: 1 }] }]);
    throw new Error(`unexpected wrangler call ${args.join(" ")}`);
  };
  const get = async (url: string) => { urls.push(url); return over.get ? over.get(url) : { status: 404, contentType: "text/html", body: "<html>nothing here</html>" }; };
  const apiPaths: string[] = [];
  const api = async (p: string) => {
    apiPaths.push(p);
    const ev = { ...goodEvidence, ...(over.evidence ?? {}) } as any;
    if (p.includes("/subdomain")) return ev.subdomain;
    if (p.includes("/schedules")) return ev.schedules;
    if (p.includes("/workers/domains")) return ev.domains;
    if (p.startsWith("/zones?")) return ev.zones.map((z: any, i: number) => ({ id: `z${i}`, name: z.name }));
    const m = /^\/zones\/z(\d+)\/workers\/routes$/.exec(p);
    if (m) return ev.zones[Number(m[1])].routes;
    throw new Error(`unexpected api path ${p}`);
  };
  return { calls, urls, apiPaths, wrangler, get, api };
}
const goodEvidence = {
  subdomain: { enabled: false, previews_enabled: false },
  schedules: { schedules: [{ cron: "* * * * *" }] },
  domains: [],
  zones: [{ name: "aladdindecore.com", routes: [{ pattern: "aladdindecore.com/api/*", script: "aladdin-frontend-production" }] }],
};
const exec = async (f: ReturnType<typeof fakes>, argv: string[] = []) => {
  const lines: string[] = [];
  const code = await run({ argv, wrangler: f.wrangler, get: f.get, api: f.api, accountId: "acct", out: (s: string) => lines.push(s), config });
  return { code, text: lines.join("\n") };
};
const onlyReads = (f: ReturnType<typeof fakes>) => {
  for (const c of f.calls) {
    const s = c.join(" ");
    assert.ok(!/\b(deploy|rollback|delete|put|bulk|tail|upload|triggers)\b/.test(s) || s.startsWith("deployments status"), `not read-only: ${s}`);
    if (c[0] === "d1") { assert.ok(c.includes("--remote")); assert.ok(c[c.indexOf("--command") + 1] === SWITCH_SQL, "the only D1 statement is the constant SELECT"); assert.match(SWITCH_SQL, /^select /); assert.ok(!/insert|update|delete|drop|alter/i.test(SWITCH_SQL)); }
  }
};

test("a healthy private deployment passes, with reads only", async () => {
  const f = fakes();
  const r = await exec(f);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /Delivery is OFF/);
  onlyReads(f);
  assert.equal(f.urls.length, 2);
  assert.ok(f.urls.some((u) => u.includes(".workers.dev")) && f.urls.some((u) => u.startsWith("https://aladdindecore.com/")));
});

test("a Worker that answers on its workers.dev address or the site is refused", async () => {
  const worker = { status: 404, contentType: "application/json", body: "{}" };
  const a = await exec(fakes({ get: async (u) => (u.includes("workers.dev") ? worker : { status: 404, contentType: "text/html", body: "x" }) }));
  assert.equal(a.code, 1); assert.match(a.text, /workers\.dev address ANSWERS LIKE THE WORKER/);
  const b = await exec(fakes({ get: async (u) => (u.startsWith("https://aladdindecore.com") ? worker : { status: 404, contentType: "text/html", body: "x" }) }));
  assert.equal(b.code, 1); assert.match(b.text, /Production site path ANSWERS LIKE THE WORKER/);
});

test("a switched-on database, a changed variable or a split deployment is refused", async () => {
  assert.equal((await exec(fakes({ d1: [{ results: [{ sw: 1, au: 1, att: 1, al: 1 }] }] }))).code, 1);
  assert.equal((await exec(fakes({ view: withBinding((b) => b.map((x) => (x.name === "WHATSAPP_DELIVERY_ENABLED" ? { ...x, text: "true" } : x))) }))).code, 1);
  assert.equal((await exec(fakes({ status: { versions: [{ version_id: "a", percentage: 60 }, { version_id: "b", percentage: 40 }] } }))).code, 1);
});

test("before the Worker exists the check fails cleanly (nothing else is attempted)", async () => {
  const f = fakes({ wranglerFails: "deployments" });
  const r = await exec(f);
  assert.equal(r.code, 1);
  assert.match(r.text, /could not complete/);
  assert.equal(f.calls.length, 1);
});

test("binding types and structured fields are validated exactly, not by substring", () => {
  const swap = (name: string, patch: Record<string, unknown>) => checkBindings(withBinding((b) => b.map((x) => (x.name === name ? { ...x, ...patch } : x))), expected).join();
  // right values in the wrong type or the wrong field must fail
  assert.match(swap("IDEMPOTENCY_DB", { type: "kv_namespace" }), /D1 binding/);
  assert.match(swap("IDEMPOTENCY_DB", { id: undefined, note: expected.IDEMPOTENCY_DB.id }), /D1 binding/);
  assert.match(swap("OTP_SIGNING_SECRET", { type: "secret_text" }), /secrets_store_secret/);
  assert.match(swap("OTP_SIGNING_SECRET", { secret_name: undefined, store_id: "other", comment: expected.OTP_SIGNING_SECRET.secret_name }), /secrets_store_secret/);
  assert.match(swap("OTP_SIGNING_SECRET", { store_id: "other-store" }), /store/);
  assert.match(swap("APP_NOTIFY", { type: "plain_text" }), /type=service/);
  assert.match(swap("APP_NOTIFY", { environment: "staging" }), /production/);
  assert.match(swap("WHATSAPP_PHONE_NUMBER_ID", { type: "secret_text" }), /differs/);
  assert.equal(swap("APP_NOTIFY", {}), "");
});

test("privacy by API: workers.dev, previews, custom domains and routes", () => {
  const ok = { subdomain: { enabled: false, previews_enabled: false }, domains: [], zones: [{ name: "z", routes: [{ pattern: "x/*", script: "other" }] }] };
  assert.deepEqual(checkPrivacy(ok), []);
  assert.match(checkPrivacy({ ...ok, subdomain: { enabled: true, previews_enabled: false } }).join(), /workers\.dev is not disabled/);
  assert.match(checkPrivacy({ ...ok, subdomain: { enabled: false, previews_enabled: true } }).join(), /preview URLs/);
  assert.match(checkPrivacy({ ...ok, subdomain: undefined }).join(), /workers\.dev is not disabled/);
  assert.match(checkPrivacy({ ...ok, domains: [{ hostname: "otp.example.com", service: "aladdin-whatsapp-otp-production" }] }).join(), /custom domain/);
  assert.match(checkPrivacy({ ...ok, zones: [{ name: "z", routes: [{ pattern: "a/*", script: "aladdin-whatsapp-otp-production" }] }] }).join(), /route a\/\*/);
  assert.match(checkPrivacy({ ...ok, zones: undefined }).join(), /could not be listed/);
});

test("cron trigger must equal the declared schedule", () => {
  assert.deepEqual(checkSchedules({ schedules: [{ cron: "* * * * *" }] }, config), []);
  assert.match(checkSchedules({ schedules: [] }, config).join(), /differ/);
  assert.match(checkSchedules({ schedules: [{ cron: "* * * * *" }, { cron: "0 * * * *" }] }, config).join(), /differ/);
});

test("the run uses API evidence, refuses without it, and issues GET only", async () => {
  const f = fakes();
  assert.equal((await exec(f)).code, 0);
  assert.ok(f.apiPaths.some((p) => p.endsWith("/subdomain")) && f.apiPaths.some((p) => p.endsWith("/schedules")) && f.apiPaths.some((p) => p.includes("/workers/domains?service=")) && f.apiPaths.some((p) => p.endsWith("/workers/routes")));
  // a workers.dev address that is on, or a missing cron, fails even though both HTTP probes look private
  assert.equal((await exec(fakes({ evidence: { subdomain: { enabled: true, previews_enabled: false } } }))).code, 1);
  assert.equal((await exec(fakes({ evidence: { schedules: { schedules: [] } } }))).code, 1);
  // no API credentials: HTTP probes are not sufficient, so the run is refused
  const lines: string[] = [];
  const f2 = fakes();
  const code = await run({ argv: [], wrangler: f2.wrangler, get: f2.get, api: null, accountId: undefined, out: (s: string) => lines.push(s), config });
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /CLOUDFLARE_API_TOKEN/);
});

test("wrangler is run without a shell, so the D1 SQL reaches it as one argument", () => {
  const src = readFileSync(fileURLToPath(new URL("../scripts/check-production-deployment.mjs", import.meta.url)), "utf8");
  assert.ok(src.includes("shell: false") && !/shell:\s*process\.platform/.test(src));
  assert.ok(src.includes("process.execPath"));
});

test("an unexpected argument is a usage error and calls nothing", async () => {
  const f = fakes();
  assert.equal((await exec(f, ["--deploy"])).code, 2);
  assert.equal(f.calls.length, 0);
});
