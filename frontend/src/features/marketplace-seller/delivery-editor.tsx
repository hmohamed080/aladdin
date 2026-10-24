"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, ButtonLink, Checkbox, Input } from "@/components/ui/controls";
import { MapPinIcon, StorefrontIcon, TruckIcon } from "@/components/ui/icons";
import { saveSellerPricesAction, setSellerPickupAction } from "@/server/actions/marketplace-seller";
import { errorKey } from "./errors";
import { placeLabel } from "./place-label";
import { priceRowsFrom, toPrices, validatePrices, type PriceProblem, type PriceRow, type StoredRate } from "./delivery-model";

type Message = { ok: boolean; text: string };

/**
 * WHAT the showroom charges to deliver to each place it covers (the places themselves are chosen on the
 * Delivery areas page). One line per place with a price box; a blank price means "not set", and buyers
 * cannot choose delivery to a place without a price. Free delivery is an explicit 0. All prices are saved
 * in one call and the database re-validates every line. Pickup from the showroom is switched here too.
 */
export function DeliveryEditor({
  organizationId,
  initialRates,
  initialPickup,
}: {
  organizationId: string;
  initialRates: StoredRate[];
  initialPickup: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<PriceRow[]>(() => priceRowsFrom(initialRates));
  const [problems, setProblems] = useState<PriceProblem[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [pickup, setPickup] = useState(initialPickup);
  const [pickupMessage, setPickupMessage] = useState<Message | null>(null);
  const [saving, startSave] = useTransition();
  const [switching, startSwitch] = useTransition();

  const label = (r: PriceRow) => placeLabel(r.governorate, r.area, locale, t("marketplaceSeller.delivery.allAreas"));
  const unset = rows.filter((r) => r.fee.trim() === "").length;

  const update = (key: string, fee: string) => {
    setMessage(null);
    setProblems([]);
    setRows((list) => list.map((r) => (r.key === key ? { ...r, fee } : r)));
  };

  const save = () => {
    const found = validatePrices(rows);
    setProblems(found);
    setMessage(null);
    if (found.length > 0) return;
    startSave(async () => {
      const r = await saveSellerPricesAction(organizationId, toPrices(rows));
      if (!r.ok) {
        setMessage({ ok: false, text: t(errorKey(r.code)).replace("{detail}", r.detail ?? "") });
        return;
      }
      setMessage({ ok: true, text: t("marketplaceSeller.delivery.saved") });
      router.refresh();
    });
  };

  const switchPickup = (enabled: boolean) => {
    setPickupMessage(null);
    startSwitch(async () => {
      const r = await setSellerPickupAction(organizationId, enabled);
      if (!r.ok) {
        setPickupMessage({ ok: false, text: t(errorKey(r.code)) });
        return;
      }
      setPickup(r.pickupAvailable);
      setPickupMessage({ ok: true, text: t("marketplaceSeller.delivery.pickupSaved") });
    });
  };

  return (
    <div className="flex flex-col gap-lg">
      <section className="rounded-md border bg-surface p-md shadow-card" aria-labelledby="delivery-prices">
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div>
            <h2 id="delivery-prices" className="flex items-center gap-sm text-title text-fg">
              <TruckIcon size={20} />
              {t("marketplaceSeller.delivery.title")}
            </h2>
            <p className="mt-1 text-label text-fg-secondary">{t("marketplaceSeller.delivery.rules")}</p>
          </div>
          {rows.length > 0 ? (
            <ButtonLink href="/b2c/seller/areas" variant="outline" size="sm">
              <MapPinIcon size={16} />
              {t("marketplaceSeller.delivery.editAreas")}
            </ButtonLink>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <div className="mt-md flex flex-col items-start gap-sm rounded-sm border border-dashed p-md">
            <p className="text-body text-fg-secondary">{t("marketplaceSeller.delivery.empty")}</p>
            <ButtonLink href="/b2c/seller/areas" variant="accent">
              <MapPinIcon size={16} />
              {t("marketplaceSeller.delivery.addAreas")}
            </ButtonLink>
          </div>
        ) : (
          <ul className="mt-md flex flex-col gap-sm">
            {rows.map((r, i) => {
              const bad = problems.some((p) => p.row === i + 1);
              return (
                <li key={r.key} className="grid items-center gap-sm rounded-sm border p-sm tablet:grid-cols-[1fr_11rem]">
                  <label htmlFor={`fee-${r.key}`} className="min-w-0 text-body font-medium text-fg">
                    {label(r)}
                  </label>
                  <div className="flex flex-col gap-1">
                    <Input
                      id={`fee-${r.key}`}
                      inputMode="decimal"
                      dir="ltr"
                      value={r.fee}
                      placeholder={t("marketplaceSeller.delivery.notSet")}
                      aria-label={`${label(r)} — ${t("marketplaceSeller.delivery.fee")}`}
                      aria-invalid={bad || undefined}
                      onChange={(e) => update(r.key, e.target.value)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {problems.length > 0 ? (
          <ul role="alert" className="mt-md flex flex-col gap-1 text-label text-danger">
            {problems.map((p) => (
              <li key={p.row}>{t("marketplaceSeller.delivery.rowFeeInvalid").replace("{place}", label(rows[p.row - 1]!))}</li>
            ))}
          </ul>
        ) : null}

        {rows.length > 0 ? (
          <div className="mt-md flex flex-wrap items-center gap-sm">
            <Button variant="accent" onClick={save} disabled={saving} aria-busy={saving}>
              {saving ? t("marketplaceSeller.delivery.saving") : t("marketplaceSeller.delivery.save")}
            </Button>
            {unset > 0 ? <span className="text-label text-fg-secondary">{t("marketplaceSeller.delivery.unpriced").replace("{n}", String(unset))}</span> : null}
            {message ? (
              <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-label text-success" : "text-label text-danger"}>
                {message.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-md border bg-surface p-md shadow-card" aria-labelledby="delivery-pickup">
        <h2 id="delivery-pickup" className="flex items-center gap-sm text-title text-fg">
          <StorefrontIcon size={20} />
          {t("marketplaceSeller.delivery.pickupTitle")}
        </h2>
        <p className="mt-1 text-label text-fg-secondary">{t("marketplaceSeller.delivery.pickupHint")}</p>
        <div className="mt-md">
          <Checkbox id="seller-pickup" name="pickup" checked={pickup} onChange={(on) => switchPickup(on)}>
            {t("marketplaceSeller.delivery.pickupLabel")}
          </Checkbox>
          {switching ? <span className="sr-only" role="status">{t("marketplaceSeller.delivery.saving")}</span> : null}
          {pickupMessage ? (
            <p role={pickupMessage.ok ? "status" : "alert"} className={pickupMessage.ok ? "mt-sm text-label text-success" : "mt-sm text-label text-danger"}>
              {pickupMessage.text}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

