import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/ui/format";
import { can } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import { IMAGE_PLACES, MEDIA_LIMIT_CEILING, MEDIA_LIMIT_FLOOR, VIDEO_PLACES, formatLimit, parseLimitRows, type MediaKind } from "@/lib/media/limits";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { MediaLimitRow } from "@/features/admin-ops/media-limit-row";

export const dynamic = "force-dynamic";

type EventRow = { id: number; at: string; kind: MediaKind; place: string; old_bytes: number; new_bytes: number; actor_id: string; reason: string };

/**
 * Upload size limits per place. `media_limits.view` (Administrator and higher) opens the page; the editors appear only for
 * `media_limits.manage` (Super Admin). The database decides on every read and every change (admin_media_limit_events,
 * admin_media_limit_set); the route rule and the hidden editors are convenience, never the gate.
 */
export default async function MediaLimitsPage() {
  const access = await requireAdminRoute("/admin/media-limits");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();

  const [limits, history] = await Promise.all([supabase.rpc("media_limits_get"), supabase.rpc("admin_media_limit_events", { p_limit: 30 })]);
  const header = <AdminHeader locale={locale} title={t("mediaLimits.title")} subtitle={t("mediaLimits.subtitle")} />;
  if (history.error?.code === "42501") return <StatePanel tone="danger" title={t("mediaLimits.errors.forbidden")} />;
  if (limits.error || history.error) return <div className="flex flex-col gap-lg">{header}<StatePanel tone="danger" title={t("mediaLimits.errors.unavailable")} /></div>;

  const rows = parseLimitRows(limits.data);
  const events = (history.data ?? []) as EventRow[];
  const canManage = can(access, "media_limits.manage");

  const actorIds = [...new Set(events.map((e) => e.actor_id))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
    for (const r of data ?? []) names.set(r.user_id, r.display_name);
  }
  const who = (id: string) => names.get(id) || id.slice(0, 8);
  // events arrive newest first: the first one per place is its latest change
  const lastChange = new Map<string, string>();
  for (const e of events) if (!lastChange.has(`${e.kind}:${e.place}`)) lastChange.set(`${e.kind}:${e.place}`, e.at);

  const section = (kind: MediaKind, places: readonly string[], title: string) => (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-md">
        {places.map((place) => {
          const row = rows.find((r) => r.kind === kind && r.place === place);
          if (!row) return null;
          const at = lastChange.get(`${kind}:${place}`);
          const label = t(`mediaLimits.place.${kind}.${place}`);
          return canManage ? (
            <MediaLimitRow
              key={`${kind}:${place}`}
              kind={kind}
              place={place}
              label={label}
              currentMb={formatLimit(row.maxBytes)}
              defaultMb={formatLimit(row.defaultBytes)}
              ceilingMb={formatLimit(MEDIA_LIMIT_CEILING[kind])}
              floorMb={formatLimit(MEDIA_LIMIT_FLOOR[kind])}
              changedLabel={at ? t("mediaLimits.changed", { when: formatDateTime(at, locale) }) : null}
            />
          ) : (
            <div key={`${kind}:${place}`} className="flex flex-wrap items-baseline justify-between gap-md border-b border-strong py-md" data-testid={`media-limit-${kind}-${place}`}>
              <span className="text-body font-medium text-fg">{label}</span>
              <span className="text-body text-fg" dir="ltr">{formatLimit(row.maxBytes)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-media-limits">
      {header}
      {canManage ? null : <StatePanel tone="neutral" title={t("mediaLimits.viewOnly")} />}
      {section("image", IMAGE_PLACES, t("mediaLimits.imagesTitle"))}
      {section("video", VIDEO_PLACES, t("mediaLimits.videosTitle"))}
      <ul className="list-disc ps-lg text-label text-fg-muted">
        <li>{t("mediaLimits.notes.ceiling")}</li>
        <li>{t("mediaLimits.notes.existing")}</li>
        <li>{t("mediaLimits.notes.browser")}</li>
      </ul>
      <Card>
        <SectionTitle>{t("mediaLimits.history.title")}</SectionTitle>
        {events.length === 0 ? (
          <p className="mt-md text-body text-fg-muted">{t("mediaLimits.history.empty")}</p>
        ) : (
          <ul className="mt-md flex flex-col gap-sm" data-testid="media-limit-history">
            {events.map((e) => (
              <li key={e.id} className="text-body text-fg">
                <span className="font-medium">{t(`mediaLimits.place.${e.kind}.${e.place}`)}</span>{" "}
                <span dir="ltr">{t("mediaLimits.history.from")} {formatLimit(e.old_bytes)} {t("mediaLimits.history.to")} {formatLimit(e.new_bytes)}</span>{" "}
                {t("mediaLimits.history.by")} {who(e.actor_id)} · <span className="text-fg-muted">{formatDateTime(e.at, locale)}</span>
                <span className="block text-label text-fg-muted" dir="auto">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
