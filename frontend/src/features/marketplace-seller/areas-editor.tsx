"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, Checkbox, Select } from "@/components/ui/controls";
import { MapPinIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { saveSellerAreasAction } from "@/server/actions/marketplace-seller";
import { errorKey } from "./errors";
import { splitPlaces, toPlaces, validateAreas, type AreaProblem, type AreaRow, type StoredRate } from "./delivery-model";

type Message = { ok: boolean; text: string };

let rowCounter = 0;
const newRow = (): AreaRow => ({ key: `n${Date.now()}-${rowCounter++}`, governorate: "", area: "" });

/**
 * WHERE the showroom delivers: tick the governorates it covers as a whole, and add single areas inside a
 * governorate (when it covers only part of one, or wants a different price there). Prices are set on the
 * next page. The whole set is saved in one call; a place that stays keeps its price, a new one starts
 * unpriced, one that is removed disappears with its price - the database does that, this form only
 * catches typing mistakes early.
 */
export function AreasEditor({
  organizationId,
  initialRates,
  unpriced,
}: {
  organizationId: string;
  initialRates: StoredRate[];
  /** covered places that still have no price (computed by the server, refreshed after a save) */
  unpriced: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const ar = locale === "ar";
  const initial = splitPlaces(initialRates);
  const [governorates, setGovernorates] = useState<string[]>(initial.governorates);
  const [rows, setRows] = useState<AreaRow[]>(initial.areas);
  const [problems, setProblems] = useState<AreaProblem[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, startSave] = useTransition();

  const touch = () => {
    setMessage(null);
    setProblems([]);
  };
  const toggle = (key: string, on: boolean) => {
    touch();
    setGovernorates((list) => (on ? (list.includes(key) ? list : [...list, key]) : list.filter((g) => g !== key)));
  };
  const update = (key: string, patch: Partial<AreaRow>) => {
    touch();
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const problemText = (p: AreaProblem) =>
    t(p.problem === "governorate" ? "marketplaceSeller.areas.rowGovernorate" : p.problem === "area" ? "marketplaceSeller.areas.rowArea" : "marketplaceSeller.areas.rowDuplicate").replace("{n}", String(p.row));

  const save = () => {
    const found = validateAreas(rows);
    setProblems(found);
    setMessage(null);
    if (found.length > 0) return;
    startSave(async () => {
      const r = await saveSellerAreasAction(organizationId, toPlaces(governorates, rows));
      if (!r.ok) {
        setMessage({ ok: false, text: t(errorKey(r.code)).replace("{detail}", r.detail ?? "") });
        return;
      }
      setMessage({ ok: true, text: t("marketplaceSeller.areas.saved") });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-lg">
      <section className="rounded-md border bg-surface p-md shadow-card" aria-labelledby="areas-governorates">
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div>
            <h2 id="areas-governorates" className="flex items-center gap-sm text-title text-fg">
              <MapPinIcon size={20} />
              {t("marketplaceSeller.areas.governoratesTitle")}
            </h2>
            <p className="mt-1 text-label text-fg-secondary">{t("marketplaceSeller.areas.governoratesHint")}</p>
          </div>
          <div className="flex items-center gap-sm">
            <Button variant="outline" size="sm" onClick={() => { touch(); setGovernorates(GOVERNORATE_OPTIONS.map((g) => g.value)); }}>
              {t("marketplaceSeller.areas.selectAll")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { touch(); setGovernorates([]); }} disabled={governorates.length === 0}>
              {t("marketplaceSeller.areas.clearAll")}
            </Button>
          </div>
        </div>
        <ul className="mt-md grid gap-x-md gap-y-sm tablet:grid-cols-2 desktop:grid-cols-3">
          {GOVERNORATE_OPTIONS.map((g) => (
            <li key={g.value}>
              <Checkbox id={`gov-${g.value}`} name="governorate" checked={governorates.includes(g.value)} onChange={(on) => toggle(g.value, on)}>
                {ar ? g.ar : g.en}
              </Checkbox>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border bg-surface p-md shadow-card" aria-labelledby="areas-specific">
        <h2 id="areas-specific" className="flex items-center gap-sm text-title text-fg">
          <MapPinIcon size={20} />
          {t("marketplaceSeller.areas.areasTitle")}
        </h2>
        <p className="mt-1 text-label text-fg-secondary">{t("marketplaceSeller.areas.areasHint")}</p>

        {rows.length === 0 ? (
          <p className="mt-md rounded-sm border border-dashed p-md text-body text-fg-secondary">{t("marketplaceSeller.areas.emptyAreas")}</p>
        ) : (
          <ul className="mt-md flex flex-col gap-sm">
            {rows.map((r, i) => {
              const cities = r.governorate ? (CITIES_BY_GOVERNORATE[r.governorate] ?? []) : [];
              const bad = problems.filter((p) => p.row === i + 1);
              return (
                <li key={r.key} className="grid items-end gap-sm rounded-sm border p-sm tablet:grid-cols-[1fr_1fr_auto]">
                  <label className="flex min-w-0 flex-col gap-1 text-label text-fg-secondary">
                    {t("marketplaceSeller.areas.governorate")}
                    <Select
                      value={r.governorate}
                      aria-invalid={bad.some((p) => p.problem === "governorate") || undefined}
                      onChange={(e) => update(r.key, { governorate: e.target.value, area: "" })}
                    >
                      <option value="">{t("marketplaceSeller.areas.chooseGovernorate")}</option>
                      {GOVERNORATE_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>
                          {ar ? g.ar : g.en}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-label text-fg-secondary">
                    {t("marketplaceSeller.areas.area")}
                    <Select
                      value={r.area}
                      disabled={!r.governorate}
                      aria-invalid={bad.some((p) => p.problem === "area" || p.problem === "duplicate") || undefined}
                      onChange={(e) => update(r.key, { area: e.target.value })}
                    >
                      <option value="">{t("marketplaceSeller.areas.chooseArea")}</option>
                      {cities.map((c) => (
                        <option key={c.value} value={c.value}>
                          {ar ? c.ar : c.en}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      touch();
                      setRows((list) => list.filter((x) => x.key !== r.key));
                    }}
                    aria-label={`${t("marketplaceSeller.areas.remove")} (${t("marketplaceSeller.areas.areaN").replace("{n}", String(i + 1))})`}
                    title={t("marketplaceSeller.areas.remove")}
                    className="grid h-11 w-11 place-items-center rounded-sm border text-fg-secondary transition-colors hover:bg-surface-2 hover:text-danger"
                  >
                    <TrashIcon size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {problems.length > 0 ? (
          <ul role="alert" className="mt-md flex flex-col gap-1 text-label text-danger">
            {problems.map((p, i) => (
              <li key={i}>{problemText(p)}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-md">
          <Button variant="outline" onClick={() => setRows((list) => [...list, newRow()])} disabled={saving}>
            <PlusIcon size={16} />
            {t("marketplaceSeller.areas.addArea")}
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-sm">
        <Button variant="accent" onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? t("marketplaceSeller.areas.saving") : t("marketplaceSeller.areas.save")}
        </Button>
        <span className="text-label text-fg-secondary">
          {t("marketplaceSeller.areas.summary").replace("{g}", String(governorates.length)).replace("{a}", String(rows.length))}
        </span>
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-label text-success" : "text-label text-danger"}>
            {message.text}
          </p>
        ) : null}
        {unpriced > 0 ? (
          <span className="text-label text-fg-secondary">
            {t("marketplaceSeller.areas.unpriced").replace("{n}", String(unpriced))}{" "}
            <Link href="/b2c/seller/delivery" className="text-accent hover:underline">
              {t("marketplaceSeller.areas.setPrices")}
            </Link>
          </span>
        ) : null}
      </div>
    </div>
  );
}
