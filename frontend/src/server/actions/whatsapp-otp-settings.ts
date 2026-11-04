"use server";

import { revalidatePath } from "next/cache";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { whatsappOtpSettingsBegin, whatsappOtpSettingsFinish } from "@/lib/supabase/admin-server";
import { getCurrentUser } from "@/server/auth/session";
import { loadAdminAccess } from "@/server/authorization/admin";
import type { FormState } from "@/server/actions/sales-forms";
import { changeSettings } from "@/server/whatsapp-otp/settings-change";
import { applySettings, fetchUsage, probeNotify } from "@/server/whatsapp-otp/worker-admin";
import { resolveWorkerTransport } from "@/server/whatsapp-otp/worker-binding";

/**
 * Super Admin: change the WhatsApp OTP Daily Limit, Hard Ceiling and alert thresholds. The actor is ALWAYS the verified session user and
 * the permissions are loaded on the server; nothing identity-related is read from the form. Next.js checks the Origin of every Server
 * Action, which is the CSRF protection here. The ordering and every refusal live in server/whatsapp-otp/settings-change.ts.
 */
const INT = /^[0-9]{1,7}$/;
const num = (fd: FormData, key: string): number => {
  const v = String(fd.get(key) ?? "").trim();
  return INT.test(v) ? Number(v) : Number.NaN;
};

export async function saveWhatsappOtpSettingsAction(_p: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "whatsappOtp.errors.forbidden" };
  const access = await loadAdminAccess();
  if (!access.isStaff) return { ok: false, code: "whatsappOtp.errors.forbidden" };

  const env = readPhoneVerificationEnv();
  // Production reaches the Worker only through its private service binding; no binding there means unavailable, never a public URL.
  const route = resolveWorkerTransport();
  if (!route.ok) return { ok: false, code: "whatsappOtp.errors.unavailable" };
  const config = { workerUrl: env.workerUrl, adminSecret: env.adminSecret, fetchImpl: route.fetchImpl };
  const result = await changeSettings(
    {
      fetchUsage: () => fetchUsage(config),
      begin: (a) => whatsappOtpSettingsBegin({ actor: a.actor, expectedVersion: a.expectedVersion, old: a.old, next: a.next, reason: a.reason }),
      apply: (payload) => applySettings(config, payload),
      finish: (a) => whatsappOtpSettingsFinish(a),
    },
    {
      actorId: user.id,
      permissions: access.permissions,
      formVersion: num(fd, "version"),
      dailyLimit: num(fd, "daily_limit"),
      hardCeiling: num(fd, "hard_ceiling"),
      warnPercent: num(fd, "warn_percent"),
      criticalPercent: num(fd, "critical_percent"),
      reason: String(fd.get("reason") ?? ""),
      ceilingConfirmation: String(fd.get("ceiling_confirmation") ?? ""),
    },
  );
  // Refresh on every outcome: a stale or refused change must show the CURRENT numbers next to the message.
  revalidatePath("/admin/whatsapp-otp");
  return result;
}

/**
 * Super Admin: release-gate check that the Worker can reach this app's alert endpoint (including Cloudflare WAF / bot protection on the way).
 * It sends one signed, deliberately invalid probe from the Worker and reports a category only. Nothing is stored and nobody is notified.
 */
export async function checkWhatsappOtpAlertPathAction(_p: FormState, _fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "whatsappOtp.errors.forbidden" };
  const access = await loadAdminAccess();
  if (!access.isStaff || !access.permissions.includes("whatsapp_otp.manage")) return { ok: false, code: "whatsappOtp.errors.forbidden" };
  const env = readPhoneVerificationEnv();
  const route = resolveWorkerTransport();
  if (!route.ok) return { ok: false, code: "whatsappOtp.errors.unavailable" };
  const out = await probeNotify({ workerUrl: env.workerUrl, adminSecret: env.adminSecret, fetchImpl: route.fetchImpl });
  if (!out.ok) return { ok: false, code: "whatsappOtp.errors.unavailable" };
  return { ok: out.result === "reachable", code: `whatsappOtp.notifyCheck.${out.result}` };
}
