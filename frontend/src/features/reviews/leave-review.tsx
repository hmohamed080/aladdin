"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, InlineError } from "@/components/ui/primitives";
import { Button, LabeledField, SubmitButton, Textarea } from "@/components/ui/controls";
import { StarIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/ui/format";
import { submitReviewAction } from "@/server/actions/reviews";
import type { Locale } from "@/lib/i18n/locales";
import { Stars } from "./parts";
import { cn } from "@/lib/ui/cn";

/**
 * The poster's half of the review lifecycle, on the completed job they already
 * have open (§10). Not a separate B2B Reviews product — one panel, on the
 * surface where the work itself lives.
 *
 * THREE STATES, and the third is the one that matters:
 *
 *   1. Not completed, or no authority — nothing renders. A control that appears
 *      and then refuses is worse than one that never appeared.
 *   2. Completed, authorized, no review — the form.
 *   3. A review exists — the review, READ ONLY, with a line saying it cannot be
 *      changed. There is no edit control to hide, because the table refuses an
 *      update from everybody; the wording exists so the person learns that
 *      BEFORE they submit as well as after.
 */
export function LeaveReview({
  assignmentId,
  canReview,
  existing,
  locale,
}: {
  assignmentId: string;
  /** Completed AND the caller holds job.manage. Decided server-side. */
  canReview: boolean;
  existing: { rating: number; comment: string | null; createdAt: string } | null;
  locale: Locale;
}) {
  const { t } = useI18n();

  if (existing) {
    return (
      <Card className="flex flex-col gap-md">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <h3 className="text-title text-fg">{t("reviews.poster.submittedTitle")}</h3>
          <div className="flex items-center gap-2">
            <Stars value={existing.rating} label={t("reviews.starsLabel", { n: existing.rating })} />
            <span className="text-body-lg font-medium tabular-nums text-fg">{existing.rating}</span>
          </div>
        </div>
        {existing.comment ? (
          <p dir="auto" className="max-w-prose whitespace-pre-line text-body text-fg-secondary">
            {existing.comment}
          </p>
        ) : null}
        <p className="text-label text-fg-muted">
          {t("reviews.poster.immutable", { date: formatDate(existing.createdAt, locale) })}
        </p>
      </Card>
    );
  }

  if (!canReview) return null;

  return <ReviewForm assignmentId={assignmentId} />;
}

function ReviewForm({ assignmentId }: { assignmentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [open, setOpen] = useState(false);

  const [state, dispatch] = useActionState(
    async (prev: { ok: boolean; code?: string }, fd: FormData) => {
      const result = await submitReviewAction(prev, fd);
      if (result.ok) router.refresh();
      return result;
    },
    { ok: true },
  );

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-md">
        <div className="min-w-0">
          <h3 className="text-title text-fg">{t("reviews.poster.title")}</h3>
          <p className="text-label text-fg-secondary">{t("reviews.poster.body")}</p>
        </div>
        <Button type="button" variant="primary" onClick={() => setOpen(true)}>
          {t("reviews.poster.leave")}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-md">
      <div>
        <h3 className="text-title text-fg">{t("reviews.poster.title")}</h3>
        {/* ORGANIZATION-AUTHORED, said plainly before they type. The review is
            published under the organization's name and the individual who wrote
            it is never shown — a person should know both facts while they are
            still deciding what to write. */}
        <p className="mt-1 max-w-prose text-label text-fg-secondary">
          {t("reviews.poster.authored")}
        </p>
      </div>

      <form action={dispatch} className="flex flex-col gap-md">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <input type="hidden" name="rating" value={rating} />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-label font-medium text-fg-secondary">
            {t("reviews.poster.ratingLabel")}
          </legend>
          {/* Five radio-shaped buttons rather than a slider or a select: the
              choice is small, discrete and the whole point of the form, so it
              should take one click and be readable without opening anything. */}
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t("reviews.poster.ratingLabel")}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={t("reviews.starsLabel", { n: value })}
                onClick={() => setRating(value)}
                className={cn(
                  "rounded-sm p-1 transition-colors duration-fast",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  value <= rating ? "text-warning" : "text-fg-muted/40 hover:text-fg-muted",
                )}
              >
                <StarIcon size={28} />
              </button>
            ))}
            {rating > 0 ? (
              <span className="ms-2 text-body-lg font-medium tabular-nums text-fg">{rating}</span>
            ) : null}
          </div>
        </fieldset>

        <LabeledField
          label={t("reviews.poster.commentLabel")}
          htmlFor="review-comment"
          optional={t("reviews.poster.optional")}
        >
          <Textarea id="review-comment" name="comment" rows={4} maxLength={1500} dir="auto" />
        </LabeledField>

        {state.ok ? null : <InlineError>{t(state.code ?? "states.genericRetry")}</InlineError>}

        <p className="text-label text-fg-muted">{t("reviews.poster.finalWarning")}</p>

        <div className="flex items-center gap-2">
          <SubmitButton variant="primary" disabled={rating === 0}>
            {t("reviews.poster.submit")}
          </SubmitButton>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("reviews.poster.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
