import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime, formatNumber } from "@/lib/ui/format";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { whatsappOtpDeliveryReconcile, whatsappOtpSettingsReconcile } from "@/lib/supabase/admin-server";
import { can } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import { appliedDeliveryRows, deliveryBlockers } from "@/server/whatsapp-otp/delivery-change";
import { appliedRows } from "@/server/whatsapp-otp/settings-change";
import { fetchUsage, type FailureWindow } from "@/server/whatsapp-otp/worker-admin";
import { resolveWorkerTransport } from "@/server/whatsapp-otp/worker-binding";
import { AdminHeader, StatTile } from "@/features/admin/parts";
import { Badge, Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { WhatsappOtpSettingsForm } from "@/features/admin-ops/whatsapp-otp-settings-form";
import { WhatsappOtpNotifyCheck } from "@/features/admin-ops/whatsapp-otp-notify-check";
import { WhatsappOtpDeliverySwitch } from "@/features/admin-ops/whatsapp-otp-delivery-switch";

export const dynamic = "force-dynamic";

const LEVEL_TONE = { ok: "success", warning: "warning", critical: "danger", exhausted: "danger" } as const;

/**
 * WhatsApp verification-code limits. `whatsapp_otp.view` (Administrator and higher) opens the page; the form appears only for
 * `whatsapp_otp.manage` (Super Admin). The permission is judged by the database (admin_whatsapp_otp_view_check) before anything is read
 * from the Worker, and every change goes through the server action, which re-checks everything.
 */
export default async function WhatsappOtpPage() {
  const access = await requireAdminRoute("/admin/whatsapp-otp");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();

  const { error: denied } = await supabase.rpc("admin_whatsapp_otp_view_check");
  if (denied) return <StatePanel tone="danger" title={t("whatsappOtp.errors.forbidden")} />;

  const env = readPhoneVerificationEnv();
  const route = resolveWorkerTransport();
  const result = route.ok ? await fetchUsage({ workerUrl: env.workerUrl, adminSecret: env.adminSecret, fetchImpl: route.fetchImpl }) : ({ ok: false } as const);

  const header = <AdminHeader locale={locale} title={t("whatsappOtp.title")} subtitle={t("whatsappOtp.subtitle")} />;
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-lg" data-testid="admin-whatsapp-otp">
        {header}
        <StatePanel tone="danger" title={t("whatsappOtp.unavailable")} />
      </div>
    );
  }
  const usage = result.usage;

  // Settle any change the Worker applied but Supabase never completed, from the Worker's own authoritative record. Best effort.
  await whatsappOtpSettingsReconcile(appliedRows(usage)).catch(() => undefined);
  await whatsappOtpDeliveryReconcile(appliedDeliveryRows(usage), usage.delivery_drift ?? null).catch(() => undefined);

  // Display names for the history (RLS decides what an administrator may read; the id prefix is the fallback).
  const actorIds = [...new Set(usage.audit.map((a) => a.actor))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
    for (const r of data ?? []) names.set(r.user_id, r.display_name);
  }
  const who = (id: string) => names.get(id) || id.slice(0, 8);

  const s = usage.settings;
  const runtime = usage.runtime;
  const bindingsReady = runtime ? ["signing_secret_bound", "admin_secret_bound", "admin_grant_secret_bound", "notify_configured", "meta_token_bound", "d1_reachable"].every((k) => runtime[k] === true) : false;
  const canManage = can(access, "whatsapp_otp.manage");
  // The switch is the Worker's persisted flag (never browser state). A Worker without it reports no state and cannot be switched from here.
  const delivery = usage.delivery;
  const deliveryOn = runtime ? runtime.delivery_enabled === true : false;
  const blockers = deliveryBlockers(usage);
  // One line of helper text for everyone: what ON/OFF means now, or (Super Admin, switch off) what still blocks turning it on.
  const deliveryHelp =
    canManage && delivery && !delivery.enabled && blockers.length > 0
      ? t("whatsappOtp.delivery.blockedHelp", { items: blockers.map((b) => t(`whatsappOtp.delivery.blockers.${b}`)).join(" · ") })
      : t(deliveryOn ? "whatsappOtp.delivery.onHelp" : delivery?.enabled ? "whatsappOtp.delivery.offByEnvironmentHelp" : "whatsappOtp.delivery.offHelp");
  const canCeiling = can(access, "whatsapp_otp.ceiling_manage");
  const n = (v: number) => formatNumber(v, locale);
  const window = (label: string, w: FailureWindow) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-fg-muted">{label}</span>
      <span className="text-body text-fg">
        {w.attempts === 0 ? t("whatsappOtp.failure.none") : t("whatsappOtp.failure.rate", { failed: n(w.failed), attempts: n(w.attempts), percent: n(w.failure_percent ?? 0) })}
      </span>
    </div>
  );
  const fmt = (v: { daily_limit: number; hard_ceiling: number; warn_percent: number; critical_percent: number }) =>
    `${n(v.daily_limit)} / ${n(v.hard_ceiling)} · ${n(v.warn_percent)}% / ${n(v.critical_percent)}%`;

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-whatsapp-otp">
      {header}
      {!usage.configured || !s ? <StatePanel tone="warning" title={t("whatsappOtp.notConfigured")} /> : null}

      {s ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <SectionTitle>{t("whatsappOtp.usage.title")}</SectionTitle>
            <Badge tone={LEVEL_TONE[usage.level]}>{t(`whatsappOtp.usage.level.${usage.level}`)}</Badge>
          </div>
          <p className="mt-xs text-label text-fg-muted">{t("whatsappOtp.usage.percent", { percent: n(usage.percent) })}</p>
          <div className="mt-md grid gap-sm sm:grid-cols-3 lg:grid-cols-6">
            <StatTile locale={locale} label={t("whatsappOtp.usage.consumed")} value={usage.consumed} />
            <StatTile locale={locale} label={t("whatsappOtp.usage.remaining")} value={usage.remaining} />
            <StatTile locale={locale} label={t("whatsappOtp.usage.accepted")} value={usage.accepted} />
            <StatTile locale={locale} label={t("whatsappOtp.usage.failed")} value={usage.failed} />
            <StatTile locale={locale} label={t("whatsappOtp.usage.reserved")} value={usage.reserved} />
            <StatTile locale={locale} label={t("whatsappOtp.usage.limit")} value={s.daily_limit} hint={`${t("whatsappOtp.usage.ceiling")}: ${n(s.hard_ceiling)}`} />
          </div>
        </Card>
      ) : null}

      {runtime ? (
        <Card>
          <SectionTitle>{t("whatsappOtp.runtime.title")}</SectionTitle>
          <div className="mt-md grid gap-md sm:grid-cols-4" data-testid="whatsapp-otp-runtime">
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-fg-muted">{t("whatsappOtp.runtime.environment")}</span>
              <span className="text-body text-fg" dir="ltr">{String(runtime.environment ?? "")}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-fg-muted">{t("whatsappOtp.runtime.delivery")}</span>
              {canManage && delivery ? (
                <div className="flex items-center gap-sm">
                  <WhatsappOtpDeliverySwitch enabled={delivery.enabled} version={delivery.version} blockers={blockers} />
                  <Badge tone={deliveryOn ? "success" : "warning"}>{t(deliveryOn ? "whatsappOtp.runtime.deliveryOn" : "whatsappOtp.runtime.deliveryOff")}</Badge>
                </div>
              ) : (
                <Badge tone={deliveryOn ? "success" : "warning"}>{t(deliveryOn ? "whatsappOtp.runtime.deliveryOn" : "whatsappOtp.runtime.deliveryOff")}</Badge>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-fg-muted">{t("whatsappOtp.runtime.recipients")}</span>
              <span className="text-body text-fg">{runtime.recipient_mode === "open" ? t("whatsappOtp.runtime.recipientsOpen") : t("whatsappOtp.runtime.recipientsList", { count: n(Number(runtime.allowlist_entries ?? 0)) })}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-fg-muted">{t("whatsappOtp.runtime.bindings")}</span>
              <Badge tone={bindingsReady ? "success" : "danger"}>{t(bindingsReady ? "whatsappOtp.runtime.ready" : "whatsappOtp.runtime.missing")}</Badge>
            </div>
          </div>
          <p id="otp-delivery-help" className="mt-md text-label text-fg-muted" data-testid="whatsapp-otp-delivery-help">{deliveryHelp}</p>
          {canManage ? <WhatsappOtpNotifyCheck /> : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t("whatsappOtp.failure.title")}</SectionTitle>
        <div className="mt-md grid gap-md sm:grid-cols-3">
          {window(t("whatsappOtp.failure.lastHour"), usage.failure.last_hour)}
          {window(t("whatsappOtp.failure.last24h"), usage.failure.last_24h)}
          {window(t("whatsappOtp.failure.last7d"), usage.failure.last_7d)}
        </div>
      </Card>

      {canManage ? (
        <WhatsappOtpSettingsForm
          version={s?.version ?? 0}
          values={s ? { daily_limit: s.daily_limit, hard_ceiling: s.hard_ceiling, warn_percent: s.warn_percent, critical_percent: s.critical_percent } : null}
          canManageCeiling={canCeiling}
        />
      ) : (
        <StatePanel title={t("whatsappOtp.viewOnly")} />
      )}

      <Card>
        <SectionTitle>{t("whatsappOtp.history.title")}</SectionTitle>
        {usage.audit.length === 0 ? (
          <p className="mt-md text-body text-fg-secondary">{t("whatsappOtp.history.empty")}</p>
        ) : (
          <ul className="mt-md flex flex-col gap-sm" data-testid="whatsapp-otp-history">
            {usage.audit.map((a) => (
              <li key={a.request_id} className="flex flex-col gap-0.5 border-b pb-sm last:border-b-0">
                <span className="text-body text-fg" dir="ltr">
                  {a.old ? t("whatsappOtp.history.change", { from: fmt(a.old), to: fmt(a.new) }) : `${t("whatsappOtp.history.initial")}: ${fmt(a.new)}`}
                </span>
                <span className="text-label text-fg-muted">
                  {t("whatsappOtp.history.by", { actor: who(a.actor) })} · {formatDateTime(new Date(a.at * 1000).toISOString(), locale)} · <span dir="auto">{a.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
