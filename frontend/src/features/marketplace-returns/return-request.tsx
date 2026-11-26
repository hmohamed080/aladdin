"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, Checkbox, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES } from "@/lib/storage/marketplace-images";
import { formatEgp } from "@/lib/ui/egp-format";
import { confirmEvidenceAction, createReturnAction, evidenceUrlAction, removeEvidenceAction, requestEvidenceUploadAction } from "@/server/actions/marketplace-returns";
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
  // every confirmed photo still waiting for a request; only the ticked ones are sent
  const [photos, setPhotos] = useState<{ id: string; key: string; include: boolean }[]>([]);
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
  const accepts = (l: Eligibility["lines"][number]) => (reason ? lineAcceptsClaim(l, reason.claim_type) : l.returnable_quantity > 0);
  // a quantity typed under another reason stays out of the request while this reason refuses its line
  const lines = eligibility.lines
    .filter((l) => accepts(l) && (quantities[l.item_id] ?? 0) > 0)
    .map((l) => ({ item_id: l.item_id, quantity: quantities[l.item_id]! }));
  const evidenceIds = photos.filter((p) => p.include).map((p) => p.id);
  const problem = draftProblem({ lines, eligibility, reason, evidenceCount: evidenceIds.length });
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
      // the database answers every confirmed photo still waiting, including ones from an earlier visit: those are listed
      // but not ticked, and a photo the buyer unticked stays unticked
      setPhotos((before) =>
        done.evidence.map((e) => ({
          id: e.id,
          key: e.object_key,
          include: before.find((p) => p.id === e.id)?.include ?? e.id === ticket.evidenceId,
        })),
      );
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };

  const view = async (objectKey: string) => {
    const r = await evidenceUrlAction(objectKey);
    if (r.ok) window.open(r.url, "_blank", "noopener");
    else setError(returnErrorText(locale, r.code));
  };

  const remove = async (id: string) => {
    setError(null);
    const r = await removeEvidenceAction(id);
    if (r.ok) setPhotos((all) => all.filter((p) => p.id !== id));
    else setError(returnErrorText(locale, r.code));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !reason) return;
    start(async () => {
      setError(null);
      const r = await createReturnAction({ orderId, kind, lines, reasonPresetId: reason.id, note, evidenceIds, idempotencyKey: key });
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
      <div className={card} role="radiogroup" aria-label={c.kind}>
        <p className="text-body font-semibold">{c.kind}</p>
        {(["return", "exchange"] as const).map((k) => (
          <label key={k} className="flex items-center gap-sm text-body">
            <input type="radio" name="return-kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === "return" ? c.kindReturn : c.kindExchange}
          </label>
        ))}
      </div>

      <div className={card} role="radiogroup" aria-label={c.reason}>
        <p className="text-body font-semibold">{c.reason}</p>
        {reasons.map((r) => (
          <label key={r.id} className="flex items-center gap-sm text-body">
            <input type="radio" name="return-reason" checked={reasonId === r.id} onChange={() => setReasonId(r.id)} />
            <span>
              {locale === "ar" ? r.label_ar : r.label_en}
              <span className="text-caption text-fg-secondary">
                {" — "}
                {r.shipping_payer === "seller" ? c.shippingSeller : c.shippingBuyer}
                {r.requires_evidence ? ` · ${c.photoRequired}` : ""}
              </span>
            </span>
          </label>
        ))}
        {generalClosed ? <p className="text-caption text-fg-secondary">{c.generalClosed}</p> : null}
      </div>

      <div className={card} role="group" aria-label={c.items}>
        <p className="text-body font-semibold">{c.items}</p>
        {eligibility.lines.map((l) => {
          const accepted = accepts(l);
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
      </div>

      <div className={card}>
        <LabeledField label={c.note} htmlFor="return-note">
          <Textarea id="return-note" maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </LabeledField>
        <p className="text-body font-semibold">{c.photos(evidenceIds.length, MAX_EVIDENCE)}</p>
        <p className="text-caption text-fg-secondary">{c.photosHint}</p>
        <input ref={file} data-testid="return-photo-input" type="file" hidden accept={MARKETPLACE_IMAGE_ALLOWED_TYPES.join(",")} onChange={(e) => void upload(e.target.files?.[0])} />
        <div className="flex flex-wrap gap-sm">
          <Button variant="outline" size="sm" disabled={uploading || photos.length >= MAX_EVIDENCE} onClick={() => file.current?.click()}>
            {uploading ? c.uploading : c.addPhoto}
          </Button>
        </div>
        {photos.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-sm">
            <Checkbox id={`return-photo-${p.id}`} name="return-photo" checked={p.include} onChange={(v) => setPhotos((all) => all.map((x) => (x.id === p.id ? { ...x, include: v } : x)))}>
              {c.attach(i + 1)}
            </Checkbox>
            <Button variant="ghost" size="sm" onClick={() => void view(p.key)}>{c.view}</Button>
            <Button variant="ghost" size="sm" aria-label={c.removeNth(i + 1)} onClick={() => void remove(p.id)}>{c.remove}</Button>
          </div>
        ))}
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
