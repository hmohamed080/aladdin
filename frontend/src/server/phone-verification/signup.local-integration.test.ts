// @vitest-environment node
/**
 * R1 - LOCAL integration run of the SIGNUP proof through the real application code against a real isolated Supabase stack
 * (Postgres + GoTrue + PostgREST). Skipped unless B1_DB_CONTAINER is set (supabase/tests/b1/run_b1.sh style env; see run_r1_service.sh).
 *
 * Drives the REAL createPhoneSignupService + otp.ts + the LOCAL OUTBOX transport (a file under a temp dir; nothing is sent anywhere).
 * The "WhatsApp message" is read back from the outbox exactly as a local E2E would. The guard is switched to ENFORCE for the run and the
 * switches are restored afterwards. Nothing writes phone_verified_at except phone_signup_attach itself.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOutboxTransport } from "./delivery";
import { latestOutboxCode } from "./outbox-reader";
import { parseKeyring } from "./otp";
import { createPhoneSignupService, signupCreateUserPayload } from "./signup-service";
import { localTarget, makeHttp, makeSql } from "./integration-support";
import { createFakeTransport } from "./transport";

const target = localTarget(process.env as Record<string, string | undefined>);
const PASSWORD = "R1-Fixture-Pass-1!";

describe.skipIf(!target)("signup proof - real service + outbox + GoTrue + PostgREST + Postgres", () => {
  const t = target ?? { container: "", api: "", anon: "", service: "" };
  const { sql } = makeSql(t.container);
  const http = makeHttp(t);
  const tag = randomBytes(3).toString("hex");
  const outboxDir = mkdtempSync(join(tmpdir(), "r1-outbox-"));
  const keyring = parseKeyring(JSON.stringify({ current: "k2", keys: { k2: randomBytes(32).toString("base64"), k1: randomBytes(32).toString("base64") } }));
  // Delivery is deferred past the reply (see signup-service.ts); the test collects the tasks and awaits them where a person would wait for the message.
  const tasks: Promise<void>[] = [];
  const defer = (t: Promise<void>) => { tasks.push(t); };
  const flush = async () => { await Promise.all(tasks.splice(0)); };
  const svc = createPhoneSignupService({ db: http.serviceDb(), transport: createOutboxTransport({ dir: outboxDir, nodeEnv: "test" }), keyring, enabled: true, defer });
  const created: string[] = [];
  let seq = 0;
  const phone = () => {
    seq += 1;
    const national = `101${String(parseInt(tag, 16) % 1000).padStart(3, "0")}${String(seq).padStart(4, "0")}`;
    return { iso2: "EG", national, e164: `+20${national}` };
  };
  const ip = () => `198.51.100.${(seq % 200) + 1}`;

  beforeAll(() => {
    sql("delete from app.phone_verification_ip_buckets;");
    sql("update app.phone_verification_config set enabled = true, alias_guard_mode = 'enforce', signup_enabled = true;");
  });
  afterAll(async () => {
    sql("update app.phone_verification_config set signup_enabled = false, alias_guard_mode = 'off', enabled = false;");
    for (const id of created) await http.deleteUser(id).catch(() => undefined);
    rmSync(outboxDir, { recursive: true, force: true });
  });

  async function init(email: string, p: ReturnType<typeof phone>) {
    const s = await http.signIn(email, PASSWORD);
    expect(s.status).toBe(200);
    const token = s.data.access_token as string;
    for (const [fn, args] of [
      ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
      ["onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }],
      ["profile_set_phone", { p_country_iso2: p.iso2, p_national: p.national, p_e164: p.e164 }],
      ["profile_set_username", { p_username: `r1s${tag}${randomUUID().slice(0, 6)}` }],
    ] as const) expect((await http.rpcAs(fn, args, token)).status).toBeLessThan(300);
  }
  const verifiedAt = (id: string) => sql(`select phone_verified_at is not null from public.profiles where user_id = '${id}';`);

  it("start delivers to the outbox only; the database holds a MAC, the outbox holds the code; the console stays silent", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const p = phone();
    const reg = randomUUID();
    const started = await svc.start(reg, p.e164, ip());
    expect(started.status).toBe("sent");
    await flush();
    const code = latestOutboxCode(outboxDir, p.e164, "signup_proof");
    expect(code).toMatch(/^[0-9]{6}$/);
    const files = readdirSync(outboxDir);
    expect(readFileSync(join(outboxDir, files[files.length - 1]!), "utf8")).not.toContain(p.e164); // masked + digest only
    if (started.status === "sent") expect(sql(`select count(*) from app.phone_verification_challenges where id = '${started.challengeId}' and octet_length(code_mac) = 32 and registration_id = '${reg}';`)).toBe("1");
    for (const s of spies) { for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toMatch(new RegExp(`${code}|${p.national}`)); s.mockRestore(); }
  });

  it("a complete sign-up through the real service: wrong code, right code, guarded creation, init, attach -> verified for the exact number", async () => {
    const p = phone();
    const reg = randomUUID();
    const started = await svc.start(reg, p.e164, ip());
    if (started.status !== "sent") throw new Error(`start: ${started.status}`);
    await flush();
    const code = latestOutboxCode(outboxDir, p.e164, "signup_proof")!;
    expect((await svc.verify(reg, started.challengeId, code === "000000" ? "000001" : "000000", ip())).status).toBe("invalid");
    const v = await svc.verify(reg, started.challengeId, code, ip());
    if (v.status !== "verified") throw new Error(`verify: ${v.status}`);
    expect(v.grant.phone).toBe(p.e164);

    // creating the alias WITHOUT the grant is refused by the database guard, through the Admin API
    const bare = await http.createUser({ email: v.grant.alias, password: PASSWORD, email_confirm: true });
    expect(bare.status).toBeGreaterThanOrEqual(400);
    // with the payload the registration code must use: accepted
    const c = await http.createUser(signupCreateUserPayload(v.grant, { password: PASSWORD, fullName: "R1 Proven", locale: "ar", appMetadata: { registration_source: "phone_whatsapp_sign_up" } }));
    expect(c.status).toBeLessThan(300);
    created.push(c.data.id);
    expect(verifiedAt(c.data.id)).toBe("f"); // creation alone verifies nothing
    await init(v.grant.alias, p);
    expect(await svc.attach(c.data.id, v.grant.id)).toEqual({ status: "attached" });
    expect(verifiedAt(c.data.id)).toBe("t");
    expect(sql(`select phone_e164 from public.profiles where user_id = '${c.data.id}';`)).toBe(p.e164);
    expect(sql(`select coalesce(u.phone, '') || '|' || (select count(*) from auth.mfa_factors m where m.user_id = u.id) from auth.users u where u.id = '${c.data.id}';`)).toBe("|0");

    // replay: same code, same grant, same payload
    expect((await svc.verify(reg, started.challengeId, code, ip())).status).toBe("invalid");
    expect(await svc.attach(c.data.id, v.grant.id)).toEqual({ status: "invalid" });
    const again = await http.createUser(signupCreateUserPayload(v.grant, { password: PASSWORD, fullName: "R1 Replay", locale: "ar" }));
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("a number that already has an account gets the same 'sent' reply and NOTHING is delivered", async () => {
    const before = readdirSync(outboxDir).length;
    const existing = sql("select phone_e164 from public.profiles where phone_e164 is not null and phone_verified_at is not null order by created_at desc limit 1;");
    expect(existing).toMatch(/^\+/);
    const out = await svc.start(randomUUID(), existing, ip());
    expect(out.status).toBe("sent");
    await flush();
    expect(readdirSync(outboxDir).length).toBe(before);
  });

  it("a delivery failure is invisible in the reply, then closes the challenge", async () => {
    const own: Promise<void>[] = [];
    const failing = createPhoneSignupService({ db: http.serviceDb(), transport: createFakeTransport({ failWith: new Error("upstream said +201000000000 123456") }).transport, keyring, enabled: true, defer: (t) => { own.push(t); } });
    const p = phone();
    const reg = randomUUID();
    const reply = await failing.start(reg, p.e164, ip());
    expect(reply.status).toBe("sent");
    await Promise.all(own);
    expect(sql(`select invalidated_why from app.phone_verification_challenges where registration_id = '${reg}';`)).toBe("delivery_failed");
  });

  it("the feature flag off means no database call and no outbox write", async () => {
    const off = createPhoneSignupService({ db: http.serviceDb(), transport: createOutboxTransport({ dir: outboxDir, nodeEnv: "test" }), keyring, enabled: false });
    const before = readdirSync(outboxDir).length;
    expect(await off.start(randomUUID(), phone().e164, ip())).toEqual({ status: "unavailable" });
    expect(readdirSync(outboxDir).length).toBe(before);
  });

  it("the outbox refuses to run in production", async () => {
    await expect(createOutboxTransport({ dir: outboxDir, nodeEnv: "production" }).send({ to: "+201000000000", code: "123456", ttlSeconds: 300 })).rejects.toThrow("production");
  });
});
