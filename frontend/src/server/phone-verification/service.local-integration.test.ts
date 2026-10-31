// @vitest-environment node
/**
 * Phase B1 - LOCAL integration run of the phone verification authority against a real isolated Supabase stack
 * (Postgres + GoTrue + PostgREST). Skipped unless B1_DB_CONTAINER is set; run it with supabase/tests/b1/run_b1.sh.
 *
 * Drives the REAL createPhoneVerificationService + otp.ts over PostgREST with the service-role key (the production path for
 * the authority). Delivery is the in-memory fake transport: zero messages leave the machine. Fixtures are built through the
 * real signup path, never by hand-writing identity rows, and the only thing this suite ever causes to be written to an
 * existing identity is what the authority itself writes: profiles.phone_verified_at, on the fixtures it verified.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeTransport } from "./transport";
import { parseKeyring } from "./otp";
import { createPhoneVerificationService } from "./service";
import { localTarget, makeHttp, makeSql, mask, shortId, SNAPSHOT_SQL } from "./integration-support";

const target = localTarget(process.env as Record<string, string | undefined>);
const PASSWORD = "B1-Fixture-Pass-1!";
type Row = { id: string; area: string; title: string; status: "PASS" | "FAIL"; evidence: string };
const results: Row[] = [];

describe.skipIf(!target)("phone verification authority - local integration (real GoTrue + PostgREST + Postgres)", () => {
  // The describe body is also evaluated (and then skipped) when no local stack is configured, so it must not dereference null.
  const t = target ?? { container: "", api: "", anon: "", service: "" };
  const { sql, json } = makeSql(t.container);
  const http = makeHttp(t);
  const tag = randomBytes(3).toString("hex");
  const created: string[] = [];
  const labelOf: Record<string, string> = {};
  const numbers = new Set<string>();
  const aliasDigits = new Set<string>();
  let seq = 0;
  const b64 = () => randomBytes(32).toString("base64");

  const keyring = parseKeyring(JSON.stringify({ current: "k2", keys: { k2: b64(), k1: b64() } }));
  const fake = createFakeTransport();
  const svc = createPhoneVerificationService({ db: http.serviceDb(), transport: fake.transport, keyring, enabled: true });
  const lastSent = () => fake.sent[fake.sent.length - 1]!;

  async function step(id: string, area: string, title: string, fn: () => void | Promise<void>, evidence?: unknown): Promise<void> {
    const text = typeof evidence === "string" ? evidence : ""; // a numeric 5th argument is a timeout meant for the enclosing it()
    try {
      await fn();
      results.push({ id, area, title, status: "PASS", evidence: mask(text) });
    } catch (e) {
      results.push({ id, area, title, status: "FAIL", evidence: mask(String((e as Error).message).slice(0, 300)) });
      throw e;
    }
  }

  const phone = () => {
    seq += 1;
    const base = String(parseInt(tag, 16) % 1000).padStart(3, "0");
    const national = `100${base}${String(seq).padStart(4, "0")}`;
    numbers.add(`20${national}`);
    return { iso2: "EG", national, e164: `+20${national}` };
  };

  type Acct = { id: string; label: string; email: string; token: string; phone: ReturnType<typeof phone> | null; alias: boolean };
  async function account(label: string, o: { alias?: boolean; track?: string; type?: string; withPhone?: boolean; org?: boolean } = {}): Promise<Acct> {
    const ph = o.withPhone === false ? null : phone();
    const email = o.alias ? `p${ph!.e164.slice(1)}@craftsman-login.aladdin.invalid` : `b1-${tag}-${label}@b1.invalid`;
    if (o.alias) aliasDigits.add(ph!.e164.slice(1));
    const c = await http.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `B1 ${label}`, locale: "ar" },
      app_metadata: o.alias ? { registration_source: "temporary_craftsman_password_flow" } : {},
    });
    if (c.status >= 300) throw new Error(`createUser ${label}: ${c.status}`);
    const a: Acct = { id: c.data.id, label, email, token: "", phone: ph, alias: Boolean(o.alias) };
    created.push(a.id);
    labelOf[a.id] = label;
    const s = await http.signIn(email, PASSWORD);
    a.token = s.data.access_token;
    const steps: [string, unknown][] = [
      ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
      ["onboarding_select_account_type", { p_track: o.track ?? "professional", p_account_type: o.type ?? "installer_technician" }],
    ];
    if (ph) steps.push(["profile_set_phone", { p_country_iso2: ph.iso2, p_national: ph.national, p_e164: ph.e164 }]);
    steps.push(["profile_set_username", { p_username: `${label.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8) || "b1"}${tag}${a.id.slice(0, 4)}` }]);
    for (const [fn, args] of steps) {
      const r = await http.rpcAs(fn, args, a.token);
      if (r.status >= 300) throw new Error(`fixture ${label} ${fn}: ${r.data?.code ?? r.status}`);
    }
    if (o.org) {
      const act = sql("select key from public.activities where organization_type='showroom_dealer' and is_active order by key limit 1;");
      const d = await http.rpcAs("business_draft_save_v2", {
        p_legal_name: `B1 ${label} LLC`, p_display_name: `B1 ${label} ${tag}`, p_org_type: "showroom_dealer", p_governorate: "Cairo", p_city: "New Cairo",
        p_primary_branch_name: "Main", p_contact_phone: phone().e164, p_activity_type: act,
      }, a.token);
      if (d.status >= 300) throw new Error(`business_draft_save_v2 ${d.data?.code}`);
      const sub = await http.rpcAs("business_draft_submit_v2", {}, a.token);
      if (sub.status >= 300) throw new Error(`business_draft_submit_v2 ${sub.data?.code}`);
    }
    return a;
  }

  type Snap = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const snapshot = (accts: Acct[]): Snap => json<Snap>(SNAPSHOT_SQL(accts.map((a) => a.id)));
  async function withState(snap: Snap, accts: Acct[]): Promise<Snap> {
    for (const a of accts) {
      const login = await http.signIn(a.email, PASSWORD);
      snap[a.id].signin_user = login.status === 200 ? login.data.user.id : `status_${login.status}`;
      snap[a.id].registration_state = login.status === 200 ? (await http.rpcAs("my_registration_state", {}, login.data.access_token)).data : null;
    }
    return snap;
  }
  /** Leaf paths that differ between two snapshots of the same account (created_at ignored). */
  function changedPaths(a: unknown, b: unknown, path = ""): string[] {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (typeof a === "object" && a && typeof b === "object" && b && !Array.isArray(a) && !Array.isArray(b)) {
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => changedPaths((a as Snap)[k], (b as Snap)[k], path ? `${path}.${k}` : k));
    }
    return [path];
  }
  const diffAll = (x: Snap, y: Snap): string[] => Object.keys(x).flatMap((id) => changedPaths(x[id], y[id]).map((p) => `${labelOf[id]}.${p}`));
  const challenge = (id: string) => json<Record<string, any>>(`select to_jsonb(c) from app.phone_verification_challenges c where c.id='${id}';`); // eslint-disable-line @typescript-eslint/no-explicit-any
  const unthrottle = (userId: string) => sql(`update app.phone_verification_challenges set created_at = created_at - interval '3 hours', expires_at = expires_at - interval '3 hours' where user_id='${userId}';`);
  const verifiedAt = (userId: string) => sql(`select coalesce(phone_verified_at::text,'') from public.profiles where user_id='${userId}';`);
  const globalCounts = () => json<Record<string, number>>("select jsonb_build_object('auth_users',(select count(*) from auth.users),'identities',(select count(*) from auth.identities),'mfa',(select count(*) from auth.mfa_factors),'auth_phones',(select count(*) from auth.users where phone is not null));");
  const deadlocks = () => Number(sql("select deadlocks from pg_stat_database where datname='postgres';"));
  const ageBy = (userId: string, by: string) => sql(`update app.phone_verification_challenges set created_at = created_at - interval '${by}', expires_at = expires_at - interval '${by}' where user_id='${userId}';`);
  // Each simulated client gets its own address; the per-IP budget is exercised on purpose in B1-lim-2 only.
  let ipSeq = 0;
  const nextIp = () => { ipSeq += 1; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };
  const wrong = (code: string) => (code === "000000" ? "000001" : "000000");

  let installer: Acct, showroom: Acct, emailAcct: Acct, orgOnly: Acct, neighbor: Acct;
  let legacy: Acct[];
  let baseline: Snap;
  let afterAll_: Snap;
  const evidenceExtra: Record<string, unknown> = {};

  beforeAll(async () => {
    expect(sql("select enabled from app.phone_verification_config;")).toBe("f");
    installer = await account("LegacyInstaller", { alias: true });
    showroom = await account("LegacyShowroom", { alias: true, track: "business", type: "showroom_dealer", org: true });
    emailAcct = await account("EmailSignup");
    orgOnly = await account("OrgContactOnly", { track: "business", type: "showroom_dealer", withPhone: false, org: true });
    neighbor = await account("Neighbor");
    legacy = [installer, showroom, emailAcct, orgOnly];
  }, 120_000);

  afterAll(() => {
    sql("update app.phone_verification_config set enabled = false, ip_failures_15m = 30, ip_hourly_starts = 20;"); // restore the shipped state
    const dir = resolve(process.cwd(), "../docs/security/phone-identity-b1");
    mkdirSync(dir, { recursive: true });
    const total = results.length;
    const fails = results.filter((r) => r.status === "FAIL").length;
    const redact = (s: Snap | undefined) => s && Object.fromEntries(Object.entries(s).map(([id, v]) => [labelOf[id] ?? shortId(id), {
      user_id: shortId(id), registration_state: v.registration_state, signin_user_matches: v.signin_user === id,
      auth: { alias_login: String(v.auth.email).endsWith("@craftsman-login.aladdin.invalid"), auth_phone_set: v.auth.phone !== null, role: v.auth.role, source: v.auth.source },
      identities: v.identities.length, mfa_factors: v.mfa_factors,
      profile: { has_phone: v.profile.phone_e164 !== null, phone_verified: v.profile.verified_at !== null },
      memberships: v.memberships.map((m: any) => ({ org_type: m.org_type, status: m.status, capabilities: m.caps.length })), // eslint-disable-line @typescript-eslint/no-explicit-any
      points: v.points, consents: v.consents, secondary_reservations: v.secondary_reservations,
    }]));
    writeFileSync(resolve(dir, process.env.B1_EVIDENCE_NAME ?? "evidence.json"), `${JSON.stringify({
      suite: "phone-verification-b1-local-integration", run: new Date().toISOString().slice(0, 10), summary: { PASS: total - fails, FAIL: fails, total },
      redaction: "phones masked, aliases masked, user ids shortened, MACs masked; no tokens, passwords, raw codes or key material recorded",
      results, ...evidenceExtra, invariance: { before: redact(baseline), after: redact(afterAll_) },
    }, null, 2)}\n`);
    if (process.env.B1_KEEP !== "1") for (const id of created) void http.deleteUser(id);
  });

  it("0. ships disabled: the database flag off makes a server-enabled service inert", async () => {
    baseline = await withState(snapshot(legacy), legacy);
    const before = globalCounts();
    const out = await svc.start(installer.id, "203.0.113.5");
    await step("B1-OFF-1", "flag", "DB flag OFF: start is 'unavailable', nothing delivered, no challenge written", () => {
      expect(out).toEqual({ status: "unavailable" });
      expect(fake.sent).toHaveLength(0);
      expect(sql("select count(*) from app.phone_verification_challenges;")).toBe("0");
    });
    const off = createPhoneVerificationService({ db: { rpc: () => { throw new Error("must not be called"); } }, transport: fake.transport, keyring, enabled: false });
    await step("B1-OFF-2", "flag", "Server flag OFF: no database call is even attempted", async () => {
      expect(await off.start(installer.id, null)).toEqual({ status: "unavailable" });
      expect(await off.verify(installer.id, "11111111-1111-4111-8111-111111111111", "123456", null)).toEqual({ status: "unavailable" });
    });
    expect(globalCounts()).toEqual(before);
    sql("update app.phone_verification_config set enabled = true;"); // local test switch; restored in afterAll
  });

  for (const which of ["installer", "showroom", "email"] as const) {
    it(`1. legacy ${which}: failures change nothing, success changes only phone_verified_at, replay changes nothing`, async () => {
      const a = which === "installer" ? installer : which === "showroom" ? showroom : emailAcct;
      const before = await withState(snapshot([a]), [a]);
      const usersBefore = globalCounts();

      const started = await svc.start(a.id, "203.0.113.10");
      if (started.status !== "sent") throw new Error(`start: ${started.status}`);
      const sent = lastSent();
      await step(`B1-${which}-1`, "legacy", `${a.label}: code is delivered to the account's own current number only; the browser-facing result carries no number or code`, () => {
        expect(sent.to).toBe(a.phone!.e164);
        expect(JSON.stringify(started)).not.toContain(a.phone!.e164);
        expect(JSON.stringify(started)).not.toContain(sent.code);
        const row = challenge(started.challengeId);
        expect(row.kid).toBe("k2");
        expect(String(row.code_mac)).not.toContain(sent.code);
        expect(row.phone_e164).toBe(a.phone!.e164);
      }, `sent=1 kid=k2`);

      await step(`B1-${which}-2`, "failure", `${a.label}: two wrong codes are 'invalid' and identity is untouched`, async () => {
        expect(await svc.verify(a.id, started.challengeId, wrong(sent.code), "203.0.113.10")).toEqual({ status: "invalid" });
        expect(await svc.verify(a.id, started.challengeId, wrong(sent.code), "203.0.113.10")).toEqual({ status: "invalid" });
        expect(challenge(started.challengeId).attempts).toBe(2);
        expect(diffAll(before, await withState(snapshot([a]), [a]))).toEqual([]);
      });

      await step(`B1-${which}-3`, "failure", `${a.label}: another account holding the CORRECT code and the challenge id is 'invalid' and cannot burn attempts`, async () => {
        expect(await svc.verify(neighbor.id, started.challengeId, sent.code, "203.0.113.11")).toEqual({ status: "invalid" });
        expect(challenge(started.challengeId).attempts).toBe(2);
        expect(verifiedAt(neighbor.id)).toBe("");
        expect(verifiedAt(a.id)).toBe("");
      });

      await step(`B1-${which}-4`, "failure", `${a.label}: an expired challenge with the right code is 'invalid'; identity untouched`, async () => {
        sql(`update app.phone_verification_challenges set created_at = created_at - interval '6 minutes', expires_at = expires_at - interval '6 minutes' where id='${started.challengeId}';`);
        expect(await svc.verify(a.id, started.challengeId, sent.code, "203.0.113.10")).toEqual({ status: "invalid" });
        expect(challenge(started.challengeId).invalidated_why).toBe("expired");
        expect(diffAll(before, await withState(snapshot([a]), [a]))).toEqual([]);
      });

      unthrottle(a.id);
      const second = await svc.start(a.id, "203.0.113.10");
      if (second.status !== "sent") throw new Error(`second start: ${second.status}`);
      const code2 = lastSent().code;

      await step(`B1-${which}-5`, "success", `${a.label}: success writes ONLY profile.phone_verified_at - every other identity field, role, membership, capability, point, consent and the alias is unchanged`, async () => {
        expect(await svc.verify(a.id, second.challengeId, code2, "203.0.113.10")).toEqual({ status: "verified" });
        const after = await withState(snapshot([a]), [a]);
        expect(diffAll(before, after)).toEqual([`${a.label}.profile.verified_at`]);
        expect(after[a.id].profile.phone_e164).toBe(a.phone!.e164);
        expect(after[a.id].registration_state).toBe(before[a.id].registration_state);
        expect(after[a.id].signin_user).toBe(a.id);
        expect(globalCounts()).toEqual(usersBefore);
      }, "changed paths: profile.verified_at only");

      await step(`B1-${which}-6`, "replay", `${a.label}: replaying the consumed code is 'invalid' and changes nothing (verified timestamp stable)`, async () => {
        const stamp = verifiedAt(a.id);
        const post = await withState(snapshot([a]), [a]);
        expect(await svc.verify(a.id, second.challengeId, code2, "203.0.113.10")).toEqual({ status: "invalid" });
        expect(await svc.verify(a.id, started.challengeId, sent.code, "203.0.113.10")).toEqual({ status: "invalid" });
        expect(verifiedAt(a.id)).toBe(stamp);
        expect(diffAll(post, await withState(snapshot([a]), [a]))).toEqual([]);
        expect(sql(`select count(*) from public.audit_log where action='phone_verification.completed' and subject_id='${a.id}';`)).toBe("1");
      });

      await step(`B1-${which}-7`, "authority", `${a.label}: a verified account cannot start again (already_verified) and gains no login/recovery/MFA path`, async () => {
        expect(await svc.start(a.id, "203.0.113.10")).toEqual({ status: "already_verified" });
        const otp = await http.call("POST", "/auth/v1/otp", { body: { phone: a.phone!.e164 } });
        expect(otp.status).toBeGreaterThanOrEqual(400); // GoTrue phone provider is off: a verified number is not a credential
        expect(sql(`select (select phone is null from auth.users where id='${a.id}') and (select count(*)=0 from auth.mfa_factors where user_id='${a.id}');`)).toBe("t");
        expect(globalCounts()).toEqual(usersBefore);
      }, "native phone OTP refused; auth.users.phone NULL; no MFA factor");
    }, 120_000);
  }

  it("2. organization-only contact account has no primary phone: unavailable, nothing written", async () => {
    const before = await withState(snapshot([orgOnly]), [orgOnly]);
    await step("B1-org-1", "legacy", "OrgContactOnly: start is 'unavailable' (an org contact number is never a verifiable credential); identity untouched", async () => {
      expect(await svc.start(orgOnly.id, nextIp())).toEqual({ status: "unavailable" });
      expect(sql(`select count(*) from app.phone_verification_challenges where user_id='${orgOnly.id}';`)).toBe("0");
      expect(diffAll(before, await withState(snapshot([orgOnly]), [orgOnly]))).toEqual([]);
    });
  });

  it("3. key rotation through the real service", async () => {
    const mk = (cur: string, keys: Record<string, string>) =>
      createPhoneVerificationService({ db: http.serviceDb(), transport: fake.transport, keyring: parseKeyring(JSON.stringify({ current: cur, keys })), enabled: true });
    const k1 = b64(), k2 = b64();
    const a = await account("RotateA"), b = await account("RotateB");
    const oldSvc = mk("k1", { k1 }), rotated = mk("k2", { k2, k1 }), retired = mk("k2", { k2 });
    await step("B1-rot-1", "rotation", "A challenge issued under k1 verifies after rotation while k1 is still accepted", async () => {
      const s = await oldSvc.start(a.id, nextIp());
      if (s.status !== "sent") throw new Error(s.status);
      expect(challenge(s.challengeId).kid).toBe("k1");
      expect(await rotated.verify(a.id, s.challengeId, lastSent().code, null)).toEqual({ status: "verified" });
    });
    await step("B1-rot-2", "rotation", "Once k1 is retired, an outstanding k1 challenge fails closed (and counts an attempt)", async () => {
      const s = await oldSvc.start(b.id, nextIp());
      if (s.status !== "sent") throw new Error(s.status);
      expect(await retired.verify(b.id, s.challengeId, lastSent().code, null)).toEqual({ status: "invalid" });
      expect(challenge(s.challengeId).attempts).toBe(1);
      expect(verifiedAt(b.id)).toBe("");
    });
    await step("B1-rot-3", "rotation", "New challenges are issued under the current key (k2)", async () => {
      unthrottle(b.id);
      const s = await rotated.start(b.id, nextIp());
      if (s.status !== "sent") throw new Error(s.status);
      expect(challenge(s.challengeId).kid).toBe("k2");
    });
  });

  it("4. delivery failure and limits through the real service", async () => {
    const d = await account("Delivery");
    const failing = createPhoneVerificationService({ db: http.serviceDb(), transport: createFakeTransport({ failWith: new Error("boom") }).transport, keyring, enabled: true });
    await step("B1-del-1", "delivery", "A transport failure closes the challenge (delivery_failed), reveals nothing, and still spends the resend budget", async () => {
      expect(await failing.start(d.id, nextIp())).toEqual({ status: "unavailable" });
      const row = json<Record<string, any>>(`select to_jsonb(c) from app.phone_verification_challenges c where c.user_id='${d.id}' order by created_at desc limit 1;`); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(row.invalidated_why).toBe("delivery_failed");
      const again = await svc.start(d.id, nextIp());
      expect(again.status).toBe("rate_limited");
      if (again.status === "rate_limited") expect(again.retryAfterSeconds).toBeGreaterThan(0);
    });
    const l = await account("Limits");
    await step("B1-lim-1", "limits", "Resend cooldown, per-account hourly cap and supersede through the real service", async () => {
      const first = await svc.start(l.id, "198.51.100.20");
      if (first.status !== "sent") throw new Error(first.status);
      const code1 = lastSent().code;
      expect((await svc.start(l.id, "198.51.100.20")).status).toBe("rate_limited");
      ageBy(l.id, "2 minutes");
      const second = await svc.start(l.id, "198.51.100.20");
      if (second.status !== "sent") throw new Error(second.status);
      expect(await svc.verify(l.id, first.challengeId, code1, "198.51.100.20")).toEqual({ status: "invalid" }); // superseded
      for (let i = 0; i < 4; i += 1) { ageBy(l.id, "2 minutes"); expect((await svc.start(l.id, `198.51.100.${30 + i}`)).status).toBe("sent"); }
      ageBy(l.id, "2 minutes");
      const capped = await svc.start(l.id, "198.51.100.40"); // 7th start inside one hour
      expect(capped.status).toBe("rate_limited");
    });
    await step("B1-lim-2", "limits", "Per-IP failure budget: after the cap even a correct code from that IP key is refused without burning an attempt", async () => {
      const f = await account("IpFail");
      sql("update app.phone_verification_config set ip_failures_15m = 3;");
      const s = await svc.start(f.id, "198.51.100.77");
      if (s.status !== "sent") throw new Error(s.status);
      const good = lastSent().code;
      for (let i = 0; i < 3; i += 1) await svc.verify(f.id, s.challengeId, wrong(good), "198.51.100.77");
      const blocked = await svc.verify(f.id, s.challengeId, good, "198.51.100.77");
      sql("update app.phone_verification_config set ip_failures_15m = 30;");
      expect(blocked.status).toBe("rate_limited");
      expect(await svc.verify(f.id, s.challengeId, good, "198.51.100.78")).toEqual({ status: "verified" });
    });
  });

  it("5. concurrency: single use, supersede, and races with phone changes never produce a stale or incorrect verified state", async () => {
    const dl0 = deadlocks();
    const counters = { verifyFirst: 0, changeFirst: 0 };

    await step("B1-con-1", "concurrency", "8 simultaneous verifications of one correct code: exactly one 'verified'", async () => {
      const a = await account("RaceVerify");
      const s = await svc.start(a.id, nextIp());
      if (s.status !== "sent") throw new Error(s.status);
      const code = lastSent().code;
      const out = await Promise.all(Array.from({ length: 8 }, (_, i) => svc.verify(a.id, s.challengeId, code, `203.0.113.${100 + i}`)));
      expect(out.filter((o) => o.status === "verified")).toHaveLength(1);
      expect(out.filter((o) => o.status === "invalid")).toHaveLength(7);
      expect(sql(`select count(*) from public.audit_log where action='phone_verification.completed' and subject_id='${a.id}';`)).toBe("1");
    });

    await step("B1-con-2", "concurrency", "8 simultaneous starts for one account (distinct challenge ids): exactly one challenge, the rest rate limited", async () => {
      const a = await account("RaceStart");
      const out = await Promise.all(Array.from({ length: 8 }, () => svc.start(a.id, nextIp())));
      expect(out.filter((o) => o.status === "sent")).toHaveLength(1);
      expect(out.filter((o) => o.status === "rate_limited")).toHaveLength(7);
      expect(sql(`select count(*) from app.phone_verification_challenges where user_id='${a.id}' and consumed_at is null and invalidated_at is null;`)).toBe("1");
    });

    await step("B1-con-3", "concurrency", "Verify racing a phone change (14 trials, both orders): verified_at is never set for a number the account does not hold", async () => {
      for (let i = 0; i < 14; i += 1) {
        const a = await account(`RaceChange${i}`);
        const original = a.phone!.e164;
        const s = await svc.start(a.id, nextIp());
        if (s.status !== "sent") throw new Error(s.status);
        const code = lastSent().code;
        const np = phone();
        const change = async () => { if (i % 2) await new Promise((r) => setTimeout(r, i % 5)); return http.rpcAs("profile_set_phone", { p_country_iso2: np.iso2, p_national: np.national, p_e164: np.e164 }, a.token); };
        const verify = async () => { if (!(i % 2)) await new Promise((r) => setTimeout(r, i % 5)); return svc.verify(a.id, s.challengeId, code, nextIp()); };
        const [c, v] = await Promise.all([change(), verify()]);
        const row = json<{ phone_e164: string; verified_at: string | null }>(`select jsonb_build_object('phone_e164', phone_e164, 'verified_at', phone_verified_at) from public.profiles where user_id='${a.id}';`);
        // the invariant that matters: a verified timestamp may exist only for the number it was proven for
        expect(row.verified_at === null || row.phone_e164 === original).toBe(true);
        if (c.status < 300) expect(row.phone_e164).toBe(np.e164); // the change always lands
        if (c.status < 300) expect(row.verified_at).toBeNull(); // after a landed change nothing is verified
        if (v.status === "verified") counters.verifyFirst += 1; else counters.changeFirst += 1;
        expect(sql(`select count(*) from app.phone_verification_challenges where user_id='${a.id}' and consumed_at is null and invalidated_at is null and phone_e164 <> '${row.phone_e164}';`)).toBe("0");
      }
    }, 120_000);

    await step("B1-con-4", "concurrency", "Verify racing an unrelated profile update and a same-number re-save: verification still lands, no lost update", async () => {
      for (let i = 0; i < 6; i += 1) {
        const a = await account(`RaceNoop${i}`);
        const s = await svc.start(a.id, nextIp());
        if (s.status !== "sent") throw new Error(s.status);
        const code = lastSent().code;
        const [u, v] = await Promise.all([
          i % 2 ? http.rpcAs("profile_set_phone", { p_country_iso2: a.phone!.iso2, p_national: a.phone!.national, p_e164: a.phone!.e164 }, a.token)
                : http.call("PATCH", `/rest/v1/profiles?user_id=eq.${a.id}`, { token: a.token, body: { headline: `h${i}` } }),
          svc.verify(a.id, s.challengeId, code, nextIp()),
        ]);
        expect(u.status).toBeLessThan(300);
        expect(v.status).toBe("verified");
        expect(verifiedAt(a.id)).not.toBe("");
      }
    }, 120_000);

    await step("B1-con-5", "concurrency", "Start racing a phone change (8 trials): any open challenge is for the number the account holds now", async () => {
      for (let i = 0; i < 8; i += 1) {
        const a = await account(`RaceStartChange${i}`);
        const np = phone();
        await Promise.all([
          svc.start(a.id, nextIp()),
          http.rpcAs("profile_set_phone", { p_country_iso2: np.iso2, p_national: np.national, p_e164: np.e164 }, a.token),
        ]);
        expect(sql(`select count(*) from app.phone_verification_challenges c join public.profiles p on p.user_id=c.user_id where c.user_id='${a.id}' and c.consumed_at is null and c.invalidated_at is null and c.phone_e164 <> p.phone_e164;`)).toBe("0");
      }
    }, 120_000);

    await step("B1-con-6", "concurrency", "Verify racing a re-start (supersede) (6 trials): never both verified and an open challenge", async () => {
      for (let i = 0; i < 6; i += 1) {
        const a = await account(`RaceSupersede${i}`);
        const s = await svc.start(a.id, nextIp());
        if (s.status !== "sent") throw new Error(s.status);
        const code = lastSent().code;
        unthrottle(a.id);
        const [, v] = await Promise.all([svc.start(a.id, nextIp()), svc.verify(a.id, s.challengeId, code, nextIp())]);
        const open = Number(sql(`select count(*) from app.phone_verification_challenges where user_id='${a.id}' and consumed_at is null and invalidated_at is null;`));
        if (v.status === "verified") expect(open).toBe(0);
        expect(open).toBeLessThanOrEqual(1);
      }
    }, 120_000);

    await step("B1-con-7", "concurrency", "No deadlocks across all concurrent scenarios", () => {
      expect(deadlocks() - dl0).toBe(0);
    }, `deadlock_delta=${deadlocks() - dl0}`);
    evidenceExtra.race_outcomes = { verify_won_then_reset_by_change_or_noop: counters.verifyFirst, change_won_verify_refused: counters.changeFirst };
  }, 300_000);

  it("6. final identity invariance, privacy and hygiene", async () => {
    afterAll_ = await withState(snapshot(legacy), legacy);
    await step("B1-inv-1", "invariance", "After everything: the only change to ANY legacy fixture is phone_verified_at on the three that were verified", () => {
      const changed = diffAll(baseline, afterAll_).sort();
      expect(changed).toEqual(["EmailSignup.profile.verified_at", "LegacyInstaller.profile.verified_at", "LegacyShowroom.profile.verified_at"]);
    }, "profile.verified_at x3; all else identical incl. user ids, aliases, password digests, roles, memberships, capabilities, points, consents, registration state");
    await step("B1-inv-2", "invariance", "No Auth user was created for a phone, none has a phone, no non-email identity, no MFA factor, anywhere in the database", () => {
      const g = globalCounts();
      expect(g.auth_phones).toBe(0);
      expect(g.mfa).toBe(0);
      expect(sql("select count(*) from auth.identities where provider <> 'email';")).toBe("0");
    });
    await step("B1-inv-3", "invariance", "Every verified profile is for a number that profile currently holds, and has exactly one completion audit event", () => {
      expect(sql("select count(*) from public.profiles p where p.phone_verified_at is not null and p.phone_e164 is null;")).toBe("0");
      expect(sql(`select count(*) from public.profiles p where p.phone_verified_at is not null and (select count(*) from public.audit_log a where a.action='phone_verification.completed' and a.subject_id=p.user_id) <> 1;`)).toBe("0");
    });
    await step("B1-priv-1", "privacy", "Audit rows written by the authority contain no phone number, code or MAC", () => {
      expect(sql("select count(*) from public.audit_log where action like 'phone_verification.%' and metadata::text ~ '(\\+20|10[0-9]{8}|mac|code)';")).toBe("0");
    });
    await step("B1-priv-2", "privacy", "Raw codes and MACs never appear in GoTrue, PostgREST, gateway or database logs; non-alias numbers don't either", () => {
      const project = t.container.replace("supabase_db_", "");
      const logs = ["auth", "rest", "kong", "db"].map((s) => {
        const r = spawnSync("docker", ["logs", `supabase_${s}_${project}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      });
      expect(logs.every((l) => l.trim().length > 100)).toBe(true); // the scan is not blind
      const all = logs.join("\n");
      const codes = fake.sent.map((m) => m.code);
      const leakedCodes = codes.filter((c) => new RegExp(`["'=:]${c}["']`).test(all)).length;
      const macLike = (all.match(/code_mac[^\n]{0,20}[0-9a-f]{64}|p_code_mac[^\n]{0,10}[0-9a-f]{64}/g) ?? []).length;
      const nonAlias = [...numbers].filter((n) => !aliasDigits.has(n));
      const leakedNumbers = nonAlias.filter((n) => all.includes(n)).length;
      evidenceExtra.log_scan = { codes_checked: codes.length, codes_found: leakedCodes, mac_lines: macLike, non_alias_numbers_checked: nonAlias.length, non_alias_numbers_found: leakedNumbers };
      expect(leakedCodes).toBe(0);
      expect(macLike).toBe(0);
      expect(leakedNumbers).toBe(0);
    });
  });

  it("7. the shipped state is restored: disabled", () => {
    sql("update app.phone_verification_config set enabled = false;");
    expect(sql("select enabled from app.phone_verification_config;")).toBe("f");
  });
});
