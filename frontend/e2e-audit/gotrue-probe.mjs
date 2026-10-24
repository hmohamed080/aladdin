// Verifies the PR #84 documented blocker on the DISPOSABLE fixture account only.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, "")]));
const fx = JSON.parse(readFileSync("../docs/qa/audits/2026-10-15-full-audit/traces/fixtures.json", "utf8"));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = (await admin.auth.admin.getUserById(fx.showroomUserId)).data.user.email;
const out = [];
for (let i = 0; i < 6; i++) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: `wrong-${i}-xxxxxxxx` }) });
  const j = await r.json().catch(() => ({}));
  out.push(`${r.status}:${j.error_code ?? j.code ?? j.error ?? "?"}`);
}
console.log("direct GoTrue wrong-password attempts:", out.join(" "));
