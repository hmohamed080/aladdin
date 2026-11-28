"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui/controls";
import { CountedTextarea } from "@/components/ui/counted-textarea";
import { InlineError } from "@/components/ui/primitives";
import { DESCRIPTION_MAX_CHARS, isAcceptableEdit } from "@/lib/text/description-limit";
import { useI18n } from "@/lib/i18n/context";
import {
  finishPortfolioMediaUpload,
  finishPortfolioUpload,
  removePortfolioMediaAction,
  startPortfolioMediaUpload,
  startPortfolioUpload,
  type UploadTicket,
} from "@/server/actions/portfolio";
import { MediaPicker, type PickedMedia } from "./media-picker";
import { uploadAsset } from "./upload";

/** A required-field marker that screen readers skip (the input itself carries `required`). */
function Required() {
  return <span className="portfolio-required" aria-hidden="true">*</span>;
}

/**
 * Adding one work: title, description, and up to five files.
 *
 * THE SEQUENCE, and why it is this one. The work is created from its first image
 * (the COVER) exactly as before — `portfolio_item_create` -> bytes ->
 * `portfolio_item_finalize` — because that row is what every extra file hangs off.
 * Each remaining file then follows the same pending -> upload -> finalize path
 * against that work. One file at a time, in the order the person arranged them.
 *
 * IF AN EXTRA FAILS the work is already saved (its cover is ready and private),
 * so the form does NOT start over: it remembers the work, shows which files made
 * it, and pressing the button again uploads only the rest. Starting over would
 * create a second, duplicate work.
 */
export function AddWorkForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<PickedMedia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Set once the cover is saved: the work exists, so a retry must not create another.
  const [workId, setWorkId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<ReadonlySet<string>>(new Set());

  const reset = () => {
    items.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    setTitle("");
    setDescription("");
    setItems([]);
    setError(null);
    setWorkId(null);
    setUploaded(new Set());
    setProgress(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("portfolio.errors.titleRequired");
    if (!description.trim()) return setError("portfolio.errors.descriptionRequired");
    if (!isAcceptableEdit(description, "")) return setError("portfolio.errors.descriptionTooLong");
    const cover = items[0];
    if (!workId && (!cover || cover.kind !== "image")) return setError("portfolio.errors.needCover");

    setBusy(true);
    setError(null);
    const done = new Set(uploaded);
    const todo = items.filter((m) => !done.has(m.id));
    let finished = done.size;
    setProgress({ done: finished, total: items.length });

    // 1 — the work itself, from its cover image.
    let itemId = workId;
    if (!itemId && cover) {
      let created = "";
      const result = await uploadAsset(
        "portfolio",
        cover.file,
        async (): Promise<UploadTicket> => {
          const ticket = await startPortfolioUpload({
            title,
            description: description || null,
            contentType: cover.file.type,
            size: cover.file.size,
          });
          if (ticket.ok) created = ticket.itemId;
          return ticket;
        },
        finishPortfolioUpload,
      );
      if (!result.ok) {
        setBusy(false);
        setProgress(null);
        // A pending row, if one was made, is the owner's "unfinished upload" card.
        if (created) router.refresh();
        return setError(result.code);
      }
      itemId = created;
      setWorkId(created);
      done.add(cover.id);
      finished += 1;
      setProgress({ done: finished, total: items.length });
    }

    // 2 — every other file, in the chosen order.
    for (const media of todo) {
      if (done.has(media.id) || !itemId) continue;
      let mediaId = "";
      const result = await uploadAsset(
        "portfolio_media",
        media.file,
        async (): Promise<UploadTicket> => {
          const ticket = await startPortfolioMediaUpload({
            itemId: itemId as string,
            contentType: media.file.type,
            size: media.file.size,
            durationSeconds: media.durationSeconds,
          });
          if (ticket.ok) mediaId = ticket.itemId;
          return ticket;
        },
        finishPortfolioMediaUpload,
      );
      if (!result.ok) {
        // Drop the half-made file row; the work and the files before it stay.
        if (mediaId) await removePortfolioMediaAction(mediaId);
        setUploaded(done);
        setBusy(false);
        setProgress(null);
        router.refresh();
        return setError(result.code === "assets.errors.uploadFailed" ? "portfolio.errors.partialUpload" : result.code);
      }
      done.add(media.id);
      finished += 1;
      setProgress({ done: finished, total: items.length });
    }

    setBusy(false);
    reset();
    router.refresh();
    onDone();
  };

  const locked = busy || Boolean(workId);

  return (
    <form onSubmit={onSubmit} className="portfolio-add-form" data-testid="add-work-form" noValidate>
      <div className="portfolio-field">
        <label htmlFor="new-work-title" className="portfolio-label">{t("portfolio.form.title")} <Required /></label>
        <Input
          id="new-work-title"
          name="title"
          required
          maxLength={120}
          dir="auto"
          value={title}
          readOnly={locked}
          placeholder={t("portfolio.form.titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="portfolio-field">
        <label htmlFor="new-work-description" className="portfolio-label">{t("portfolio.form.description")} <Required /></label>
        <CountedTextarea
          id="new-work-description"
          name="description"
          required
          rows={3}
          dir="auto"
          value={description}
          max={DESCRIPTION_MAX_CHARS}
          readOnly={locked}
          unitLabel=""
          placeholder={t("portfolio.form.descriptionPlaceholder")}
          counterTestId="new-work-description-count"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="portfolio-field">
        <span className="portfolio-label">{t("portfolio.form.mediaLabel")}</span>
        <MediaPicker items={items} onChange={setItems} onError={setError} disabled={busy} />
      </div>

      {error ? <InlineError>{t(error)}</InlineError> : null}

      <div className="portfolio-add-actions">
        {progress ? (
          <span className="portfolio-progress" role="status">
            {t("portfolio.form.uploadingCount", { done: progress.done, total: progress.total })}
          </span>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t("portfolio.form.uploading") : t("portfolio.form.upload")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const keepWork = Boolean(workId);
            reset();
            onCancel();
            if (keepWork) router.refresh();
          }}
        >
          {t("portfolio.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
