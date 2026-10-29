"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/ui/format";
import { Badge, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Button, Textarea } from "@/components/ui/controls";
import { TableScroll } from "@/features/admin/parts";
import { sellerTransitionAction, type SellerTransition } from "@/server/actions/admin-marketplace";

export type SellerRow = {
  organizationId: string;
  organizationName: string;
  eligible: boolean;
  status: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  approvedByName: string | null;
  productsTotal: number;
  productsPublished: number;
  productsDraft: number;
};

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  approved: "success",
  pending: "warning",
  suspended: "warning",
  revoked: "danger",
};

/** The transitions the database allows from each state (mirrors app.marketplace_seller_transition). */
function allowed(status: string | null, eligible: boolean): SellerTransition[] {
  switch (status) {
    case null:
    case "pending":
      return eligible ? ["approve"] : [];
    case "approved":
      return ["suspend", "revoke"];
    case "suspended":
      return eligible ? ["reinstate", "revoke"] : ["revoke"];
    default:
      return [];
  }
}

export function SellersTable({ rows }: { rows: SellerRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState<{ org: string; action: SellerTransition } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    if (!open) return;
    setError(null);
    start(async () => {
      const r = await sellerTransitionAction(open.org, open.action, reason);
      if (!r.ok) {
        setError(t(`adminMarketplace.errors.${r.code in ERR ? r.code : "unexpected"}`));
        return;
      }
      setOpen(null);
      setReason("");
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
            const actions = allowed(r.status, r.eligible);
            const isOpen = open?.org === r.organizationId;
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
                  {r.statusReason ? <p className="mt-1 max-w-xs text-label text-fg-secondary">{r.statusReason}</p> : null}
                </td>
                <td className="px-md py-2.5 text-fg-secondary">
                  {r.eligible ? t("adminMarketplace.sellers.yes") : t("adminMarketplace.sellers.no")}
                </td>
                <td className="px-md py-2.5 text-end tabular-nums">{formatNumber(r.productsTotal, locale)}</td>
                <td className="px-md py-2.5 text-end tabular-nums">{formatNumber(r.productsPublished, locale)}</td>
                <td className="px-md py-2.5 text-end tabular-nums">{formatNumber(r.productsDraft, locale)}</td>
                <td className="px-md py-2.5 text-label text-fg-muted">
                  {r.statusChangedAt ? formatDate(r.statusChangedAt, locale) : "—"}
                </td>
                <td className="px-md py-2.5">
                  {isOpen ? (
                    <div className="flex w-64 flex-col gap-2">
                      <label className="text-label text-fg-secondary" htmlFor={`reason-${r.organizationId}`}>
                        {t("adminMarketplace.sellers.reasonLabel")}
                      </label>
                      <Textarea
                        id={`reason-${r.organizationId}`}
                        rows={2}
                        maxLength={500}
                        value={reason}
                        placeholder={t("adminMarketplace.sellers.reasonPlaceholder")}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      {error ? <InlineError>{error}</InlineError> : null}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={open.action === "revoke" || open.action === "suspend" ? "danger" : "primary"}
                          disabled={pending || reason.trim().length < 3}
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
                          variant={a === "revoke" || a === "suspend" ? "danger" : "outline"}
                          onClick={() => {
                            setOpen({ org: r.organizationId, action: a });
                            setReason("");
                            setError(null);
                            setDone(false);
                          }}
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

const ERR = { not_permitted: 1, reason_required: 1, transition_refused: 1, images_invalid: 1, unexpected: 1 };
