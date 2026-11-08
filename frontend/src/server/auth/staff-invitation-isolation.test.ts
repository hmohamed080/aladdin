import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const files = [
  "server/actions/staff-invitation.ts",
  "server/auth/staff-invitation-token.ts",
  "server/auth/staff-invitation-errors.ts",
  "server/auth/signup-guards.ts",
  "server/queries/staff-invitations.ts",
  "app/auth/staff-invitation/page.tsx",
  "app/auth/staff-invitation/register/page.tsx",
  "app/auth/staff-invitation/[token]/route.ts",
  "features/staff-invitation/staff-invitation-entry.tsx",
  "features/staff-invitation/staff-register-form.tsx",
  "features/admin-staff-invitations/invitations-panel.tsx",
];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("Admin Staff invitations stay isolated", () => {
  it("never touch WhatsApp OTP, the Worker, D1 or the notification path", () => {
    for (const f of files) {
      const code = strip(readFileSync(join(root, f), "utf8"));
      expect(code, f).not.toMatch(/whatsapp|OTP_WORKER|worker-admin|worker-binding|phone-verification|IDEMPOTENCY_DB|\bD1\b|notify/i);
    }
  });

  it("never log or serialize the invitation token, and never read it from a URL parameter", () => {
    for (const f of ["server/actions/staff-invitation.ts", "app/auth/staff-invitation/page.tsx", "app/auth/staff-invitation/register/page.tsx"]) {
      const code = strip(readFileSync(join(root, f), "utf8"));
      expect(code, f).not.toMatch(/console\.\w+\([^)]*\btoken\b/);
      expect(code, f).not.toMatch(/searchParams/);
    }
    const actions = strip(readFileSync(join(root, "server/actions/staff-invitation.ts"), "utf8"));
    expect(actions).not.toMatch(/formData\.get\(["']token["']\)[\s\S]{0,60}p_token/);
  });

  it("the only new client-reachable surface is the tokenless pages and the one-hop route", () => {
    const dir = join(root, "app/auth/staff-invitation");
    const names: string[] = [];
    const walk = (d: string) =>
      readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : names.push(join(d, n).slice(dir.length).replace(/\\/g, "/"))));
    walk(dir);
    expect(names.sort()).toEqual(["/[token]/route.ts", "/page.tsx", "/register/page.tsx"]);
  });

  it("the shared registration guards are imported by BOTH flows (one implementation)", () => {
    for (const f of ["server/actions/auth-password-preview.ts", "server/actions/staff-invitation.ts"]) {
      expect(readFileSync(join(root, f), "utf8"), f).toContain("@/server/auth/signup-guards");
    }
  });
});
