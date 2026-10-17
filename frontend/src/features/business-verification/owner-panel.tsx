"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, LabeledField, Select, SubmitButton, Textarea } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { TrashIcon, UploadIcon } from "@/components/ui/icons";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BV_ALLOWED_TYPES, BV_BUCKET, BV_DOC_TYPES, BV_MAX_DRAFTS, BV_NOTE_MAX, validateBvFile, type BvDocType } from "@/lib/business-verification/contract";
import { confirmBvUploadAction, removeBvDocumentAction, requestBvUploadAction, submitBvAction } from "@/server/actions/business-verification";
import type { FormState } from "@/server/actions/sales-forms";
import type { BvDocument } from "@/server/queries/business-verification";
import { BvDocumentRow } from "./parts";

/**
 * The owner's working area: add documents (ticket -> bytes to the private bucket under the server-minted key
 * -> confirm), remove an unsubmitted one, then send the request. `canUpload` / `canSubmit` come from the
 * database's own view of the request and only decide what chrome is drawn; every RPC re-checks.
 */
export function BvOwnerPanel({
  orgId,
  drafts,
  canUpload,
  canSubmit,
  isResubmission,
}: {
  orgId: string;
  drafts: BvDocument[];
  canUpload: boolean;
  canSubmit: boolean;
  isResubmission: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<BvDocType>("commercial_register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [state, submit] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await submitBvAction(prev, fd);
    if (res.ok) {
      setNote("");
      router.refresh();
    }
    return res;
  }, { ok: false } as FormState);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setNotice(null);
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const valid = validateBvFile(file);
    if (!valid.ok) return setError(t(valid.code));
    setBusy(true);
    try {
      const ticket = await requestBvUploadAction({ orgId, docType, contentType: file.type, sizeBytes: file.size, fileName: file.name });
      if (!ticket.ok) throw new Error(ticket.code);
      const supabase = createBrowserSupabaseClient();
      const { error: uploadError } = await supabase.storage.from(BV_BUCKET).upload(ticket.key, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error("businessVerification.errors.upload");
      const confirmed = await confirmBvUploadAction(ticket.key);
      if (!confirmed.ok) throw new Error(confirmed.code);
      setNotice(t("businessVerification.owner.uploaded"));
      router.refresh();
    } catch (err) {
      const code = err instanceof Error && err.message.includes(".") ? err.message : "businessVerification.errors.upload";
      setError(t(code));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await removeBvDocumentAction(id);
    setBusy(false);
    if (!res.ok) return setError(t(res.code));
    router.refresh();
  };

  const full = drafts.length >= BV_MAX_DRAFTS;
  const noteOver = note.length > BV_NOTE_MAX;

  return (
    <div className="flex flex-col gap-lg" data-testid="bv-owner-panel">
      {canUpload ? (
        <div className="flex flex-col gap-md">
          <div className="grid gap-md tablet:grid-cols-[minmax(0,16rem)_auto] tablet:items-end">
            <LabeledField label={t("businessVerification.owner.docType")} htmlFor="bv-doc-type">
              <Select id="bv-doc-type" value={docType} onChange={(e) => setDocType(e.target.value as BvDocType)} disabled={busy}>
                {BV_DOC_TYPES.map((d) => <option key={d} value={d}>{t(`businessVerification.docType.${d}`)}</option>)}
              </Select>
            </LabeledField>
            <div>
              <input
                ref={inputRef}
                id="bv-file"
                type="file"
                accept={BV_ALLOWED_TYPES.join(",")}
                className="sr-only"
                onChange={onPick}
                disabled={busy || full}
                aria-label={t("businessVerification.owner.addDocument")}
                data-testid="bv-file-input"
              />
              <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy || full} data-testid="bv-add-document">
                <UploadIcon size={16} />
                {busy ? t("businessVerification.owner.uploading") : t("businessVerification.owner.addDocument")}
              </Button>
            </div>
          </div>
          <p className="text-label text-fg-muted">{t("businessVerification.owner.fileHint", { max: BV_MAX_DRAFTS })}</p>
          {drafts.length > 0 ? (
            <div className="flex flex-col gap-sm">
              <p className="text-label font-medium text-fg-secondary">{t("businessVerification.owner.drafts")}</p>
              <ul className="flex flex-col gap-1.5">
                {drafts.map((d) => (
                  <BvDocumentRow
                    key={d.id}
                    d={d}
                    t={t}
                    locale={locale}
                    action={
                      <Button variant="ghost" size="sm" onClick={() => onRemove(d.id)} disabled={busy} aria-label={t("businessVerification.owner.remove", { name: d.fileName })}>
                        <TrashIcon size={15} />
                      </Button>
                    }
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-body text-fg-muted">{t("businessVerification.owner.noDrafts")}</p>
          )}
          {error ? <InlineError>{error}</InlineError> : null}
          {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
        </div>
      ) : null}

      {canSubmit ? (
        <form action={submit} className="flex flex-col gap-md border-t pt-md">
          <input type="hidden" name="orgId" value={orgId} />
          <LabeledField
            label={isResubmission ? t("businessVerification.owner.answerLabel") : t("businessVerification.owner.noteLabel")}
            htmlFor="bv-note"
            optional={isResubmission ? undefined : t("common.optional")}
            hint={isResubmission ? t("businessVerification.owner.answerHint") : undefined}
            error={noteOver ? t("businessVerification.errors.noteTooLong") : undefined}
          >
            <Textarea id="bv-note" name="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={noteOver || undefined} dir="auto" />
          </LabeledField>
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
          {state.ok && state.code ? <InlineSuccess>{t(state.code)}</InlineSuccess> : null}
          <div>
            <SubmitButton variant="accent" disabled={noteOver || busy} pendingLabel={t("businessVerification.owner.sending")} data-testid="bv-submit">
              {isResubmission ? t("businessVerification.owner.resubmit") : t("businessVerification.owner.submit")}
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
