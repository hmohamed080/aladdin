"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES } from "@/lib/storage/marketplace-images";
import { formatEgp } from "@/lib/ui/egp-format";
import { confirmEvidenceAction, createReturnAction, requestEvidenceUploadAction } from "@/server/actions/marketplace-returns";
import { MAX_EVIDENCE, claimWindowOpen, draftProblem, lineAcceptsClaim, openReasons, type Eligibility, type ReturnKind } from "./contract";
import { RETURN_REQUEST_COPY, returnErrorText } from "./copy";

/**
 * The buyer's return or exchange request for one delivered order: which units, why, a note and photos. Everything offered
 * here comes from `marketplace_buyer_return_eligibility`; the database re-checks the windows, the quantities and the photos
 * when the request is sent. One idempotency key per visit, so a double press opens one request.
 */
export function ReturnRequest({ orderId, eligibility, initialKind, locale, now }: {
  orderId: string;
  eligibility: Eligibility;
  initialKind: ReturnKind;
  locale: "ar" | "en";
  /** The server's clock, so both renders offer the same reasons. */
  now: string;
}) {
  const c = RETURN_REQUEST_COPY[locale];
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ReturnKind>(initialKind);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());

  const w = eligibility.window;
  const deadlines = w
    ? { general: new Date(w.general_ends_at), defect: new Date(w.defect_ends_at), transit: new Date(w.transit_ends_at) }
    : null;
  const reasons = deadlines ? openReasons(eligibility.reasons, deadlines, new Date(now)) : [];
  const reason = reasons.find((r) => r.id === reasonId) ?? null;
  const lines = Object.entries(quantities).filter(([, q]) => q > 0).map(([item_id, quantity]) => ({ item_id, quantity }));
  const problem = draftProblem({ lines, eligibility, reason, evidenceCount: photos.length });
  const generalClosed = deadlines ? !claimWindowOpen("general", false, deadlines, new Date(now)) : false;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setUploading(true);
    try {
      const ticket = await requestEvidenceUploadAction(orderId, f.type, f.size);
      if (!ticket.ok) return setError(returnErrorText(locale, ticket.code));
      try {
        await uploadWithGrant(ticket.grant, f);
      } catch {
        return setError(returnErrorText(locale, "upload_failed"));
      }
      const done = await confirmEvidenceAction(ticket.evidenceId, ticket.objectKey);
      if (!done.ok) return setError(returnErrorText(locale, done.code));
      // the database answers every confirmed photo still waiting for a request, including one from an earlier visit
      setPhotos(done.evidence.map((e) => e.id).slice(0, MAX_EVIDENCE));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !reason) return;
    start(async () => {
      setError(null);
      const r = await createReturnAction({ orderId, kind, lines, reasonPresetId: reason.id, note, evidenceIds: photos, idempotencyKey: key });
      if (!r.ok) {
        setError(returnErrorText(locale, r.code));
        return;
      }
      router.push(`/market/returns/${r.return.id}`);
    });
  };

  const card = "grid gap-sm rounded-md border bg-surface p-md";
  return (
    <form onSubmit={submit} className="flex flex-col gap-md">
      <fieldset className={card}>
        <legend className="text-body font-semibold">{c.kind}</legend>
        {(["return", "exchange"] as const).map((k) => (
          <label key={k} className="flex items-center gap-sm text-body">
            <input type="radio" name="return-kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === "return" ? c.kindReturn : c.kindExchange}
          </label>
        ))}
      </fieldset>

      <fieldset className={card}>
        <legend className="text-body font-semibold">{c.reason}</legend>
        {reasons.map((r) => (
          <label key={r.id} className="flex items-center gap-sm text-body">
            <input type="radio" name="return-reason" checked={reasonId === r.id} onChange={() => setReasonId(r.id)} />
            <span>
              {locale === "ar" ? r.label_ar : r.label_en}
              <span className="ms-sm text-caption text-fg-secondary">
                {r.shipping_payer === "seller" ? c.shippingSeller : c.shippingBuyer}
                {r.requires_evidence ? ` · ${c.photoRequired}` : ""}
              </span>
            </span>
          </label>
        ))}
        {generalClosed ? <p className="text-caption text-fg-secondary">{c.generalClosed}</p> : null}
      </fieldset>

      <fieldset className={card}>
        <legend className="text-body font-semibold">{c.items}</legend>
        {eligibility.lines.map((l) => {
          const accepted = reason ? lineAcceptsClaim(l, reason.claim_type) : l.returnable_quantity > 0;
          const id = `return-qty-${l.item_id}`;
          return (
            <LabeledField
              key={l.item_id}
              htmlFor={id}
              label={`${locale === "ar" ? l.name_ar : l.name_en} — ${formatEgp(Number(l.unit_price_egp), locale)}`}
              hint={l.non_returnable ? c.nonReturnable : c.upTo(l.returnable_quantity)}
            >
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                max={l.returnable_quantity}
                disabled={!accepted}
                value={accepted ? String(quantities[l.item_id] ?? 0) : "0"}
                onChange={(e) => setQuantities((q) => ({ ...q, [l.item_id]: Math.max(0, Math.min(l.returnable_quantity, Math.round(Number(e.target.value) || 0))) }))}
              />
            </LabeledField>
          );
        })}
      </fieldset>

      <div className={card}>
        <LabeledField label={c.note} htmlFor="return-note">
          <Textarea id="return-note" maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </LabeledField>
        <p className="text-body font-semibold">{c.photos(photos.length, MAX_EVIDENCE)}</p>
        <p className="text-caption text-fg-secondary">{c.photosHint}</p>
        <input ref={file} data-testid="return-photo-input" type="file" hidden accept={MARKETPLACE_IMAGE_ALLOWED_TYPES.join(",")} onChange={(e) => void upload(e.target.files?.[0])} />
        <div className="flex flex-wrap gap-sm">
          <Button variant="outline" size="sm" disabled={uploading || photos.length >= MAX_EVIDENCE} onClick={() => file.current?.click()}>
            {uploading ? c.uploading : c.addPhoto}
          </Button>
          {photos.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setPhotos([])}>{c.clearPhotos}</Button> : null}
        </div>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}
      {problem ? <p className="text-label text-fg-secondary" role="status">{c.problem[problem]}</p> : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="accent" disabled={Boolean(problem) || pending || uploading}>{pending ? c.sending : c.send}</Button>
        <Link href={`/market/orders/${orderId}`} className="self-center text-label font-medium text-accent hover:underline">{c.back}</Link>
      </div>
    </form>
  );
}
