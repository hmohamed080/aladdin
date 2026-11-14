"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input } from "@/components/ui/controls";
import { formatCount } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";
import { adjustStockAction, ensureDefaultLocationAction } from "@/server/actions/marketplace-seller";
import { errorKey } from "./errors";

export type StockLevel = {
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * The − / + control for ONE variant at ONE location.
 *
 * Every change goes through the trusted ledger RPC with a fresh idempotency key
 * (a double click cannot apply twice) and the on-hand the seller is looking at
 * (a stale screen is refused, not overwritten). The number shown is only ever the
 * server's confirmed value — nothing is updated optimistically.
 */
export function QuantityStepper({
  variantId,
  level,
  compact = false,
  onChanged,
}: {
  variantId: string;
  level: StockLevel;
  compact?: boolean;
  onChanged?: (level: StockLevel) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [current, setCurrent] = useState(level);
  const [draft, setDraft] = useState(String(level.onHand));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // When the server sends newer numbers (a refresh after a conflict, another tab),
  // adopt them — the screen only ever shows server-confirmed quantities.
  useEffect(() => {
    if (pending) return;
    setCurrent((c) =>
      c.onHand === level.onHand && c.reserved === level.reserved && c.locationId === level.locationId ? c : level,
    );
    setDraft(String(level.onHand));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the numbers, not the object identity
  }, [level.onHand, level.reserved, level.available, level.locationId]);

  const apply = (delta: number) => {
    if (!delta) return;
    setError(null);
    startTransition(async () => {
      const r = await adjustStockAction({
        variantId,
        locationId: current.locationId,
        delta,
        key: newKey(),
        expectedOnHand: current.onHand,
      });
      if (!r.ok) {
        setError(t(errorKey(r.code)));
        setDraft(String(current.onHand));
        // A conflict means the screen is stale: re-read the server's numbers.
        if (r.code === "stock_changed") router.refresh();
        return;
      }
      const next = { ...current, onHand: r.onHand, reserved: r.reserved, available: r.available };
      setCurrent(next);
      setDraft(String(r.onHand));
      onChanged?.(next);
    });
  };

  const submitTyped = () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(current.onHand));
      return;
    }
    apply(n - current.onHand);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "inline-flex items-stretch overflow-hidden rounded-sm border bg-surface",
          pending && "opacity-60",
          error && "border-danger",
        )}
        aria-busy={pending}
      >
        <button
          type="button"
          onClick={() => apply(-1)}
          disabled={pending || current.onHand - current.reserved <= 0}
          aria-label={t("marketplaceSeller.stockEditor.decrease")}
          className="grid w-9 place-items-center text-fg-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={submitTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitTyped();
            }
          }}
          inputMode="numeric"
          dir="ltr"
          disabled={pending}
          aria-label={t("marketplaceSeller.stockEditor.setTo")}
          className={cn(
            "border-x bg-transparent text-center tabular-nums text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
            compact ? "w-14 py-1" : "w-20 py-1.5",
          )}
        />
        <button
          type="button"
          onClick={() => apply(1)}
          disabled={pending}
          aria-label={t("marketplaceSeller.stockEditor.increase")}
          className="grid w-9 place-items-center text-fg-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
      {!compact && current.reserved > 0 ? (
        <span className="text-label text-fg-muted">
          {t("marketplaceSeller.stockEditor.reserved")}: {formatCount(current.reserved, locale)} ·{" "}
          {t("marketplaceSeller.stockEditor.available")}: {formatCount(current.available, locale)}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="max-w-56 text-center text-label text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** A variant with no stock row yet: create it at the main location with a first quantity. */
export function AddStockAtMain({ organizationId, variantId }: { organizationId: string; variantId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const n = Number.parseInt(qty, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setError(null);
    startTransition(async () => {
      const loc = await ensureDefaultLocationAction(organizationId);
      if (!loc.ok) return setError(t(errorKey(loc.code)));
      const r = await adjustStockAction({ variantId, locationId: loc.locationId, delta: n, key: newKey() });
      if (!r.ok) return setError(t(errorKey(r.code)));
      setQty("");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-sm">
      <p className="w-full text-label text-fg-muted">{t("marketplaceSeller.stockEditor.noStock")}</p>
      <Input
        value={qty}
        onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
        dir="ltr"
        className="w-28"
        aria-label={t("marketplaceSeller.stockEditor.addAtMain")}
      />
      <Button variant="outline" size="sm" onClick={submit} disabled={pending || !qty}>
        {t("marketplaceSeller.stockEditor.addAtMain")}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-label text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
