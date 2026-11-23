"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/ui/format";
import { Badge, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Button, Select, Textarea } from "@/components/ui/controls";
import { TableScroll } from "@/features/admin/parts";
import { sellerTransitionAction, type SellerTransition } from "@/server/actions/admin-marketplace";
import {
  OWNER_MESSAGE_MAX,
  allowedTransitions,
  eligibilityIssues,
  reasonRequired,
  type PresetRow,
} from "./seller-model";

export type SellerRow = {
  organizationId: string;
  organizationName: string;
  eligible: boolean;
  orgType: string;
  orgStatus: string;
  orgDeleted: boolean;
  status: string | null;
  statusReason: string | null;
  ownerMessage: string | null;
  statusChangedAt: string | null;
  requestedAt: string | null;
  approvedByName: string | null;
  productsTotal: number;
  productsPublished: number;
  productsDraft: number;
};

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  approved: "success",
  pending: "warning",
  suspended: "warning",
  rejected: "danger",
  revoked: "danger",
};

const DANGER_ACTIONS: ReadonlySet<SellerTransition> = new Set(["revoke", "suspend", "reject"]);
const ERR = new Set(["not_permitted", "reason_required", "transition_refused", "message_invalid", "images_invalid", "unexpected"]);
/** Select value for "write my own message". */
const OTHER = "__other__";

export function SellersTable({ rows, presets }: { rows: SellerRow[]; presets: PresetRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState<{ org: string; action: SellerTransition } | null>(null);
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const needsReason = open ? reasonRequired(open.action) : false;
  const reasonOk = !needsReason || reason.trim().length >= 3;
  const customOk = choice !== OTHER || custom.trim().length > 0;
  const options = open ? presets.filter((p) => p.isActive && p.action === open.action) : [];

  function begin(org: string, action: SellerTransition) {
    setOpen({ org, action });
    setReason("");
    setChoice("");
    setCustom("");
    setError(null);
    setDone(false);
  }

  function submit() {
    if (!open) return;
    setError(null);
    start(async () => {
      const r = await sellerTransitionAction(open.org, open.action, {
        reason,
        presetId: choice && choice !== OTHER ? choice : null,
        message: choice === OTHER ? custom : null,
      });
      if (!r.ok) {
        setError(t(`adminMarketplace.errors.${ERR.has(r.code) ? r.code : "unexpected"}`));
        return;
      }
      setOpen(null);
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-sm">
      {done ? <InlineSuccess>{t("adminMarketplace.sellers.done")}</InlineSuccess> : null}
      <TableScroll>
        <thead>
          <tr className="border-b bg-surface-2/40 text-label text-fg-muted">
            <th className="px-md py-2 text-start font-medium">{t("adminMarketplace.sellers.organization")}</th>
            <th className="px-md py-2 text-start font-medium">{t("adminMarketplace.sellers.status")}</th>
            <th className="px-md py-2 text-start font-medium">{t("adminMarketplace.sellers.eligible")}</th>
            <th className="px-md py-2 text-end font-medium">{t("adminMarketplace.sellers.products")}</th>
            <th className="px-md py-2 text-end font-medium">{t("adminMarketplace.sellers.published")}</th>
            <th className="px-md py-2 text-end font-medium">{t("adminMarketplace.sellers.drafts")}</th>
            <th className="px-md py-2 text-start font-medium">{t("adminMarketplace.sellers.lastChange")}</th>
            <th className="px-md py-2 text-start font-medium">{t("adminMarketplace.sellers.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const actions = allowedTransitions(r.status, r.eligible);
            const isOpen = open?.org === r.organizationId;
            const issues = eligibilityIssues(r);
            const why = issues.length ? issues.map((i) => t(`adminMarketplace.sellers.issue.${i}`)).join(" ") : "";
            return (
              <tr key={r.organizationId} className="border-b align-top last:border-0">
                <td className="px-md py-2.5 font-medium text-fg">{r.organizationName}</td>
                <td className="px-md py-2.5">
                  <Badge tone={r.status ? (TONE[r.status] ?? "neutral") : "neutral"}>
                    {r.status ? t(`adminMarketplace.sellers.statusLabel.${r.status}`) : t("adminMarketplace.sellers.notEnrolled")}
                  </Badge>
                  {r.approvedByName && r.status === "approved" ? (
                    <p className="mt-1 text-label text-fg-muted">{t("adminMarketplace.sellers.approvedBy", { name: r.approvedByName })}</p>
                  ) : null}
                  {r.status === "pending" && r.requestedAt ? (
                    <p className="mt-1 text-label text-fg-muted">{t("adminMarketplace.sellers.requestedAt", { date: formatDate(r.requestedAt, locale) })}</p>
                  ) : null}
                  {r.statusReason ? (
                    <p className="mt-1 max-w-xs text-label text-fg-secondary" dir="auto">
                      <span className="text-fg-muted">{t("adminMarketplace.sellers.internalReason")}: </span>
                      {r.statusReason}
                    </p>
                  ) : null}
                  {r.ownerMessage ? (
                    <p className="mt-1 max-w-xs text-label text-fg-secondary" dir="auto">
                      <span className="text-fg-muted">{t("adminMarketplace.sellers.ownerMessage")}: </span>
                      {r.ownerMessage}
                    </p>
                  ) : null}
                </td>
                <td className="px-md py-2.5 text-fg-secondary">
                  {r.eligible ? (
                    t("adminMarketplace.sellers.yes")
                  ) : (
                    // hover (and keyboard focus) shows what is missing
                    <span
                      tabIndex={0}
                      title={why}
                      aria-label={`${t("adminMarketplace.sellers.no")}. ${why}`}
                      data-testid={`eligibility-${r.organizationId}`}
                      className="cursor-help underline decoration-dotted underline-offset-4"
                    >
                      {t("adminMarketplace.sellers.no")}
                    </span>
                  )}
                </td>
                <td className="px-md py-2.5 text-end tabular-nums">{formatNumber(r.productsTotal, locale)}</td>
                <td className="px-md py-2.5 text-end tabular-nums">{formatNumber(r.productsPublished, locale)}</td>
                <td className="px-md py-2.5 text-end tabular-nums">{formatNumber(r.productsDraft, locale)}</td>
                <td className="px-md py-2.5 text-label text-fg-muted">
                  {r.statusChangedAt ? formatDate(r.statusChangedAt, locale) : "—"}
                </td>
                <td className="px-md py-2.5">
                  {isOpen && open ? (
                    <div className="flex w-72 flex-col gap-2">
                      <label className="text-label text-fg-secondary" htmlFor={`reason-${r.organizationId}`}>
                        {t(needsReason ? "adminMarketplace.sellers.reasonLabel" : "adminMarketplace.sellers.reasonLabelOptional")}
                      </label>
                      <Textarea
                        id={`reason-${r.organizationId}`}
                        rows={2}
                        maxLength={500}
                        value={reason}
                        placeholder={t("adminMarketplace.sellers.reasonPlaceholder")}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <p className="text-label text-fg-muted">{t("adminMarketplace.sellers.reasonInternalHint")}</p>
                      <label className="text-label text-fg-secondary" htmlFor={`message-${r.organizationId}`}>
                        {t("adminMarketplace.sellers.messageLabel")}
                      </label>
                      <Select id={`message-${r.organizationId}`} value={choice} onChange={(e) => setChoice(e.target.value)}>
                        <option value="">{t("adminMarketplace.sellers.messageNone")}</option>
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>
                            {locale === "ar" ? p.labelAr : p.labelEn}
                          </option>
                        ))}
                        <option value={OTHER}>{t("adminMarketplace.sellers.messageOther")}</option>
                      </Select>
                      {choice && choice !== OTHER ? (
                        <p className="text-label text-fg-secondary" dir="auto" data-testid="preset-preview">
                          {(() => {
                            const p = options.find((x) => x.id === choice);
                            return p ? (locale === "ar" ? p.textAr : p.textEn) : "";
                          })()}
                        </p>
                      ) : null}
                      {choice === OTHER ? (
                        <Textarea
                          rows={2}
                          maxLength={OWNER_MESSAGE_MAX}
                          value={custom}
                          aria-label={t("adminMarketplace.sellers.messageLabel")}
                          placeholder={t("adminMarketplace.sellers.messageCustomPlaceholder")}
                          onChange={(e) => setCustom(e.target.value)}
                        />
                      ) : null}
                      {error ? <InlineError>{error}</InlineError> : null}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={DANGER_ACTIONS.has(open.action) ? "danger" : "primary"}
                          disabled={pending || !reasonOk || !customOk}
                          onClick={submit}
                        >
                          {t(`adminMarketplace.sellers.action.${open.action}`)} · {t("adminMarketplace.sellers.confirm")}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(null)}>
                          {t("adminMarketplace.sellers.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map((a) => (
                        <Button
                          key={a}
                          size="sm"
                          variant={DANGER_ACTIONS.has(a) ? "danger" : "outline"}
                          onClick={() => begin(r.organizationId, a)}
                        >
                          {t(`adminMarketplace.sellers.action.${a}`)}
                        </Button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableScroll>
    </div>
  );
}
