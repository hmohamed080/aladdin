"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, InlineError, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, SubmitButton, Textarea } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LayersIcon, AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { PortfolioItem } from "@/server/queries/portfolio";
import {
  deletePortfolioItemAction,
  finishPortfolioUpload,
  movePortfolioItemAction,
  setPortfolioVisibilityAction,
  startPortfolioUpload,
  updatePortfolioItemAction,
} from "@/server/actions/portfolio";
import { AddPanel, AssetFileField, MediaFrame, QuickAction, VisibilityBadge } from "./parts";
import { uploadAsset } from "./upload";

/** One item plus the short-lived URL the server minted for its preview. */
export type PortfolioCard = PortfolioItem & { previewUrl: string | null };

/**
 * The Portfolio manager.
 *
 * COMPOSITION: image first, always. The reference gallery earns its density from
 * photographs, and a grid of text cards with a thumbnail bolted on would be the
 * "sparse generic card page" §9 warns about — so the media frame is the card's
 * subject and the metadata sits under it, in the space a caption occupies.
 *
 * WHAT EACH CARD SAYS, in the order it says it: the work, then whether anyone
 * else can see it, then what you can do about that. Publication is the fact a
 * person comes to this page to check, so it is a badge on the image rather than a
 * line of text below the fold.
 */
export function PortfolioManager({ items }: { items: PortfolioCard[] }) {
  const { t } = useI18n();
  const usable = items.filter((i) => !i.pending);
  const unfinished = items.filter((i) => i.pending);

  return (
    <div className="flex flex-col gap-xl" data-testid="portfolio-manager">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading text-fg">{t("portfolio.title")}</h1>
          <p className="max-w-prose text-body text-fg-secondary">{t("portfolio.subtitle")}</p>
        </div>
        <AddWork />
      </div>

      {/* The one rule a person needs before they upload anything, said once and
          kept short. It is not a warning — private is the good default — so it
          reads as information rather than as a caution strip. */}
      <p className="rounded-md border border-line bg-surface-sunken px-4 py-3 text-label text-fg-secondary">
        {t("portfolio.privateByDefault")}
      </p>

      {unfinished.length > 0 ? (
        <section className="flex flex-col gap-md" aria-label={t("portfolio.unfinished.title")}>
          <h2 className="text-title text-fg">{t("portfolio.unfinished.title")}</h2>
          <p className="text-label text-fg-muted">{t("portfolio.unfinished.body")}</p>
          <div className="flex flex-col gap-md">
            {unfinished.map((item) => (
              <UnfinishedCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {usable.length === 0 ? (
        <StatePanel
          icon={<LayersIcon size={22} />}
          title={t("portfolio.empty.title")}
          body={t("portfolio.empty.body")}
        />
      ) : (
        <ul className="grid gap-lg tablet:grid-cols-2 desktop:grid-cols-3">
          {usable.map((item, index) => (
            <WorkCard
              key={item.id}
              item={item}
              isFirst={index === 0}
              isLast={index === usable.length - 1}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A finished item.
 *
 * `dir="auto"` on the title and the description because both are user-entered and
 * an English title in the Arabic workspace would otherwise be clipped from its
 * front — the same defect the Jobs list carried until Increment 9, and the same
 * fix, applied where the text is rather than where the locale is.
 */
function WorkCard({
  item,
  isFirst,
  isLast,
}: {
  item: PortfolioCard;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  return (
    <li>
      <Card pad="sm" className="flex h-full flex-col gap-md">
        <MediaFrame>
          {item.previewUrl ? (
            // A signed, short-lived Storage URL cannot be optimised by
            // next/image without a loader that would cache it past its expiry.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.previewUrl}
              alt={item.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-fg-muted">
              <AlertIcon size={20} />
            </div>
          )}
          {/* The badge needs the product's OWN surface under it. `Badge` fills at
              15% alpha by design, which is right on a card and unreadable on a
              photograph — the contrast would depend on whichever pixels happened
              to be behind it. An opaque backing restores exactly the contrast the
              badge has everywhere else, without a second badge style. */}
          <span className="absolute end-2 top-2 rounded-pill bg-surface p-0.5 shadow-card">
            <VisibilityBadge isPublic={item.isPublic} />
          </span>
        </MediaFrame>

        {editing ? (
          <EditForm item={item} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 dir="auto" className="truncate text-title text-fg">
                {item.title}
              </h3>
              {item.description ? (
                <p dir="auto" className="line-clamp-2 text-label text-fg-secondary">
                  {item.description}
                </p>
              ) : null}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2">
              <QuickAction
                action={setPortfolioVisibilityAction}
                fields={{ itemId: item.id, public: item.isPublic ? "0" : "1" }}
                label={t(item.isPublic ? "portfolio.actions.unpublish" : "portfolio.actions.publish")}
                variant={item.isPublic ? "outline" : "accent"}
              />
              <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
                {t("portfolio.actions.edit")}
              </Button>
              <ConfirmDialog
                trigger={t("portfolio.actions.delete")}
                triggerVariant="ghost"
                title={t("portfolio.delete.title")}
                body={t("portfolio.delete.body")}
                confirmLabel={t("portfolio.delete.confirm")}
                formAction={deletePortfolioItemAction}
              >
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="objectKey" value={item.objectKey} />
              </ConfirmDialog>

              {/* Order is a property of the gallery, so its controls sit at the
                  end of the row rather than among the per-item verbs.

                  `rtl:-scale-x-100` because an SVG does NOT mirror with `dir` —
                  a visual check at 390px in Arabic found "move earlier" pointing
                  the way "later" reads. It is the pattern `supply-boards` already
                  uses for its arrow: logical, not physical, and a CSS rule rather
                  than the locale branch R5 forbids inside a component. */}
              <span className="ms-auto flex items-center gap-1">
                <QuickAction
                  action={movePortfolioItemAction}
                  fields={{ itemId: item.id, direction: "up" }}
                  label={<ChevronLeftIcon size={16} className="rtl:-scale-x-100" />}
                  ariaLabel={t("portfolio.actions.moveEarlier")}
                  variant="ghost"
                  disabled={isFirst}
                />
                <QuickAction
                  action={movePortfolioItemAction}
                  fields={{ itemId: item.id, direction: "down" }}
                  label={<ChevronRightIcon size={16} className="rtl:-scale-x-100" />}
                  ariaLabel={t("portfolio.actions.moveLater")}
                  variant="ghost"
                  disabled={isLast}
                />
              </span>
            </div>
          </>
        )}
      </Card>
    </li>
  );
}

/**
 * An upload that never finished (§7).
 *
 * It is shown, not hidden, because the alternative is a person who uploaded
 * something seeing nothing and trying again — accumulating rows nobody ever
 * cleans. Two honest options: FINISH, which re-runs the idempotent finalize and
 * succeeds if the bytes did arrive, and DISCARD, which runs the same convergent
 * removal a real delete runs.
 */
function UnfinishedCard({ item }: { item: PortfolioCard }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, finish] = useActionState(async () => {
    const result = await finishPortfolioUpload(item.id);
    if (result.ok) router.refresh();
    return result;
  }, { ok: true } as { ok: boolean; code?: string });

  return (
    <Card pad="sm" className="flex flex-wrap items-center justify-between gap-md">
      <div className="flex min-w-0 flex-col gap-1">
        <p dir="auto" className="truncate text-title text-fg">
          {item.title}
        </p>
        <p className="text-label text-fg-muted">{t("portfolio.unfinished.hint")}</p>
        {state.ok ? null : <InlineError>{t(state.code ?? "states.genericRetry")}</InlineError>}
      </div>
      <div className="flex items-center gap-2">
        <form action={finish}>
          <SubmitButton variant="outline">{t("portfolio.unfinished.finish")}</SubmitButton>
        </form>
        <ConfirmDialog
          trigger={t("portfolio.unfinished.discard")}
          triggerVariant="ghost"
          title={t("portfolio.unfinished.discardTitle")}
          body={t("portfolio.unfinished.discardBody")}
          confirmLabel={t("portfolio.unfinished.discard")}
          formAction={deletePortfolioItemAction}
        >
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="objectKey" value={item.objectKey} />
        </ConfirmDialog>
      </div>
    </Card>
  );
}

function EditForm({ item, onDone }: { item: PortfolioCard; onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, dispatch] = useActionState(
    async (prev: { ok: boolean; code?: string }, fd: FormData) => {
      const result = await updatePortfolioItemAction(prev, fd);
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
      <LabeledField label={t("portfolio.form.title")} htmlFor={`title-${item.id}`}>
        <Input id={`title-${item.id}`} name="title" defaultValue={item.title} required maxLength={120} dir="auto" />
      </LabeledField>
      <LabeledField label={t("portfolio.form.description")} htmlFor={`desc-${item.id}`}>
        <Textarea
          id={`desc-${item.id}`}
          name="description"
          defaultValue={item.description ?? ""}
          rows={3}
          maxLength={600}
          dir="auto"
        />
      </LabeledField>
      {state.ok ? null : <InlineError>{t(state.code ?? "states.genericRetry")}</InlineError>}
      <div className="flex items-center gap-2">
        <SubmitButton variant="primary">{t("portfolio.form.save")}</SubmitButton>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("portfolio.form.cancel")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Adding work: validate, create the row, upload, finalize.
 *
 * A plain `onSubmit` rather than a server action, because the bytes go straight
 * from this browser to Storage and never through the Next server. `uploadAsset`
 * owns the sequence and its recovery rules; this component owns the form.
 */
function AddWork() {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AddPanel label={t("portfolio.add")} title={t("portfolio.form.heading")}>
      {(close) => (
        <form
          className="flex flex-col gap-md"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const title = String(data.get("title") ?? "");
            const description = String(data.get("description") ?? "");
            if (!file) {
              setError("portfolio.errors.fileRequired");
              return;
            }
            setBusy(true);
            setError(null);
            const result = await uploadAsset(
              "portfolio",
              file,
              () =>
                startPortfolioUpload({
                  title,
                  description: description || null,
                  contentType: file.type,
                  size: file.size,
                }),
              finishPortfolioUpload,
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
          <LabeledField label={t("portfolio.form.title")} htmlFor="new-title">
            <Input id="new-title" name="title" required maxLength={120} dir="auto" />
          </LabeledField>
          <LabeledField label={t("portfolio.form.description")} htmlFor="new-description">
            <Textarea id="new-description" name="description" rows={3} maxLength={600} dir="auto" />
          </LabeledField>
          <AssetFileField namespace="portfolio" onPick={setFile} />
          {error ? <InlineError>{t(error)}</InlineError> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t("portfolio.form.uploading") : t("portfolio.form.upload")}
            </Button>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              {t("portfolio.form.cancel")}
            </Button>
          </div>
        </form>
      )}
    </AddPanel>
  );
}
