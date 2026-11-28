"use client";

import { useActionState } from "react";
import { Input, SubmitButton } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { OtpInput } from "@/components/ui/otp-input";
import {
  confirmEmailChangeAction,
  startEmailChangeAction,
  type EmailChangeState,
} from "@/server/actions/email-change";

const INITIAL: EmailChangeState = { step: "start" };

function message(ar: boolean, code: EmailChangeState["code"]): string | null {
  switch (code) {
    case undefined: return null;
    case "invalid": return ar ? "أدخل بريدًا صحيحًا وكلمة المرور الحالية." : "Enter a valid email and your current password.";
    case "same": return ar ? "هذا هو بريدك الحالي بالفعل." : "That's already your email.";
    case "password": return ar ? "كلمة المرور غير صحيحة." : "That password isn't right.";
    case "unavailable": return ar ? "لا يمكن استخدام هذا البريد." : "That email can't be used.";
    case "throttled": return ar ? "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا." : "Too many attempts. Wait a moment and try again.";
    case "phone_account": return ar ? "حسابك مسجّل برقم الهاتف، ولا يوجد بريد لتغييره." : "Your account is registered with a phone number, so there is no email to change.";
    case "token": return ar ? "الرمز غير صحيح أو انتهت صلاحيته." : "That code is wrong or has expired.";
    default: return ar ? "تعذر إكمال الطلب. حاول مرة أخرى." : "Couldn't complete that. Try again.";
  }
}

/** Two steps: password + new email, then the 6-digit code mailed to the new address. */
export function EmailChange({ ar }: { ar: boolean }) {
  const [start, startAction] = useActionState(startEmailChangeAction, INITIAL);
  const [confirm, confirmAction] = useActionState(confirmEmailChangeAction, INITIAL);

  if (confirm.step === "done") {
    return <InlineSuccess>{ar ? `تم تغيير بريدك إلى ${confirm.email}. تم تسجيل خروج جلساتك الأخرى.` : `Your email is now ${confirm.email}. Your other sessions were signed out.`}</InlineSuccess>;
  }

  if (start.step === "code" && start.email) {
    const error = message(ar, confirm.code);
    return (
      <form action={confirmAction} className="engineer-contact-form">
        <input type="hidden" name="email" value={start.email} />
        <p className="engineer-contact-empty">{ar ? `أرسلنا رمزًا من 6 أرقام إلى ${start.email}. أدخله لتأكيد التغيير.` : `We sent a 6-digit code to ${start.email}. Enter it to confirm the change.`}</p>
        <OtpInput name="token" autoFocus error={Boolean(error)} />
        <SubmitButton size="sm" pendingLabel={ar ? "جارٍ التأكيد…" : "Confirming…"}>{ar ? "تأكيد التغيير" : "Confirm change"}</SubmitButton>
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    );
  }

  const error = message(ar, start.code);
  return (
    <form action={startAction} className="engineer-contact-form">
      <label htmlFor="new-email">{ar ? "البريد الجديد" : "New email"}</label>
      <Input id="new-email" name="newEmail" type="email" autoComplete="off" dir="ltr" defaultValue={start.email ?? ""} required />
      <label htmlFor="current-password">{ar ? "كلمة المرور الحالية" : "Current password"}</label>
      <Input id="current-password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton size="sm" pendingLabel={ar ? "جارٍ الإرسال…" : "Sending…"}>{ar ? "إرسال الرمز" : "Send code"}</SubmitButton>
      {error ? <InlineError>{error}</InlineError> : null}
    </form>
  );
}
