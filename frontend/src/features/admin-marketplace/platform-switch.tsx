"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { Card } from "@/components/ui/primitives";
import { Button, Input } from "@/components/ui/controls";
import { setMarketplaceOpenAction } from "@/server/actions/admin-marketplace";

export type PlatformStatus = {
  open: boolean;
  canManage: boolean;
  lastChange: { action: string; at: string; reason: string | null; actorName: string | null } | null;
};

const KNOWN_ERRORS = new Set(["not_permitted", "reason_required"]);

/**
 * The Marketplace on/off switch. Closing hides the whole public Marketplace (catalogue, product pages, cart, checkout);
 * sellers keep working. Every change needs a reason and is recorded with the acting admin; the last change is shown here.
 */
export function PlatformSwitch({ status }: { status: PlatformStatus }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const change = () => {
    setMessage(null);
    start(async () => {
      const r = await setMarketplaceOpenAction(!status.open, reason);
      if (!r.ok) {
        setMessage({ ok: false, text: t(`adminMarketplace.errors.${KNOWN_ERRORS.has(r.code) ? r.code : "unexpected"}`) });
        return;
      }
      setReason("");
      setMessage({ ok: true, text: t("adminMarketplace.platform.done") });
      router.refresh();
    });
  };

  const last = status.lastChange;
  return (
    <Card pad="sm" className="flex flex-col gap-sm" data-testid="platform-switch">
      <div className="flex flex-col gap-0.5">
        <span className="text-label text-fg-muted">{t("adminMarketplace.platform.title")}</span>
        <span className="flex items-center gap-2 text-body font-medium text-fg">
          <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-pill", status.open ? "bg-success" : "bg-danger")} />
          {status.open ? t("adminMarketplace.platform.open") : t("adminMarketplace.platform.closed")}
        </span>
        {last ? (
          <span className="text-label text-fg-muted">
            {t("adminMarketplace.platform.lastChange", {
              who: last.actorName ?? t("adminMarketplace.platform.unknownAdmin"),
              when: new Date(last.at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB"),
            })}
            {last.reason ? ` — ${last.reason}` : ""}
          </span>
        ) : null}
      </div>
      {status.canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72 max-w-full">
            <Input
              aria-label={t("adminMarketplace.platform.reason")}
              placeholder={t("adminMarketplace.platform.reason")}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button size="sm" variant={status.open ? "danger" : "primary"} disabled={pending || reason.trim().length < 3} onClick={change}>
            {status.open ? t("adminMarketplace.platform.close") : t("adminMarketplace.platform.reopen")}
          </Button>
        </div>
      ) : (
        <p className="text-label text-fg-muted">{t("adminMarketplace.platform.readOnly")}</p>
      )}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={cn("text-label", message.ok ? "text-success" : "text-danger")}>
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}
