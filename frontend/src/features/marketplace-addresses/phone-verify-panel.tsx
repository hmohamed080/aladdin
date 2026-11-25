"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import { startPrimaryPhoneVerification, verifyPrimaryPhone, type PhoneVerificationActionResult } from "@/server/actions/phone-verification";

type Stage = { name: "idle" } | { name: "sent"; challengeId: string } | { name: "done" };

/**
 * Proves the buyer's OWN account mobile through the existing phone verification authority (WhatsApp code), the same two server
 * actions the rest of the product uses. This panel owns no code, no timer and no number: it never receives or shows the code and
 * never sends the number; the server knows the account's phone. While the authority is switched off (its default) every answer is
 * "unavailable" and the panel says so plainly. A verified number flips every address that uses it, by derivation in the database.
 */
export function PhoneVerifyPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "error" | "info"; key: string } | null>(null);

  function show(r: PhoneVerificationActionResult) {
    switch (r.status) {
      case "sent":
        setStage({ name: "sent", challengeId: r.challengeId });
        setNote({ tone: "info", key: "buyerAddresses.phone.sent" });
        return;
      case "verified":
      case "already_verified":
        setStage({ name: "done" });
        setNote(null);
        router.refresh();
        return;
      case "invalid":
        setNote({ tone: "error", key: "buyerAddresses.phone.wrong" });
        return;
      case "rate_limited":
        setNote({ tone: "error", key: "buyerAddresses.phone.rateLimited" });
        return;
      default:
        setNote({ tone: "error", key: "buyerAddresses.phone.unavailable" });
    }
  }

  async function send() {
    setBusy(true);
    show(await startPrimaryPhoneVerification());
    setBusy(false);
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // the OTP control keeps the combined digits in a hidden input named "code"; read them at submit so a corrected digit is never stale
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    if (stage.name !== "sent" || !/^\d{6}$/.test(code)) {
      setNote({ tone: "error", key: "buyerAddresses.phone.wrong" });
      return;
    }
    setBusy(true);
    show(await verifyPrimaryPhone(stage.challengeId, code));
    setBusy(false);
  }

  if (stage.name === "done") return <InlineSuccess>{t("buyerAddresses.phone.done")}</InlineSuccess>;
  return (
    <div className="flex flex-col gap-sm" data-testid="phone-verify-panel">
      {stage.name === "idle" ? (
        <Button size="sm" onClick={send} disabled={busy}>{t("buyerAddresses.phone.sendCode")}</Button>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-sm">
          <label className="text-label font-medium text-fg-secondary" htmlFor="phone-verify-code">{t("buyerAddresses.phone.codeLabel")}</label>
          <OtpInput name="code" id="phone-verify-code" autoFocus />
          <div className="flex gap-sm">
            <Button type="submit" size="sm" disabled={busy}>{t("buyerAddresses.phone.verify")}</Button>
            <Button variant="ghost" size="sm" onClick={send} disabled={busy}>{t("buyerAddresses.phone.resend")}</Button>
          </div>
        </form>
      )}
      {note ? (note.tone === "error" ? <InlineError>{t(note.key)}</InlineError> : <p className="text-label text-fg-secondary" role="status">{t(note.key)}</p>) : null}
    </div>
  );
}
