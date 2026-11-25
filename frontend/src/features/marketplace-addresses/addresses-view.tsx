"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/controls";
import { Badge, Card, InlineError } from "@/components/ui/primitives";
import type { MapsConfig } from "@/lib/env/maps";
import { useI18n } from "@/lib/i18n/context";
import { deleteBuyerAddressAction, setDefaultBuyerAddressAction } from "@/server/actions/marketplace-addresses";
import { AddressForm } from "./address-form";
import { MAX_ADDRESSES, canAddAddress, maskPhone, phoneState, placeLabel, streetLine, type SavedAddress } from "./address-model";
import { PhoneVerifyPanel } from "./phone-verify-panel";

/**
 * The buyer's saved addresses: list, add, edit, delete, default, and the mobile verification state of each. The page above it
 * loads the data; every change is a server action and the page then refreshes, so what is shown is always what the database holds.
 * No value of an address is placed in a URL or logged.
 */
export function AddressesView({ addresses, accountPhone, mapsConfig }: { addresses: SavedAddress[]; accountPhone: string | null; mapsConfig: MapsConfig }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<SavedAddress | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Promise<{ ok: boolean; code?: string }>) {
    setError(null);
    const r = await action;
    if (!r.ok) setError(t(r.code ?? "buyerAddresses.error.failed", { max: MAX_ADDRESSES }));
    else router.refresh();
    setConfirmDelete(null);
  }

  if (editing) {
    return (
      <Card>
        <AddressForm
          initial={editing === "new" ? null : editing}
          accountPhone={accountPhone}
          mapsConfig={mapsConfig}
          isFirst={addresses.length === 0}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-md" data-testid="addresses-view">
      <div className="flex items-center justify-between gap-sm">
        <p className="text-label text-fg-muted">{t("buyerAddresses.list.count", { count: addresses.length, max: MAX_ADDRESSES })}</p>
        <Button size="sm" onClick={() => setEditing("new")} disabled={!canAddAddress(addresses.length)}>{t("buyerAddresses.list.add")}</Button>
      </div>
      {!canAddAddress(addresses.length) ? <p className="text-label text-fg-muted">{t("buyerAddresses.list.limit", { max: MAX_ADDRESSES })}</p> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {addresses.length === 0 ? <Card><p className="text-body text-fg-secondary">{t("buyerAddresses.list.empty")}</p></Card> : null}
      {addresses.map((a) => {
        const state = phoneState(a, accountPhone);
        return (
          <Card key={a.id}>
            <article className="flex flex-col gap-sm" data-testid="address-card">
              <div className="flex flex-wrap items-center gap-xs">
                <span className="text-title text-fg">{a.nickname ?? t(`buyerAddresses.kind.${a.kind}`)}</span>
                {a.nickname ? <Badge>{t(`buyerAddresses.kind.${a.kind}`)}</Badge> : null}
                {a.is_default ? <Badge>{t("buyerAddresses.list.defaultBadge")}</Badge> : null}
              </div>
              <p className="text-body text-fg">{placeLabel(a, locale)}</p>
              <p className="text-body text-fg-secondary">{streetLine(a, { building: t("buyerAddresses.list.buildingLabel"), floor: t("buyerAddresses.list.floorLabel"), apartment: t("buyerAddresses.list.apartmentLabel") })}</p>
              <p className="text-label text-fg-muted">
                {t("buyerAddresses.list.recipient", { name: `${a.recipient_first_name} ${a.recipient_last_name}` })} · <bdi dir="ltr">{maskPhone(a.recipient_phone_e164)}</bdi>
              </p>
              {state === "ready" ? <span className="text-label text-success" data-testid="phone-state-ready">{t("buyerAddresses.phone.verified")}</span> : null}
              {state === "verify" ? (
                <div className="flex flex-col gap-xs" data-testid="phone-state-verify">
                  <p className="text-label text-warning">{t("buyerAddresses.phone.needsVerification")}</p>
                  <PhoneVerifyPanel />
                </div>
              ) : null}
              {state === "own_number_only" ? <p className="text-label text-warning" data-testid="phone-state-own">{t("buyerAddresses.phone.ownNumberOnly")}</p> : null}
              <div className="flex flex-wrap gap-xs">
                <Button variant="outline" size="sm" onClick={() => setEditing(a)}>{t("buyerAddresses.list.edit")}</Button>
                {a.is_default ? null : <Button variant="outline" size="sm" onClick={() => run(setDefaultBuyerAddressAction(a.id))}>{t("buyerAddresses.list.setDefault")}</Button>}
                {confirmDelete === a.id ? (
                  <>
                    <span className="self-center text-label text-fg-secondary">{t("buyerAddresses.list.deleteConfirm")}</span>
                    <Button variant="danger" size="sm" onClick={() => run(deleteBuyerAddressAction(a.id))}>{t("buyerAddresses.list.deleteYes")}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>{t("buyerAddresses.list.deleteNo")}</Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(a.id)}>{t("buyerAddresses.list.delete")}</Button>
                )}
              </div>
            </article>
          </Card>
        );
      })}
    </div>
  );
}
