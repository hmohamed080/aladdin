"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/controls";
import { pick } from "@/features/installer-dashboard-preview/mock-data";
import { useI18n } from "@/lib/i18n/context";
import { requestCraftsmanVerificationAction } from "@/server/actions/craftsman-verification";

type Bi = { ar: string; en: string };

/** The applicant's own verification state, in plain words. */
const STATUS: Record<string, Bi> = {
  draft: { ar: "طلب التوثيق قيد الإعداد.", en: "Your verification request is being prepared." },
  submitted: { ar: "طلب التوثيق بانتظار المراجعة.", en: "Verification pending: waiting for review." },
  under_review: { ar: "طلب التوثيق قيد المراجعة.", en: "Verification under review." },
  needs_more_info: { ar: "نحتاج معلومات إضافية. حدّث ملفك واحفظه ليُعاد إرسال الطلب.", en: "More information is needed. Update your profile and save to send it again." },
  approved: { ar: "تم توثيق حسابك.", en: "Your professional account is verified." },
  rejected: { ar: "لم يتم قبول طلب التوثيق.", en: "Your verification request was not approved." },
};

const NOT_REQUESTED: Bi = {
  ar: "ملفك مكتمل بنسبة 100٪ لكن طلب التوثيق لم يُرسل بعد.",
  en: "Your profile is 100% complete, but your verification request has not been sent yet.",
};

/** What pressing the button reported. `failed` is shown as a failure, never as a success. */
const RESULT: Record<string, { ok: boolean; text: Bi }> = {
  submitted: { ok: true, text: { ar: "أُرسل طلب التوثيق للمراجعة.", en: "Your verification request was sent for review." } },
  resubmitted: { ok: true, text: { ar: "أُرسل طلب التوثيق للمراجعة.", en: "Your verification request was sent for review." } },
  resubmitted_after_rejection: { ok: true, text: { ar: "أُعيد إرسال طلب التوثيق للمراجعة.", en: "Your verification request was sent for review again." } },
  already_open: { ok: true, text: { ar: "طلب التوثيق قيد المراجعة بالفعل.", en: "A verification request is already under review." } },
  approved: { ok: true, text: { ar: "تم توثيق حسابك.", en: "Your professional account is already verified." } },
  rejected: { ok: false, text: { ar: "لم يتم إرسال الطلب. حاول مرة أخرى.", en: "The request was not sent. Please try again." } },
  incomplete: { ok: false, text: { ar: "أكمل ملفك بنسبة 100٪ أولاً.", en: "Complete your profile to 100% first." } },
  failed: { ok: false, text: { ar: "تعذر إرسال طلب التوثيق. تم حفظ ملفك، يمكنك المحاولة مرة أخرى.", en: "We couldn't send your verification request. Your profile is saved; you can try again." } },
};

/**
 * The Craftsman's verification status on `/home/profile`, and the only two manual actions:
 *  - the safe RETRY when the profile is 100% but no request exists (the automatic submission failed or never ran);
 *  - RESUBMIT after a rejection, available only at 100%.
 * Both call the same idempotent database function, the button is disabled while the call is pending, and the page
 * refreshes from the server afterwards, so a request can never be believed sent when it was not, nor sent twice.
 */
export function CraftsmanVerificationCard({
  percent,
  verification,
}: {
  percent: number;
  verification: { status: string; reason: string | null } | null;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const complete = percent >= 100;
  const status = verification?.status ?? null;
  const canRetry = status === null && complete;
  const canResubmit = status === "rejected" && complete;
  if (status === null && !complete) return null;
  if (status !== null && !STATUS[status]) return null;

  async function press(afterRejection: boolean) {
    setPending(true);
    setResult(null);
    const out = await requestCraftsmanVerificationAction(afterRejection).catch(() => ({ outcome: "failed" as const }));
    setPending(false);
    const known = RESULT[out.outcome] ?? RESULT.failed!;
    setResult({ ok: known.ok, text: pick(locale, known.text) });
    router.refresh();
  }

  return (
    <div role="status" data-testid="verification-status" data-status={status ?? "not_requested"} className="flex flex-col gap-2 rounded-md border border-strong bg-surface p-md text-label text-fg shadow-card">
      <p className="font-medium">{pick(locale, status === null ? NOT_REQUESTED : STATUS[status]!)}</p>
      {verification?.reason && (status === "rejected" || status === "needs_more_info") ? <p className="text-fg-secondary" data-testid="verification-reason">{verification.reason}</p> : null}
      {status === "rejected" && !complete ? (
        <p className="text-fg-secondary">{ar ? "أكمل ملفك بنسبة 100٪ لإعادة الإرسال." : "Complete your profile to 100% to resubmit."}</p>
      ) : null}
      {canRetry || canResubmit ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void press(canResubmit)} data-testid={canResubmit ? "verification-resubmit" : "verification-request"}>
          {pending ? (ar ? "جارٍ الإرسال…" : "Sending…") : canResubmit ? (ar ? "إعادة الإرسال للتوثيق" : "Resubmit for verification") : (ar ? "طلب التوثيق" : "Request verification")}
        </Button>
      ) : null}
      {result ? <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"} data-testid="verification-result">{result.text}</p> : null}
    </div>
  );
}
