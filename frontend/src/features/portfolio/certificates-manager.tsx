"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, InlineError, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollIcon, FileTextIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/ui/format";
import type { Certificate } from "@/server/queries/portfolio";
import {
  certificateViewUrlAction,
  deleteCertificateAction,
  finishCertificateUpload,
  startCertificateUpload,
  updateCertificateAction,
} from "@/server/actions/portfolio";
import { AddPanel, AssetFileField } from "./parts";
import { uploadAsset } from "./upload";

/**
 * Certificates.
 *
 * A LIST, NOT A GALLERY, and that is the product difference showing through the
 * composition. A portfolio item is looked at; a certificate is checked — name,
 * who issued it, when it runs out — so the facts lead and the file is something
 * you open rather than something you browse.
 *
 * WHAT IS ABSENT HERE IS THE POINT (S2). No publish control, because there is no
 * public path to publish onto. No verified badge, no "pending review", no issuer
 * lookup, no platform mark of any kind: the product stores what a person says
 * they hold and vouches for none of it. The one thing the page does add is the
 * fact the holder needs and can act on — whether a certificate has expired —
 * which is arithmetic on their own date, not a judgement about the document.
 */
export function CertificatesManager({ items }: { items: Certificate[] }) {
  const { t } = useI18n();
  const usable = items.filter((c) => !c.pending);
  const unfinished = items.filter((c) => c.pending);

  return (
    <div className="flex flex-col gap-xl" data-testid="certificates-manager">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-headline text-fg">{t("certificates.title")}</h1>
          <p className="max-w-prose text-body text-fg-secondary">{t("certificates.subtitle")}</p>
        </div>
        <AddCertificate />
      </div>

      <p className="rounded-md border bg-surface-2 px-4 py-3 text-label text-fg-secondary">
        {t("certificates.privateEvidence")}
      </p>

      {unfinished.length > 0 ? (
        <section className="flex flex-col gap-md" aria-label={t("certificates.unfinished.title")}>
          <h2 className="text-title text-fg">{t("certificates.unfinished.title")}</h2>
          {unfinished.map((c) => (
            <UnfinishedRow key={c.id} item={c} />
          ))}
        </section>
      ) : null}

      {usable.length === 0 ? (
        <StatePanel
          icon={<ScrollIcon size={22} />}
          title={t("certificates.empty.title")}
          body={t("certificates.empty.body")}
        />
      ) : (
        <ul className="flex flex-col gap-md">
          {usable.map((c) => (
            <CertificateRow key={c.id} item={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CertificateRow({ item }: { item: Certificate }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const expired = item.expiresOn !== null && item.expiresOn < new Date().toISOString().slice(0, 10);

  const facts = [
    item.issuer,
    item.issuedOn ? t("certificates.issuedOn", { date: formatDate(item.issuedOn, locale) }) : null,
    item.expiresOn ? t("certificates.expiresOn", { date: formatDate(item.expiresOn, locale) }) : null,
  ].filter(Boolean) as string[];

  return (
    <li>
      <Card pad="sm" className="flex flex-col gap-md">
        {editing ? (
          <EditForm item={item} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-md">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-fg-secondary">
                <FileTextIcon size={20} />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-title text-fg">
                    <bdi dir="auto">{item.title}</bdi>
                  </h3>
                  {/* The only badge in this domain, and it states a date that has
                      passed — never an opinion about the document. */}
                  {expired ? <Badge tone="warning">{t("certificates.expired")}</Badge> : null}
                </div>
                {facts.length > 0 ? (
                  <p className="text-label text-fg-secondary">
                    <bdi dir="auto">{facts.join(" · ")}</bdi>
                  </p>
                ) : null}
                <p className="text-label text-fg-muted">
                  {t(`certificates.fileType.${item.contentType === "application/pdf" ? "pdf" : "image"}`)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ViewButton objectPath={item.objectPath} />
              <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
                {t("certificates.actions.edit")}
              </Button>
              <ConfirmDialog
                trigger={t("certificates.actions.delete")}
                triggerVariant="ghost"
                title={t("certificates.delete.title")}
                body={t("certificates.delete.body")}
                confirmLabel={t("certificates.delete.confirm")}
                formAction={deleteCertificateAction}
              >
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="objectPath" value={item.objectPath} />
              </ConfirmDialog>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}

/**
 * Opening the file.
 *
 * The URL is minted ON DEMAND rather than rendered into the page, because a
 * certificate URL in server-rendered HTML would sit in the document, in the
 * browser cache and in any copy of that page for as long as it lives — for a
 * document nobody but its owner should ever see. A portfolio preview is the
 * opposite case and IS rendered inline: those images were chosen to be looked at.
 */
function ViewButton({ objectPath }: { objectPath: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await certificateViewUrlAction(objectPath);
          setBusy(false);
          if (!result.ok) {
            setError(result.code);
            return;
          }
          window.open(result.url, "_blank", "noopener,noreferrer");
        }}
      >
        {t("certificates.actions.view")}
      </Button>
      {error ? <InlineError>{t(error)}</InlineError> : null}
    </>
  );
}

function UnfinishedRow({ item }: { item: Certificate }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, finish] = useActionState(async () => {
    const result = await finishCertificateUpload(item.id);
    if (result.ok) router.refresh();
    return result;
  }, { ok: true } as { ok: boolean; code?: string });

  return (
    <Card pad="sm" className="flex flex-wrap items-center justify-between gap-md">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-title text-fg">
          <bdi dir="auto">{item.title}</bdi>
        </p>
        <p className="text-label text-fg-muted">{t("certificates.unfinished.hint")}</p>
        {state.ok ? null : <InlineError>{t(state.code ?? "states.genericRetry")}</InlineError>}
      </div>
      <div className="flex items-center gap-2">
        <form action={finish}>
          <SubmitButton variant="outline">{t("certificates.unfinished.finish")}</SubmitButton>
        </form>
        <ConfirmDialog
          trigger={t("certificates.unfinished.discard")}
          triggerVariant="ghost"
          title={t("certificates.delete.title")}
          body={t("certificates.delete.body")}
          confirmLabel={t("certificates.unfinished.discard")}
          formAction={deleteCertificateAction}
        >
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="objectPath" value={item.objectPath} />
        </ConfirmDialog>
      </div>
    </Card>
  );
}

function EditForm({ item, onDone }: { item: Certificate; onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, dispatch] = useActionState(
    async (prev: { ok: boolean; code?: string }, fd: FormData) => {
      const result = await updateCertificateAction(prev, fd);
      if (result.ok) {
        router.refresh();
        onDone();
      }
      return result;
    },
    { ok: true },
  );

  return (
    <form action={dispatch} className="flex flex-col gap-md">
      <input type="hidden" name="itemId" value={item.id} />
      <CertificateFields defaults={item} idPrefix={item.id} />
      {state.ok ? null : <InlineError>{t(state.code ?? "states.genericRetry")}</InlineError>}
      <div className="flex items-center gap-2">
        <SubmitButton variant="primary">{t("certificates.form.save")}</SubmitButton>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("certificates.form.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The metadata fields, shared by add and edit so the two cannot drift apart. */
function CertificateFields({
  defaults,
  idPrefix,
}: {
  defaults?: Pick<Certificate, "title" | "issuer" | "issuedOn" | "expiresOn">;
  idPrefix: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <LabeledField label={t("certificates.form.title")} htmlFor={`c-title-${idPrefix}`}>
        <Input
          id={`c-title-${idPrefix}`}
          name="title"
          required
          maxLength={160}
          dir="auto"
          defaultValue={defaults?.title ?? ""}
        />
      </LabeledField>
      <LabeledField label={t("certificates.form.issuer")} htmlFor={`c-issuer-${idPrefix}`}>
        <Input
          id={`c-issuer-${idPrefix}`}
          name="issuer"
          maxLength={160}
          dir="auto"
          defaultValue={defaults?.issuer ?? ""}
        />
      </LabeledField>
      <div className="grid gap-md tablet:grid-cols-2">
        <LabeledField label={t("certificates.form.issuedOn")} htmlFor={`c-issued-${idPrefix}`}>
          <Input
            id={`c-issued-${idPrefix}`}
            name="issuedOn"
            type="date"
            defaultValue={defaults?.issuedOn ?? ""}
          />
        </LabeledField>
        <LabeledField label={t("certificates.form.expiresOn")} htmlFor={`c-expires-${idPrefix}`}>
          <Input
            id={`c-expires-${idPrefix}`}
            name="expiresOn"
            type="date"
            defaultValue={defaults?.expiresOn ?? ""}
          />
        </LabeledField>
      </div>
    </>
  );
}

function AddCertificate() {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AddPanel label={t("certificates.add")} title={t("certificates.form.heading")}>
      {(close) => (
        <form
          className="flex flex-col gap-md"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            if (!file) {
              setError("certificates.errors.fileRequired");
              return;
            }
            const read = (name: string) => {
              const v = String(data.get(name) ?? "").trim();
              return v === "" ? null : v;
            };
            setBusy(true);
            setError(null);
            const result = await uploadAsset(
              "certificate",
              file,
              () =>
                startCertificateUpload({
                  title: String(data.get("title") ?? ""),
                  issuer: read("issuer"),
                  issuedOn: read("issuedOn"),
                  expiresOn: read("expiresOn"),
                  contentType: file.type,
                  size: file.size,
                  // Kept for the owner's own recognition. It never becomes part
                  // of a key and never fetches anything.
                  originalFilename: file.name,
                }),
              finishCertificateUpload,
            );
            setBusy(false);
            if (!result.ok) {
              setError(result.code);
              return;
            }
            form.reset();
            setFile(null);
            close();
            router.refresh();
          }}
        >
          <CertificateFields idPrefix="new" />
          <AssetFileField namespace="certificate" onPick={setFile} />
          {error ? <InlineError>{t(error)}</InlineError> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t("certificates.form.uploading") : t("certificates.form.upload")}
            </Button>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              {t("certificates.form.cancel")}
            </Button>
          </div>
        </form>
      )}
    </AddPanel>
  );
}
