"use client";

import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/primitives";

/**
 * THE canonical Jobs status layer.
 *
 * Three enums, three components, and no fourth place where a lifecycle value
 * becomes a word. Every one reads `jobs.status.*`, `jobs.applicationStatus.*` or
 * `jobs.assignmentStatus.*` — so a page that needs a status renders one of these
 * and never `t(\`jobs.status.${x}\`)` inline. The commerce module learned this the
 * same way: one badge file, imported everywhere.
 *
 * The TONE maps are the other half of the layer. A colour is a claim about how
 * the reader should feel, and `open` being accent while `awarded` is success is a
 * product decision — "you are recruiting" versus "this is settled" — not a
 * per-page styling choice.
 */

const JOB_TONE: Record<string, "neutral" | "info" | "accent" | "success" | "danger"> = {
  draft: "neutral",
  // Accent, not success: an open job is WORK OUTSTANDING, not an achievement.
  open: "accent",
  awarded: "success",
  completed: "success",
  // Closed is not a failure — recruiting simply stopped — so it is neutral, and
  // only a genuine cancellation is red.
  closed: "neutral",
  cancelled: "danger",
};

export function JobStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={JOB_TONE[status] ?? "neutral"}>{t(`jobs.status.${status}`)}</Badge>;
}

const APPLICATION_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = {
  submitted: "info",
  accepted: "success",
  // Neutral rather than danger. A poster scanning their queue is not looking at
  // errors, and painting every unsuccessful applicant red would read as a list of
  // problems rather than a list of people.
  rejected: "neutral",
  withdrawn: "neutral",
};

export function ApplicationStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={APPLICATION_TONE[status] ?? "neutral"}>
      {t(`jobs.applicationStatus.${status}`)}
    </Badge>
  );
}

const ASSIGNMENT_TONE: Record<string, "neutral" | "info" | "accent" | "success" | "danger"> = {
  scheduled: "info",
  in_progress: "accent",
  completed: "success",
  cancelled: "danger",
};

export function AssignmentStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={ASSIGNMENT_TONE[status] ?? "neutral"}>
      {t(`jobs.assignmentStatus.${status}`)}
    </Badge>
  );
}

/**
 * The one decision reason the PRODUCT wrote rather than a person.
 *
 * `job_application_accept` closes every other live candidacy with this exact
 * English sentence, stored in `decision_reason`. Rendering it raw would show an
 * Arabic reader an English sentence about themselves — and it would also read as
 * though the organization had typed it, which they did not. Matching our own
 * constant is the narrowest fix available without changing Increment 6 authority
 * to store a key instead; if that sentence ever changes in the database, this
 * has to change with it, which is why it is a named export and not a literal
 * buried in a component.
 */
export const AWARDED_ELSEWHERE_REASON = "the job was awarded to another applicant";

/** A decision reason in the reader's language, whoever wrote it. */
export function DecisionReason({ reason }: { reason: string | null | undefined }) {
  const { t } = useI18n();
  if (!reason) return null;
  return (
    <>
      {reason === AWARDED_ELSEWHERE_REASON
        ? t("jobs.applications.awardedElsewhere")
        : reason}
    </>
  );
}
