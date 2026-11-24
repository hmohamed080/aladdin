"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { PhoneField } from "@/components/ui/phone-field";
import { InlineError } from "@/components/ui/primitives";
import { splitE164, type CanonicalPhone } from "@/lib/contact/phone";
import type { MapsConfig } from "@/lib/env/maps";
import { useI18n } from "@/lib/i18n/context";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { saveBuyerAddressAction } from "@/server/actions/marketplace-addresses";
import { ADDRESS_KINDS, firstAddressIssue, type AddressKind, type LocationSource, type SavedAddress } from "./address-model";
import { loadGoogleMaps, placeDetails, predictPlaces, type GooglePrediction } from "./map-provider";
import { PinPicker } from "./pin-picker";
import { searchPlaces, type PlaceSuggestion } from "./place-search";

type Suggestion = { key: string; label: string; apply: () => void };

/**
 * Create or edit one address. The flow follows the owner's design (Part 4B): find the place (smart search), confirm it on the map
 * when a map provider exists, then the details (Home / Work / Other, street, building, floor and apartment, directions) and the
 * recipient (first and last name, mobile). With no map provider the same form works from the place lists and the street field.
 * The server validates everything again; the mobile's verification is decided by the database, never by this form.
 */
export function AddressForm({
  initial,
  accountPhone,
  mapsConfig,
  isFirst,
  onSaved,
  onCancel,
}: {
  initial: SavedAddress | null;
  accountPhone: string | null;
  mapsConfig: MapsConfig;
  isFirst: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState<AddressKind>(initial?.kind ?? "home");
  const [gov, setGov] = useState(initial?.governorate_key ?? "");
  const [area, setArea] = useState(initial?.area_key ?? "");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const [street, setStreet] = useState(initial?.street ?? "");
  const [building, setBuilding] = useState(initial?.building ?? "");
  const [floorApartment, setFloorApartment] = useState(initial?.floor_apartment ?? "");
  const [directions, setDirections] = useState(initial?.directions ?? "");
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [first, setFirst] = useState(initial?.recipient_first_name ?? "");
  const [last, setLast] = useState(initial?.recipient_last_name ?? "");
  const [lat, setLat] = useState(initial?.latitude != null ? String(initial.latitude) : "");
  const [lng, setLng] = useState(initial?.longitude != null ? String(initial.longitude) : "");
  const [source, setSource] = useState<LocationSource>(initial?.location_source ?? "manual");
  const [phone, setPhone] = useState<CanonicalPhone | null>(null);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [claim, setClaim] = useState(true);
  const [makeDefault, setMakeDefault] = useState(initial?.is_default ?? isFirst);
  const [query, setQuery] = useState("");
  const [google, setGoogle] = useState<GooglePrediction[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  const startPhone = useMemo(() => splitE164(initial?.recipient_phone_e164 ?? accountPhone), [initial, accountPhone]);
  const label = (o: { ar: string; en: string }) => (locale === "ar" ? o.ar : o.en);
  const cities = gov ? (CITIES_BY_GOVERNORATE[gov] ?? []) : [];

  const catalogue = useMemo(() => searchPlaces(query), [query]);

  // Google predictions: debounced, three characters or more, and only when a provider is configured.
  useEffect(() => {
    if (mapsConfig.provider !== "google" || query.trim().length < 3) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadGoogleMaps(mapsConfig, locale)
        .then((api) => predictPlaces(api, query.trim(), locale))
        .then((r) => !cancelled && setGoogle(r))
        .catch(() => !cancelled && setGoogle([]));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mapsConfig, locale]);

  const suggestions: Suggestion[] = [
    ...catalogue.map((s: PlaceSuggestion) => ({
      key: `c-${s.gov}-${s.area ?? ""}`,
      label: label(s.label),
      apply: () => {
        setGov(s.gov);
        setArea(s.area ?? "");
        if (source !== "map") setSource("catalogue");
        setQuery("");
      },
    })),
    ...(query.trim().length >= 3 ? google : []).map((p) => ({
      key: `g-${p.id}`,
      label: p.text,
      apply: () => {
        setQuery("");
        if (mapsConfig.provider !== "google") return;
        void loadGoogleMaps(mapsConfig, locale)
          .then((api) => placeDetails(api, p.id))
          .then((d) => {
            if (d.gov) setGov(d.gov);
            setArea(d.gov ? (d.area ?? "") : area);
            if (d.pin) {
              setLat(d.pin.lat.toFixed(6));
              setLng(d.pin.lng.toFixed(6));
              setSource("map");
            }
          })
          .catch(() => undefined);
      },
    })),
  ];

  const showClaim = accountPhone === null && phone !== null && !initial;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const e164 = phone?.e164 ?? (phoneInvalid ? "" : (initial?.recipient_phone_e164 ?? accountPhone ?? ""));
    const draft = {
      id, kind, nickname, governorate_key: gov, area_key: area, district, street, building, floor_apartment: floorApartment, directions,
      latitude: lat || null, longitude: lng || null, location_source: lat && lng ? "map" : source === "catalogue" ? "catalogue" : "manual",
      recipient_first_name: first, recipient_last_name: last, recipient_phone_e164: e164, make_default: makeDefault,
    };
    const issue = firstAddressIssue(draft);
    if (issue) {
      setError({ field: issue.field, message: t(`buyerAddresses.field.${issue.field}`) });
      return;
    }
    setPending(true);
    setError(null);
    const result = await saveBuyerAddressAction(draft, showClaim && claim && phone ? { countryIso2: phone.countryIso2, national: phone.national, e164: phone.e164 } : undefined);
    setPending(false);
    if (!result.ok) {
      setError({ field: result.field ?? "", message: result.field ? t(`buyerAddresses.field.${result.field}`) : t(result.code, { max: 10 }) });
      return;
    }
    onSaved();
  }

  const fieldError = (name: string) => (error?.field === name ? error.message : undefined);

  return (
    <form onSubmit={submit} className="flex flex-col gap-md" data-testid="address-form" noValidate>
      <h2 className="text-title text-fg">{t(initial ? "buyerAddresses.form.titleEdit" : "buyerAddresses.form.titleNew")}</h2>

      <div role="radiogroup" aria-label={t("buyerAddresses.form.kindLabel")} className="flex gap-xs">
        {ADDRESS_KINDS.map((k) => (
          <Button key={k} variant={kind === k ? "primary" : "outline"} size="sm" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
            {t(`buyerAddresses.kind.${k}`)}
          </Button>
        ))}
      </div>

      <LabeledField label={t("buyerAddresses.form.searchLabel")} htmlFor="addr-search" hint={t("buyerAddresses.form.searchHint")}>
        <Input id="addr-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("buyerAddresses.form.searchPlaceholder")} autoComplete="off" />
      </LabeledField>
      {query.trim().length >= 2 ? (
        suggestions.length > 0 ? (
          <ul className="flex flex-col rounded-md border" data-testid="place-suggestions">
            {suggestions.map((s) => (
              <li key={s.key}>
                <button type="button" className="w-full px-md py-sm text-start text-body text-fg hover:bg-surface-2" onClick={s.apply}>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label text-fg-muted">{t("buyerAddresses.form.searchNone")}</p>
        )
      ) : null}

      <div className="grid gap-sm sm:grid-cols-2">
        <LabeledField label={t("buyerAddresses.form.governorate")} htmlFor="addr-gov" error={fieldError("governorate")}>
          <Select id="addr-gov" value={gov} onChange={(e) => { setGov(e.target.value); setArea(""); }}>
            <option value="">{t("buyerAddresses.form.chooseGovernorate")}</option>
            {GOVERNORATE_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{label(g)}</option>
            ))}
          </Select>
        </LabeledField>
        <LabeledField label={t("buyerAddresses.form.area")} htmlFor="addr-area" error={fieldError("area")}>
          <Select id="addr-area" value={area} disabled={!gov || cities.length === 0} onChange={(e) => setArea(e.target.value)}>
            <option value="">{t("buyerAddresses.form.chooseArea")}</option>
            {cities.map((c) => (
              <option key={c.value} value={c.value}>{label(c)}</option>
            ))}
          </Select>
        </LabeledField>
      </div>

      <PinPicker config={mapsConfig} lat={lat} lng={lng} onChange={(a, b) => { setLat(a); setLng(b); if (a && b) setSource("map"); }} />
      {fieldError("pin") || fieldError("pinOutside") ? <InlineError>{fieldError("pin") ?? fieldError("pinOutside")}</InlineError> : null}

      <LabeledField label={t("buyerAddresses.form.street")} htmlFor="addr-street" error={fieldError("street") ?? fieldError("characters")}>
        <Input id="addr-street" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={160} autoComplete="off" />
      </LabeledField>
      <div className="grid gap-sm sm:grid-cols-3">
        <LabeledField label={t("buyerAddresses.form.district")} htmlFor="addr-district">
          <Input id="addr-district" value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={80} autoComplete="off" />
        </LabeledField>
        <LabeledField label={t("buyerAddresses.form.building")} htmlFor="addr-building">
          <Input id="addr-building" value={building} onChange={(e) => setBuilding(e.target.value)} maxLength={40} autoComplete="off" />
        </LabeledField>
        <LabeledField label={t("buyerAddresses.form.floorApartment")} htmlFor="addr-floor">
          <Input id="addr-floor" value={floorApartment} onChange={(e) => setFloorApartment(e.target.value)} maxLength={40} autoComplete="off" />
        </LabeledField>
      </div>
      <LabeledField label={t("buyerAddresses.form.directions")} htmlFor="addr-directions">
        <Textarea id="addr-directions" value={directions} onChange={(e) => setDirections(e.target.value)} maxLength={200} rows={2} />
      </LabeledField>
      <LabeledField label={t("buyerAddresses.form.nickname")} htmlFor="addr-nickname">
        <Input id="addr-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} placeholder={t("buyerAddresses.form.nicknamePlaceholder")} autoComplete="off" />
      </LabeledField>

      <fieldset className="flex flex-col gap-sm border-t pt-md">
        <legend className="text-label font-medium text-fg-secondary">{t("buyerAddresses.form.recipientTitle")}</legend>
        <div className="grid gap-sm sm:grid-cols-2">
          <LabeledField label={t("buyerAddresses.form.firstName")} htmlFor="addr-first" error={fieldError("name")}>
            <Input id="addr-first" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={40} autoComplete="given-name" />
          </LabeledField>
          <LabeledField label={t("buyerAddresses.form.lastName")} htmlFor="addr-last">
            <Input id="addr-last" value={last} onChange={(e) => setLast(e.target.value)} maxLength={40} autoComplete="family-name" />
          </LabeledField>
        </div>
        <LabeledField label={t("buyerAddresses.form.mobile")} htmlFor="addr-phone-national" error={fieldError("phone")}>
          <PhoneField
            id="addr-phone-national"
            defaultCountryIso2={startPhone?.countryIso2 ?? null}
            defaultNational={startPhone?.national ?? null}
            onChange={setPhone}
            onInvalidChange={setPhoneInvalid}
          />
        </LabeledField>
        {showClaim ? (
          <Checkbox id="addr-claim" name="claim" checked={claim} onChange={setClaim}>{t("buyerAddresses.form.claimPhone")}</Checkbox>
        ) : null}
      </fieldset>

      {initial?.is_default || isFirst ? null : (
        <Checkbox id="addr-default" name="makeDefault" checked={makeDefault} onChange={setMakeDefault}>{t("buyerAddresses.form.makeDefault")}</Checkbox>
      )}

      {error && !error.field ? <InlineError>{error.message}</InlineError> : null}
      <div className="flex gap-sm">
        <Button type="submit" disabled={pending}>{pending ? t("buyerAddresses.form.saving") : t("buyerAddresses.form.save")}</Button>
        <Button variant="ghost" onClick={onCancel}>{t("buyerAddresses.form.cancel")}</Button>
      </div>
    </form>
  );
}
