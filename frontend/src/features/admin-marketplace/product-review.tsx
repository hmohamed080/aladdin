"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { formatNumber } from "@/lib/ui/format";
import { Badge, Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Button, ButtonLink, Input, Select, Textarea } from "@/components/ui/controls";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { approveImagesAction, approveProductAction, rejectProductAction } from "@/server/actions/admin-marketplace";
import { PresetManager, type ReviewPreset } from "./review-preset-manager";

export type ReviewImage = {
  id: string;
  variant_id: string | null;
  sku: string | null;
  object_key: string;
  byte_size: number | null;
  is_primary: boolean;
  status: "pending" | "verified" | "rejected";
  content_valid: boolean | null;
  content_format: string | null;
  width_px: number | null;
  height_px: number | null;
  moderation_reason: string | null;
  replaces_image_id: string | null;
  previewUrl: string | null;
};

export type ReviewProduct = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  brand: string | null;
  status: string;
  organization_name: string;
  pending: number;
  verified: number;
  rejected: number;
  images: ReviewImage[];
};

export type ReviewTab = "pending" | "approved" | "rejected";
export type ReviewCounts = Record<ReviewTab, number>;

const KNOWN_ERRORS = new Set([
  "not_permitted",
  "reason_required",
  "images_invalid",
  "no_pending_images",
  "owner_message_required",
  "preset_not_found",
  "preset_invalid",
]);
const STATUS_TONE = { pending: "warning", verified: "success", rejected: "danger" } as const;
const REVIEW_PATH = "/admin/marketplace/media";

export function ProductReview({
  tab,
  page,
  pages,
  counts,
  products,
  presets,
  canManagePresets,
}: {
  tab: ReviewTab;
  page: number;
  pages: number;
  counts: ReviewCounts;
  products: ReviewProduct[];
  presets: ReviewPreset[];
  canManagePresets: boolean;
}) {
  const { t, locale } = useI18n();
  const activePresets = presets.filter((p) => p.is_active);

  return (
    <div className="flex flex-col gap-md">
      <nav className="flex gap-1 border-b" aria-label={t("adminMarketplace.media.title")}>
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <Link
            key={s}
            href={`${REVIEW_PATH}?status=${s}`}
            aria-current={s === tab ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-label font-medium",
              s === tab ? "border-accent text-fg" : "border-transparent text-fg-secondary hover:text-fg",
            )}
          >
            {t(`adminMarketplace.media.tabs.${s}`)}
            <span className="rounded-pill bg-surface-2 px-1.5 text-label tabular-nums">{formatNumber(counts[s], locale)}</span>
          </Link>
        ))}
      </nav>

      {products.length === 0 ? (
        <p className="py-xl text-center text-body text-fg-muted">{t("adminMarketplace.media.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-md">
          {products.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} presets={activePresets} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <ButtonLink size="sm" variant="outline" href={`${REVIEW_PATH}?status=${tab}&page=${page - 1}`}>
              {t("adminMarketplace.media.prev")}
            </ButtonLink>
          ) : null}
          <span className="text-label text-fg-muted">{t("adminMarketplace.media.page", { page, pages })}</span>
          {page < pages ? (
            <ButtonLink size="sm" variant="outline" href={`${REVIEW_PATH}?status=${tab}&page=${page + 1}`}>
              {t("adminMarketplace.media.next")}
            </ButtonLink>
          ) : null}
        </div>
      ) : null}

      {canManagePresets ? <PresetManager presets={presets} /> : null}
    </div>
  );
}

function ProductCard({ product, presets }: { product: ReviewProduct; presets: ReviewPreset[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [rejecting, setRejecting] = useState<{ ids: string[] | null } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const name = (locale === "ar" ? product.name_ar : product.name_en) || product.name_ar || product.name_en || "—";
  const statusKey = `adminMarketplace.media.productStatus.${product.status}`;
  const errorText = (code: string) => t(`adminMarketplace.errors.${KNOWN_ERRORS.has(code) ? code : "unexpected"}`);

  function summarize(results: { result: string }[]) {
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.result, (counts.get(r.result) ?? 0) + 1);
    const parts = [...counts].map(([k, n]) => {
      const key = `adminMarketplace.media.result.${k}`;
      const label = t(key);
      return `${formatNumber(n, locale)} ${label === key ? t("adminMarketplace.media.result.unexpected") : label}`;
    });
    return `${t("adminMarketplace.media.summary", { count: results.length })}: ${parts.join(" · ")}`;
  }

  function run(fn: () => Promise<{ ok: true; results: { result: string }[] } | { ok: false; code: string }>) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMessage({ ok: false, text: errorText(r.code) });
      setRejecting(null);
      setMessage({ ok: true, text: summarize(r.results) });
      router.refresh();
    });
  }

  return (
    <Card pad="sm" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-body-lg font-medium text-fg">{name}</h2>
          <p className="text-label text-fg-muted">
            {product.organization_name}
            {product.brand ? ` · ${product.brand}` : ""}
          </p>
          <div className="flex flex-wrap gap-1">
            <Badge>{t(statusKey) === statusKey ? product.status : t(statusKey)}</Badge>
            <Badge>{t("adminMarketplace.media.imageCount", { count: product.images.length })}</Badge>
            {product.pending > 0 ? <Badge tone="warning">{t("adminMarketplace.media.pendingCount", { count: product.pending })}</Badge> : null}
          </div>
        </div>
        {product.pending > 0 ? (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              disabled={pending}
              aria-label={`${t("adminMarketplace.media.approveAll")}: ${name}`}
              onClick={() => run(() => approveProductAction(product.id))}
            >
              <CheckIcon size={16} />
              {t("adminMarketplace.media.approveAll")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              aria-label={`${t("adminMarketplace.media.rejectAll")}: ${name}`}
              onClick={() => setRejecting({ ids: null })}
            >
              <XIcon size={16} />
              {t("adminMarketplace.media.rejectAll")}
            </Button>
          </div>
        ) : null}
      </div>

      <ul
        tabIndex={0}
        aria-label={t("adminMarketplace.media.strip", { name })}
        className="flex snap-x gap-sm overflow-x-auto pb-2"
      >
        {product.images.map((i) => (
          <li key={i.id} className="w-44 shrink-0 snap-start">
            <ImageTile
              image={i}
              name={name}
              busy={pending}
              onApprove={() => run(() => approveImagesAction([i.id]))}
              onExclude={() => setRejecting({ ids: [i.id] })}
            />
          </li>
        ))}
      </ul>

      {rejecting ? (
        <RejectPanel
          productId={product.id}
          name={name}
          imageIds={rejecting.ids}
          count={rejecting.ids ? rejecting.ids.length : product.pending}
          presets={presets}
          busy={pending}
          onCancel={() => setRejecting(null)}
          onSubmit={(input) => run(() => rejectProductAction({ productId: product.id, imageIds: rejecting.ids, ...input }))}
        />
      ) : null}

      {message ? (message.ok ? <InlineSuccess>{message.text}</InlineSuccess> : <InlineError>{message.text}</InlineError>) : null}
    </Card>
  );
}

function ImageTile({
  image: i,
  name,
  busy,
  onApprove,
  onExclude,
}: {
  image: ReviewImage;
  name: string;
  busy: boolean;
  onApprove: () => void;
  onExclude: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("flex h-full flex-col gap-1.5 rounded-sm border p-1.5", i.status === "rejected" && "opacity-80")}>
      <div className="relative aspect-square overflow-hidden rounded-sm bg-surface-2">
        {i.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
          <img src={i.previewUrl} alt={name} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <span className="grid h-full place-items-center text-label text-fg-muted">{t("adminMarketplace.media.noPreview")}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge tone={STATUS_TONE[i.status]}>{t(`adminMarketplace.media.state.${i.status}`)}</Badge>
        {i.is_primary ? <Badge tone="info">{t("adminMarketplace.media.primary")}</Badge> : null}
        {i.sku ? <Badge>{t("adminMarketplace.media.variant", { sku: i.sku })}</Badge> : null}
        {i.replaces_image_id ? <Badge tone="info">{t("adminMarketplace.media.replaces")}</Badge> : null}
        {i.content_valid === false ? <Badge tone="danger">{t("adminMarketplace.media.invalid")}</Badge> : null}
      </div>
      {i.width_px && i.height_px ? (
        <p className="text-label text-fg-muted tabular-nums" dir="ltr">
          {i.content_format ?? ""} {i.width_px}×{i.height_px} · {Math.round((i.byte_size ?? 0) / 1024)} KB
        </p>
      ) : null}
      {i.status === "rejected" && i.moderation_reason ? (
        <p className="line-clamp-3 text-label text-danger">{t("adminMarketplace.media.reason", { reason: i.moderation_reason })}</p>
      ) : null}
      <div className="mt-auto flex gap-1">
        {i.status !== "verified" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={`${t(i.status === "rejected" ? "adminMarketplace.media.reconsiderImage" : "adminMarketplace.media.approveImage")}: ${name}`}
            title={t(i.status === "rejected" ? "adminMarketplace.media.reconsiderImage" : "adminMarketplace.media.approveImage")}
            onClick={onApprove}
          >
            <CheckIcon size={16} />
          </Button>
        ) : null}
        {i.status !== "rejected" ? (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            aria-label={`${t("adminMarketplace.media.excludeImage")}: ${name}`}
            title={t("adminMarketplace.media.excludeImage")}
            onClick={onExclude}
          >
            <XIcon size={16} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RejectPanel({
  name,
  count,
  presets,
  busy,
  onCancel,
  onSubmit,
}: {
  productId: string;
  name: string;
  imageIds: string[] | null;
  count: number;
  presets: ReviewPreset[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { reason: string; ownerMessage: string; presetId: string | null }) => void;
}) {
  const { t, locale } = useI18n();
  const [reason, setReason] = useState("");
  const [presetId, setPresetId] = useState("");
  const [custom, setCustom] = useState("");
  const ready = reason.trim().length >= 3 && (presetId !== "" || custom.trim().length >= 3);
  const label = (p: ReviewPreset) => (locale === "ar" ? p.label_ar : p.label_en);
  const preview = presets.find((p) => p.id === presetId);

  return (
    <form
      className="flex flex-col gap-3 rounded-sm border border-danger/40 bg-danger/5 p-3"
      aria-label={t("adminMarketplace.media.reject.title", { count, name })}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit({ reason, ownerMessage: custom, presetId: presetId || null });
      }}
    >
      <p className="text-body font-medium text-fg">{t("adminMarketplace.media.reject.title", { count, name })}</p>
      <label className="flex flex-col gap-1 text-label text-fg-secondary">
        {t("adminMarketplace.media.reject.reason")}
        <Input
          value={reason}
          maxLength={300}
          placeholder={t("adminMarketplace.media.reject.reasonHint")}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-label text-fg-secondary">
        {t("adminMarketplace.media.reject.preset")}
        <Select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          <option value="">{t("adminMarketplace.media.reject.custom")}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {label(p)}
            </option>
          ))}
        </Select>
      </label>
      {preview ? (
        <p className="text-label text-fg-secondary">{locale === "ar" ? preview.message_ar : preview.message_en}</p>
      ) : (
        <label className="flex flex-col gap-1 text-label text-fg-secondary">
          {t("adminMarketplace.media.reject.message")}
          <Textarea
            rows={3}
            maxLength={300}
            value={custom}
            placeholder={t("adminMarketplace.media.reject.customPlaceholder")}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={busy || !ready}>
          {t("adminMarketplace.media.reject.confirm")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("adminMarketplace.media.reject.cancel")}
        </Button>
      </div>
    </form>
  );
}
