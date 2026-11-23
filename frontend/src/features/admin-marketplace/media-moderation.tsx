"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { formatNumber } from "@/lib/ui/format";
import { Badge, Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Button, ButtonLink, Input } from "@/components/ui/controls";
import {
  approveImagesAction,
  rejectImagesAction,
  setMediaReadyAction,
  validateImagesAction,
} from "@/server/actions/admin-marketplace";

export type MediaItem = {
  id: string;
  product_id: string;
  variant_id: string | null;
  object_key: string;
  mime_type: string | null;
  byte_size: number | null;
  is_primary: boolean;
  status: string;
  content_valid: boolean | null;
  content_format: string | null;
  content_checked_at: string | null;
  width_px: number | null;
  height_px: number | null;
  moderation_reason: string | null;
  product_name_ar: string | null;
  product_name_en: string | null;
  product_status: string;
  sku: string | null;
  organization_name: string;
  previewUrl: string | null;
};

export type MediaSettings = {
  media_verification_ready: boolean;
  pending: number;
  verified: number;
  rejected: number;
};

const KNOWN_ERRORS = new Set(["not_permitted", "reason_required", "transition_refused", "images_invalid"]);

export function MediaModeration({
  status,
  page,
  pages,
  settings,
  items,
}: {
  status: "pending" | "verified" | "rejected";
  page: number;
  pages: number;
  settings: MediaSettings;
  items: MediaItem[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectReason, setRejectReason] = useState("");
  const [readyReason, setReadyReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const errorText = (code: string) => t(`adminMarketplace.errors.${KNOWN_ERRORS.has(code) ? code : "unexpected"}`);
  const ids = [...selected];

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function summarize(results: { result?: string; code?: string }[]) {
    const counts = new Map<string, number>();
    for (const r of results) {
      const k = r.result ?? r.code ?? "unexpected";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const parts = [...counts].map(([k, n]) => {
      const key = `adminMarketplace.media.result.${k}`;
      const label = t(key);
      return `${formatNumber(n, locale)} ${label === key ? t("adminMarketplace.media.result.unexpected") : label}`;
    });
    return `${t("adminMarketplace.media.summary", { count: results.length })}: ${parts.join(" · ")}`;
  }

  function run(fn: () => Promise<{ ok: boolean; code?: string; text?: string }>) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: r.text ?? "" } : { ok: false, text: errorText(r.code ?? "unexpected") });
      if (r.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  const tabs = (["pending", "verified", "rejected"] as const).map((s) => ({
    s,
    count: settings[s],
  }));

  return (
    <div className="flex flex-col gap-md">
      <Card pad="sm" className="flex flex-col gap-2 tablet:flex-row tablet:items-end tablet:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-label text-fg-muted">{t("adminMarketplace.media.ready")}</span>
          <span className="flex items-center gap-2 text-body font-medium text-fg">
            <span
              aria-hidden="true"
              className={cn("h-2.5 w-2.5 rounded-pill", settings.media_verification_ready ? "bg-success" : "bg-warning")}
            />
            {settings.media_verification_ready ? t("adminMarketplace.media.readyOn") : t("adminMarketplace.media.readyOff")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64 max-w-full">
            <Input
              aria-label={t("adminMarketplace.media.readyReason")}
              placeholder={t("adminMarketplace.media.readyReason")}
              value={readyReason}
              maxLength={300}
              onChange={(e) => setReadyReason(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant={settings.media_verification_ready ? "danger" : "primary"}
            disabled={pending || readyReason.trim().length < 3}
            onClick={() =>
              run(async () => {
                const r = await setMediaReadyAction(!settings.media_verification_ready, readyReason);
                if (r.ok) setReadyReason("");
                return r.ok ? { ok: true } : { ok: false, code: r.code };
              })
            }
          >
            {settings.media_verification_ready ? t("adminMarketplace.media.turnOff") : t("adminMarketplace.media.turnOn")}
          </Button>
        </div>
      </Card>

      <nav className="flex gap-1 border-b" aria-label={t("adminMarketplace.media.title")}>
        {tabs.map(({ s, count }) => (
          <Link
            key={s}
            href={`/admin/marketplace/media?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-label font-medium",
              s === status ? "border-accent text-fg" : "border-transparent text-fg-secondary hover:text-fg",
            )}
          >
            {t(`adminMarketplace.media.tabs.${s}`)}
            <span className="rounded-pill bg-surface-2 px-1.5 text-label tabular-nums">{formatNumber(Number(count), locale)}</span>
          </Link>
        ))}
      </nav>

      {items.length > 0 && status !== "rejected" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}
          >
            {t("adminMarketplace.media.selectAll")}
          </Button>
          <span className="text-label text-fg-muted">{t("adminMarketplace.media.selected", { count: selected.size })}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !ids.length}
            onClick={() =>
              run(async () => {
                const r = await validateImagesAction(ids);
                return r.ok ? { ok: true, text: summarize(r.results.map((x) => ({ code: x.valid ? "valid" : "invalid" }))) } : { ok: false, code: r.code };
              })
            }
          >
            {t("adminMarketplace.media.validate")}
          </Button>
          {status === "pending" ? (
            <Button
              size="sm"
              disabled={pending || !ids.length}
              onClick={() =>
                run(async () => {
                  const r = await approveImagesAction(ids);
                  return r.ok ? { ok: true, text: summarize(r.results) } : { ok: false, code: r.code };
                })
              }
            >
              {t("adminMarketplace.media.approve")}
            </Button>
          ) : null}
          <div className="w-56 max-w-full">
            <Input
              aria-label={t("adminMarketplace.media.rejectReason")}
              placeholder={t("adminMarketplace.media.rejectReason")}
              value={rejectReason}
              maxLength={300}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="danger"
            disabled={pending || !ids.length || rejectReason.trim().length < 3}
            onClick={() =>
              run(async () => {
                const r = await rejectImagesAction(ids, rejectReason);
                if (r.ok) setRejectReason("");
                return r.ok ? { ok: true, text: summarize(r.results) } : { ok: false, code: r.code };
              })
            }
          >
            {t("adminMarketplace.media.reject")}
          </Button>
        </div>
      ) : null}

      {message ? message.ok ? <InlineSuccess>{message.text}</InlineSuccess> : <InlineError>{message.text}</InlineError> : null}

      {items.length === 0 ? (
        <p className="py-xl text-center text-body text-fg-muted">{t("adminMarketplace.media.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 desktop:grid-cols-4">
          {items.map((i) => {
            const name = (locale === "ar" ? i.product_name_ar : i.product_name_en) || i.product_name_ar || i.product_name_en || "—";
            const isSel = selected.has(i.id);
            return (
              <li key={i.id}>
                <Card pad="sm" className={cn("flex h-full flex-col gap-2", isSel && "ring-2 ring-accent")}>
                  <div className="relative aspect-square overflow-hidden rounded-sm bg-surface-2">
                    {i.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
                      <img src={i.previewUrl} alt={name} className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <span className="grid h-full place-items-center text-label text-fg-muted">{t("adminMarketplace.media.noPreview")}</span>
                    )}
                    {status !== "rejected" ? (
                      <span className="absolute start-2 top-2 rounded-sm bg-surface/90 p-1">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(i.id)}
                          aria-label={name}
                          className="block h-4.5 w-4.5 accent-[var(--accent-solid)]"
                        />
                      </span>
                    ) : null}
                  </div>
                  <p className="line-clamp-2 text-label font-medium text-fg">{name}</p>
                  <p className="text-label text-fg-muted">{i.organization_name}</p>
                  <div className="flex flex-wrap gap-1">
                    {i.is_primary ? <Badge tone="info">{t("adminMarketplace.media.primary")}</Badge> : null}
                    {i.sku ? <Badge>{t("adminMarketplace.media.variant", { sku: i.sku })}</Badge> : null}
                    {i.content_valid === null ? (
                      <Badge>{t("adminMarketplace.media.notChecked")}</Badge>
                    ) : i.content_valid ? (
                      <Badge tone="success">{t("adminMarketplace.media.valid")}</Badge>
                    ) : (
                      <Badge tone="danger">{t("adminMarketplace.media.invalid")}</Badge>
                    )}
                  </div>
                  {i.width_px && i.height_px ? (
                    <p className="text-label text-fg-muted tabular-nums" dir="ltr">
                      {i.content_format ?? ""} {i.width_px}×{i.height_px} · {Math.round((i.byte_size ?? 0) / 1024)} KB
                    </p>
                  ) : null}
                  {i.moderation_reason ? (
                    <p className="text-label text-danger">{t("adminMarketplace.media.reason", { reason: i.moderation_reason })}</p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <ButtonLink size="sm" variant="outline" href={`/admin/marketplace/media?status=${status}&page=${page - 1}`}>
              {t("adminMarketplace.media.prev")}
            </ButtonLink>
          ) : null}
          <span className="text-label text-fg-muted">{t("adminMarketplace.media.page", { page, pages })}</span>
          {page < pages ? (
            <ButtonLink size="sm" variant="outline" href={`/admin/marketplace/media?status=${status}&page=${page + 1}`}>
              {t("adminMarketplace.media.next")}
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
