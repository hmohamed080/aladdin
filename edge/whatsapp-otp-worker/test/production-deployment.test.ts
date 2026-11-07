import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkBindings, checkConfigFile, checkDeployment, checkSwitch, expectedBindings, parseJsonc, reachedWorker, run, SWITCH_SQL,
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
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "APP_NOTIFY" ? { ...x, service: "somewhere-else" } : x))), expected).join(), /points at somewhere-else/);
  assert.match(checkBindings(withBinding((b) => b.map((x) => (x.name === "OTP_SIGNING_SECRET" ? { ...x, secret_name: "OTHER" } : x))), expected).join(), /does not reference/);
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
function fakes(over: { view?: unknown; d1?: unknown; status?: unknown; get?: (url: string) => Promise<any>; wranglerFails?: string } = {}) {
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
  return { calls, urls, wrangler, get };
}
const exec = async (f: ReturnType<typeof fakes>, argv: string[] = []) => {
  const lines: string[] = [];
  const code = await run({ argv, wrangler: f.wrangler, get: f.get, out: (s: string) => lines.push(s), config });
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

test("an unexpected argument is a usage error and calls nothing", async () => {
  const f = fakes();
  assert.equal((await exec(f, ["--deploy"])).code, 2);
  assert.equal(f.calls.length, 0);
});
