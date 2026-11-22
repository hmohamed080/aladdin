import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-0031 drift guard. The database refuses state-changing Data API calls from an account whose registration is unfinished,
 * except the sign-up steps in app.registration_gate_allows. Every RPC the registration code calls with the USER's session
 * must therefore be in that allowlist (or be read-only / admin-after-registration). This test fails when a new RPC is added to
 * a registration flow without being allowlisted, instead of failing for real users after the migration is applied.
 */
const root = resolve(process.cwd(), "..");
const migrations = join(root, "supabase", "migrations");

function currentAllowlist(): Set<string> {
  const files = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /create or replace function app\.registration_gate_allows/i.test(readFileSync(join(migrations, f), "utf8")));
  expect(files.length).toBeGreaterThan(0);
  const sql = readFileSync(join(migrations, files[files.length - 1]!), "utf8");
  const block = /v_fn in \(([\s\S]*?)\) then/.exec(sql)?.[1] ?? "";
  const names = [...block.replace(/--[^\n]*/g, "").matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]!);
  expect(names.length).toBeGreaterThan(5);
  return new Set(names);
}

/** Files whose user-session RPCs run while a registration may still be unfinished. */
const REGISTRATION_FILES = [
  "server/actions/auth.ts",
  "server/actions/auth-password-preview.ts",
  "server/actions/registration.ts",
  "server/actions/onboarding.ts",
  "server/actions/staff-invitation.ts",
  "server/actions/invitations.ts",
  "server/auth/entry-oauth.ts",
  "server/auth/phone-sign-up.ts",
];

/** Allowed without being in the sign-up allowlist, each with its reason. */
const NOT_GATED = new Map<string, string>([
  ["my_registration_state", "STABLE function: read-only, never gated"],
  ["staff_invitation_registration_check", "STABLE function: read-only, never gated"],
  ["admin_staff_invite", "staff action: only an already-registered Administrator reaches it"],
  ["admin_staff_invitation_revoke", "staff action: only an already-registered Administrator reaches it"],
]);

describe("registration gate allowlist covers every registration step", () => {
  const allow = currentAllowlist();
  for (const file of REGISTRATION_FILES) {
    it(`${file}: every user-session RPC is a sign-up step or exempt`, () => {
      const text = readFileSync(join(process.cwd(), "src", file), "utf8");
      const used = [...text.matchAll(/\.rpc\(\s*"([a-z_0-9]+)"/g)].map((m) => m[1]!);
      const missing = [...new Set(used)].filter((n) => !allow.has(n) && !NOT_GATED.has(n));
      expect(missing, `RPCs missing from app.registration_gate_allows: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
