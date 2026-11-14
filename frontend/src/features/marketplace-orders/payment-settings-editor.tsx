"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Checkbox, Input } from "@/components/ui/controls";
import { MoneyIcon, ReceiptIcon, ShieldIcon } from "@/components/ui/icons";
import { savePaymentSettingsAction } from "@/server/actions/marketplace-orders";
import { orderErrorCode, type PaymentSettings } from "./contract";

type Message = { ok: boolean; text: string };

/**
 * How Marketplace buyers can pay this showroom (Migration 14): cash on delivery, an InstaPay deposit
 * (address, account name and the deposit share; 100% = paid in full up front) and, later, an online
 * card gateway. Only owners/managers (`org.manage`) can save; the database validates every field.
 */
export function PaymentSettingsEditor({ organizationId, initial }: { organizationId: string; initial: PaymentSettings }) {
  const { t } = useI18n();
  const [cod, setCod] = useState(initial.cod_enabled);
  const [instapay, setInstapay] = useState(initial.instapay_enabled);
  const [address, setAddress] = useState(initial.instapay_address ?? "");
  const [name, setName] = useState(initial.instapay_account_name ?? "");
  const [percent, setPercent] = useState(initial.instapay_deposit_percent === null ? "" : String(initial.instapay_deposit_percent));
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, startSave] = useTransition();
  const readOnly = !initial.can_edit;
  const k = (key: string) => t(`marketplaceSeller.payments.${key}`);

  const percentValue = /^\d{1,3}$/.test(percent.trim()) ? Number(percent.trim()) : null;
  const percentBad = instapay && (percentValue === null || percentValue < 1 || percentValue > 100);

  const save = () => {
    setMessage(null);
    if (percentBad) {
      setMessage({ ok: false, text: k("percentInvalid") });
      return;
    }
    startSave(async () => {
      const r = await savePaymentSettingsAction(organizationId, {
        cod_enabled: cod,
        instapay_enabled: instapay,
        instapay_address: address,
        instapay_account_name: name,
        instapay_deposit_percent: percentValue,
      });
      if (!r.ok) {
        setMessage({ ok: false, text: t(`marketplaceSeller.orderError.${orderErrorCode(r.code)}`) });
        return;
      }
      setMessage({ ok: true, text: k("saved") });
    });
  };

  const card = "rounded-md border bg-surface p-md shadow-card";
  return (
    <div className="flex flex-col gap-lg">
      {readOnly ? <p className="rounded-sm border border-dashed p-sm text-label text-fg-secondary">{k("readOnly")}</p> : null}

      <section className={`${card} opacity-70`} aria-labelledby="pay-gateway">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h2 id="pay-gateway" className="flex items-center gap-sm text-title text-fg">
            <ShieldIcon size={20} />
            {k("gatewayTitle")}
          </h2>
          <span className="rounded-full border px-sm py-0.5 text-caption font-semibold text-fg-secondary">{k("soon")}</span>
        </div>
        <p className="mt-1 text-label text-fg-secondary">{k("gatewayHint")}</p>
      </section>

      <section className={card} aria-labelledby="pay-cod">
        <h2 id="pay-cod" className="flex items-center gap-sm text-title text-fg">
          <MoneyIcon size={20} />
          {k("codTitle")}
        </h2>
        <p className="mt-1 text-label text-fg-secondary">{k("codHint")}</p>
        <div className="mt-md">
          <Checkbox id="pay-cod-on" name="cod" checked={cod} onChange={(on) => { setMessage(null); setCod(on); }}>
            {k("codLabel")}
          </Checkbox>
        </div>
      </section>

      <section className={card} aria-labelledby="pay-instapay">
        <h2 id="pay-instapay" className="flex items-center gap-sm text-title text-fg">
          <ReceiptIcon size={20} />
          {k("instapayTitle")}
        </h2>
        <p className="mt-1 text-label text-fg-secondary">{k("instapayHint")}</p>
        <div className="mt-md flex flex-col gap-md">
          <Checkbox id="pay-instapay-on" name="instapay" checked={instapay} onChange={(on) => { setMessage(null); setInstapay(on); }}>
            {k("instapayLabel")}
          </Checkbox>
          {instapay ? (
            <div className="grid gap-md tablet:grid-cols-2">
              <label className="flex flex-col gap-1 text-label text-fg">
                {k("address")}
                <Input value={address} dir="ltr" maxLength={100} disabled={readOnly} onChange={(e) => setAddress(e.target.value)} />
                <span className="text-caption text-fg-secondary">{k("addressHint")}</span>
              </label>
              <label className="flex flex-col gap-1 text-label text-fg">
                {k("accountName")}
                <Input value={name} maxLength={100} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-label text-fg">
                {k("percent")}
                <Input
                  value={percent}
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={3}
                  disabled={readOnly}
                  aria-invalid={percentBad || undefined}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <span className="text-caption text-fg-secondary">{k("percentHint")}</span>
              </label>
            </div>
          ) : null}
        </div>
      </section>

      {!cod && !instapay ? <p className="text-label text-warning" role="status">{k("noneOn")}</p> : null}

      <div className="flex flex-wrap items-center gap-sm">
        <Button variant="accent" onClick={save} disabled={saving || readOnly} aria-busy={saving}>
          {saving ? k("saving") : k("save")}
        </Button>
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-label text-success" : "text-label text-danger"}>
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
