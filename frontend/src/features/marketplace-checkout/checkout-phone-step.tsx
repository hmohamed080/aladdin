"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/controls";
import { ShieldIcon } from "@/components/ui/icons";
import { PhoneField } from "@/components/ui/phone-field";
import { InlineError } from "@/components/ui/primitives";
import type { CanonicalPhone } from "@/lib/contact/phone";
import { useI18n } from "@/lib/i18n/context";
import { setPhoneAction } from "@/server/actions/profile-identity";
import { maskPhone } from "@/features/marketplace-addresses/address-model";
import { PhoneVerifyPanel } from "@/features/marketplace-addresses/phone-verify-panel";
import styles from "@/features/marketplace/marketplace-cart.module.css";

/** The signed-in buyer's own primary mobile, as the checkout page loaded it. */
export type CheckoutAccountPhone = { e164: string | null; verified: boolean };

const COPY = {
  en: {
    title: "Mobile number",
    add: "Your account has no mobile number. Add it, then verify it with a code to place the order.",
    save: "Save number",
    saving: "Saving…",
    verify: "Verify this number with a WhatsApp code to place the order:",
    change: "Change the number",
    otherNumber: "The chosen address uses another recipient number. An order only accepts your account mobile: edit the address or choose another one.",
    addresses: "Edit addresses",
  },
  ar: {
    title: "رقم الموبايل",
    add: "لا يوجد رقم موبايل في حسابك. أضفه ثم وثّقه برمز لتتمكن من تأكيد الطلب.",
    save: "حفظ الرقم",
    saving: "جارٍ الحفظ…",
    verify: "وثّق هذا الرقم برمز على واتساب لتتمكن من تأكيد الطلب:",
    change: "تغيير الرقم",
    otherNumber: "العنوان المختار يستخدم رقم مستلم آخر. الطلب يقبل رقم موبايل حسابك فقط: عدّل العنوان أو اختر غيره.",
    addresses: "تعديل العناوين",
  },
} as const;

const LINK = "text-label font-medium text-accent hover:underline";

/**
 * What the buyer still has to do about the mobile number, without leaving checkout: add one (accounts that have none), prove it
 * with the existing verification authority, or notice that the chosen address names a different number. The database decides
 * whether the order may be placed; this only asks it again (`onChanged`) after a change.
 */
export function CheckoutPhoneStep({ account, recipientPhone, onChanged }: {
  account: CheckoutAccountPhone | null;
  /** The chosen delivery address's recipient number; null for branch pickup. */
  recipientPhone: string | null;
  onChanged: () => void;
}) {
  const { locale, t } = useI18n();
  const c = COPY[locale];
  const router = useRouter();
  const [phone, setPhone] = useState<CanonicalPhone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const otherNumber = Boolean(account?.e164 && recipientPhone && recipientPhone !== account.e164);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    const fd = new FormData();
    fd.set("countryIso2", phone.countryIso2);
    fd.set("national", phone.national);
    fd.set("e164", phone.e164);
    start(async () => {
      setError(null);
      const r = await setPhoneAction({ ok: false }, fd);
      if (!r.ok) {
        setError(r.code ?? "profileIdentity.phone.error");
        return;
      }
      router.refresh();
      onChanged();
    });
  };

  return (
    <section className={styles.card} aria-labelledby="co-phone">
      <h2 id="co-phone" className={styles.cardTitle} data-plain><ShieldIcon size={20} aria-hidden="true" />{c.title}</h2>
      <div className="flex flex-col gap-sm">
        {!account?.e164 ? (
          <form onSubmit={save} className="flex flex-col gap-sm">
            <p className="text-body">{c.add}</p>
            <PhoneField id="checkout-phone" onChange={setPhone} />
            {error ? <InlineError>{t(error)}</InlineError> : null}
            <div>
              <Button type="submit" size="sm" disabled={!phone || pending}>{pending ? c.saving : c.save}</Button>
            </div>
          </form>
        ) : !account.verified ? (
          <>
            <p className="text-body">{c.verify} <bdi dir="ltr">{maskPhone(account.e164)}</bdi></p>
            <PhoneVerifyPanel onVerified={onChanged} />
            <Link href="/settings/profile" className={LINK}>{c.change}</Link>
          </>
        ) : null}
        {otherNumber ? (
          <>
            <p className="text-label text-warning" role="status">{c.otherNumber}</p>
            <Link href="/settings/addresses" className={LINK}>{c.addresses}</Link>
          </>
        ) : null}
      </div>
    </section>
  );
}
