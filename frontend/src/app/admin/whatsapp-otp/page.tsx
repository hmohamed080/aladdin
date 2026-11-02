import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime, formatNumber } from "@/lib/ui/format";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { whatsappOtpSettingsReconcile } from "@/lib/supabase/admin-server";
import { can } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import { appliedRows } from "@/server/whatsapp-otp/settings-change";
import { fetchUsage, type FailureWindow } from "@/server/whatsapp-otp/worker-admin";
import { AdminHeader, StatTile } from "@/features/admin/parts";
import { Badge, Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { WhatsappOtpSettingsForm } from "@/features/admin-ops/whatsapp-otp-settings-form";

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
  const result = await fetchUsage({ workerUrl: env.workerUrl, adminSecret: env.adminSecret });

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

  // Display names for the history (RLS decides what an administrator may read; the id prefix is the fallback).
  const actorIds = [...new Set(usage.audit.map((a) => a.actor))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
    for (const r of data ?? []) names.set(r.user_id, r.display_name);
  }
  const who = (id: string) => names.get(id) || id.slice(0, 8);

  const s = usage.settings;
  const canManage = can(access, "whatsapp_otp.manage");
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
