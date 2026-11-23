"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, ButtonLink, Checkbox, Input } from "@/components/ui/controls";
import { CheckIcon, MapPinIcon, StorefrontIcon, TruckIcon } from "@/components/ui/icons";
import { saveSellerDeliveryTermsAction, setSellerPickupAction } from "@/server/actions/marketplace-seller";
import { errorKey } from "./errors";
import { placeLabel } from "./place-label";
import { FreeShippingProducts } from "./free-shipping-products";
import {
  EMPTY_SETTINGS,
  priceRowsFrom,
  settingsFormFrom,
  toPrices,
  toSettings,
  validatePrices,
  validateSettings,
  type PriceField,
  type PriceProblem,
  type PriceRow,
  type SettingsForm,
  type SettingsProblem,
  type StoredRate,
  type StoredSettings,
} from "./delivery-model";

type Message = { ok: boolean; text: string };

const ROW_PROBLEM_KEY: Record<PriceField, string> = {
  fee: "rowFeeInvalid",
  duration: "rowDurationInvalid",
  nextDayFee: "rowNextDayFeeInvalid",
  freeMin: "rowFreeMinInvalid",
};
const SETTINGS_PROBLEM_KEY: Record<SettingsProblem, string> = {
  prep: "prepInvalid",
  freeMin: "freeMinInvalid",
  pickupNote: "pickupNoteInvalid",
};

/**
 * The showroom's delivery settings on one screen (the places themselves are chosen on the Delivery areas
 * page): preparation days, a free-shipping minimum, then for each covered place the fee,
 * how many days delivery takes, an optional next-day option with its fee and an optional own free-shipping
 * minimum. Everything is saved in one call and the database re-validates every value. Pickup from the
 * showroom is switched here too, and a checklist shows what still blocks publishing.
 */
export function DeliveryEditor({
  organizationId,
  initialRates,
  initialPickup,
  initialSettings = EMPTY_SETTINGS,
  initialMissing = [],
  freeShippingCount = 0,
}: {
  organizationId: string;
  initialRates: StoredRate[];
  initialPickup: boolean;
  initialSettings?: StoredSettings;
  initialMissing?: string[];
  freeShippingCount?: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<PriceRow[]>(() => priceRowsFrom(initialRates));
  const [form, setForm] = useState<SettingsForm>(() => settingsFormFrom(initialSettings));
  const [problems, setProblems] = useState<PriceProblem[]>([]);
  const [settingsProblems, setSettingsProblems] = useState<SettingsProblem[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [missing, setMissing] = useState<string[]>(initialMissing);
  const [pickup, setPickup] = useState(initialPickup);
  const [pickupMessage, setPickupMessage] = useState<Message | null>(null);
  const [saving, startSave] = useTransition();
  const [switching, startSwitch] = useTransition();
  const d = (key: string) => t(`marketplaceSeller.delivery.${key}`);

  const label = (r: PriceRow) => placeLabel(r.governorate, r.area, locale, d("allAreas"));
  const unset = rows.filter((r) => r.fee.trim() === "").length;

  const touch = () => {
    setMessage(null);
    setProblems([]);
    setSettingsProblems([]);
  };
  const update = (key: string, patch: Partial<PriceRow>) => {
    touch();
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const setField = (patch: Partial<SettingsForm>) => {
    touch();
    setForm((f) => ({ ...f, ...patch }));
  };

  const save = () => {
    const foundRows = validatePrices(rows);
    const foundSettings = validateSettings(form);
    setProblems(foundRows);
    setSettingsProblems(foundSettings);
    setMessage(null);
    if (foundRows.length > 0 || foundSettings.length > 0) return;
    startSave(async () => {
      const r = await saveSellerDeliveryTermsAction(organizationId, toSettings(form), toPrices(rows));
      if (!r.ok) {
        setMessage({ ok: false, text: t(errorKey(r.code)).replace("{detail}", r.detail ?? "") });
        return;
      }
      setMissing(r.missing);
      setMessage({ ok: true, text: d("saved") });
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
      setPickupMessage({ ok: true, text: d("pickupSaved") });
      router.refresh();
    });
  };

  const card = "rounded-md border bg-surface p-md shadow-card";
  const hasProblem = (i: number, field: PriceField) => problems.some((p) => p.row === i + 1 && p.field === field);

  return (
    <div className="flex flex-col gap-lg">
      <section
        className={`${card} ${missing.length === 0 ? "border-success" : "border-warning"}`}
        aria-labelledby="delivery-readiness"
      >
        <h2 id="delivery-readiness" className="flex items-center gap-sm text-title text-fg">
          {missing.length === 0 ? <CheckIcon size={20} /> : <TruckIcon size={20} />}
          {missing.length === 0 ? d("readyTitle") : d("missingTitle")}
        </h2>
        {missing.length === 0 ? (
          <p className="mt-1 text-label text-fg-secondary">{d("readyHint")}</p>
        ) : (
          <ul className="mt-sm flex list-disc flex-col gap-1 ps-lg text-label text-fg-secondary">
            {missing.map((code) => (
              <li key={code}>{d(`missing.${code}`)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="delivery-settings">
        <h2 id="delivery-settings" className="flex items-center gap-sm text-title text-fg">
          <TruckIcon size={20} />
          {d("settingsTitle")}
        </h2>
        <p className="mt-1 text-label text-fg-secondary">{d("settingsHint")}</p>
        <div className="mt-md grid gap-md tablet:grid-cols-2">
          <label className="flex flex-col gap-1 text-label text-fg">
            {d("prepDays")}
            <Input
              id="prep-days"
              inputMode="numeric"
              dir="ltr"
              maxLength={2}
              value={form.prep}
              aria-invalid={settingsProblems.includes("prep") || undefined}
              onChange={(e) => setField({ prep: e.target.value })}
            />
            <span className="text-caption text-fg-secondary">{d("prepDaysHint")}</span>
          </label>
          <label className="flex flex-col gap-1 text-label text-fg">
            {d("freeMin")}
            <Input
              id="free-min"
              inputMode="decimal"
              dir="ltr"
              value={form.freeMin}
              placeholder={d("notSet")}
              aria-invalid={settingsProblems.includes("freeMin") || undefined}
              onChange={(e) => setField({ freeMin: e.target.value })}
            />
            <span className="text-caption text-fg-secondary">{d("freeMinHint")}</span>
          </label>
        </div>
        {settingsProblems.length > 0 ? (
          <ul role="alert" className="mt-md flex flex-col gap-1 text-label text-danger">
            {settingsProblems.map((p) => (
              <li key={p}>{d(SETTINGS_PROBLEM_KEY[p])}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={card} aria-labelledby="delivery-prices">
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div>
            <h2 id="delivery-prices" className="flex items-center gap-sm text-title text-fg">
              <MapPinIcon size={20} />
              {d("termsTitle")}
            </h2>
            <p className="mt-1 text-label text-fg-secondary">{d("rules")}</p>
          </div>
          {rows.length > 0 ? (
            <ButtonLink href="/showroom/marketplace/areas" variant="outline" size="sm">
              <MapPinIcon size={16} />
              {d("editAreas")}
            </ButtonLink>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <div className="mt-md flex flex-col items-start gap-sm rounded-sm border border-dashed p-md">
            <p className="text-body text-fg-secondary">{d("empty")}</p>
            <ButtonLink href="/showroom/marketplace/areas" variant="accent">
              <MapPinIcon size={16} />
              {d("addAreas")}
            </ButtonLink>
          </div>
        ) : (
          <ul className="mt-md flex flex-col gap-sm">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-col gap-sm rounded-sm border p-sm">
                <label htmlFor={`fee-${r.key}`} className="min-w-0 text-body font-medium text-fg">
                  {label(r)}
                </label>
                <div className="grid gap-sm tablet:grid-cols-4">
                  <label className="flex flex-col gap-1 text-caption text-fg-secondary">
                    {d("fee")}
                    <Input
                      id={`fee-${r.key}`}
                      inputMode="decimal"
                      dir="ltr"
                      value={r.fee}
                      placeholder={d("notSet")}
                      aria-label={`${label(r)} — ${d("fee")}`}
                      aria-invalid={hasProblem(i, "fee") || undefined}
                      onChange={(e) => update(r.key, { fee: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption text-fg-secondary">
                    {d("durationFrom")}
                    <Input
                      inputMode="numeric"
                      dir="ltr"
                      maxLength={2}
                      value={r.minDays}
                      placeholder={d("notSet")}
                      aria-label={`${label(r)} — ${d("durationFrom")}`}
                      aria-invalid={hasProblem(i, "duration") || undefined}
                      onChange={(e) => update(r.key, { minDays: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption text-fg-secondary">
                    {d("durationTo")}
                    <Input
                      inputMode="numeric"
                      dir="ltr"
                      maxLength={2}
                      value={r.maxDays}
                      placeholder={d("notSet")}
                      aria-label={`${label(r)} — ${d("durationTo")}`}
                      aria-invalid={hasProblem(i, "duration") || undefined}
                      onChange={(e) => update(r.key, { maxDays: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-caption text-fg-secondary">
                    {d("areaFreeMin")}
                    <Input
                      inputMode="decimal"
                      dir="ltr"
                      value={r.freeMin}
                      placeholder={d("notSet")}
                      aria-label={`${label(r)} — ${d("areaFreeMin")}`}
                      aria-invalid={hasProblem(i, "freeMin") || undefined}
                      onChange={(e) => update(r.key, { freeMin: e.target.value })}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-md">
                  <Checkbox
                    id={`nd-${r.key}`}
                    name={`nd-${r.key}`}
                    checked={r.nextDay}
                    onChange={(on) => update(r.key, { nextDay: on, nextDayFee: on ? r.nextDayFee : "" })}
                  >
                    {d("nextDay")}
                  </Checkbox>
                  {r.nextDay ? (
                    <label className="flex w-44 flex-col gap-1 text-caption text-fg-secondary">
                      {d("nextDayFee")}
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        value={r.nextDayFee}
                        aria-label={`${label(r)} — ${d("nextDayFee")}`}
                        aria-invalid={hasProblem(i, "nextDayFee") || undefined}
                        onChange={(e) => update(r.key, { nextDayFee: e.target.value })}
                      />
                    </label>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {problems.length > 0 ? (
          <ul role="alert" className="mt-md flex flex-col gap-1 text-label text-danger">
            {problems.map((p, n) => (
              <li key={`${p.row}-${p.field}-${n}`}>{d(ROW_PROBLEM_KEY[p.field ?? "fee"]).replace("{place}", label(rows[p.row - 1]!))}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={card} aria-labelledby="delivery-pickup">
        <h2 id="delivery-pickup" className="flex items-center gap-sm text-title text-fg">
          <StorefrontIcon size={20} />
          {d("pickupTitle")}
        </h2>
        <p className="mt-1 text-label text-fg-secondary">{d("pickupHint")}</p>
        <div className="mt-md flex flex-col gap-md">
          <Checkbox id="seller-pickup" name="pickup" checked={pickup} onChange={(on) => switchPickup(on)}>
            {d("pickupLabel")}
          </Checkbox>
          {switching ? <span className="sr-only" role="status">{d("saving")}</span> : null}
          {pickupMessage ? (
            <p role={pickupMessage.ok ? "status" : "alert"} className={pickupMessage.ok ? "text-label text-success" : "text-label text-danger"}>
              {pickupMessage.text}
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-label text-fg">
            {d("pickupNote")}
            <Input
              id="pickup-note"
              maxLength={300}
              value={form.pickupNote}
              aria-invalid={settingsProblems.includes("pickupNote") || undefined}
              onChange={(e) => setField({ pickupNote: e.target.value })}
            />
            <span className="text-caption text-fg-secondary">{d("pickupNoteHint")}</span>
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-sm">
        <Button variant="accent" onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? d("saving") : d("save")}
        </Button>
        {rows.length > 0 && unset > 0 ? <span className="text-label text-fg-secondary">{d("unpriced").replace("{n}", String(unset))}</span> : null}
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-label text-success" : "text-label text-danger"}>
            {message.text}
          </p>
        ) : null}
      </div>

      <FreeShippingProducts organizationId={organizationId} initialCount={freeShippingCount} />
    </div>
  );
}
