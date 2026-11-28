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

/** Two steps: password + new email, then two 6-digit codes: one mailed to the current address, one to the new. */
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
        <p className="engineer-contact-empty">{ar ? `لتأكيد التغيير أرسلنا رمزًا من 6 أرقام إلى بريدك الحالي، ورمزًا آخر إلى ${start.email}.` : `To confirm the change we sent a 6-digit code to your current email and another to ${start.email}.`}</p>
        {confirm.confirmed?.current ? (
          <InlineSuccess>{ar ? "تم تأكيد رمز البريد الحالي." : "The current email's code is confirmed."}</InlineSuccess>
        ) : (
          <>
            <label htmlFor="current-email-code">{ar ? "رمز البريد الحالي" : "Code from your current email"}</label>
            <OtpInput id="current-email-code" name="currentToken" autoFocus error={Boolean(error)} />
          </>
        )}
        {confirm.confirmed?.next ? (
          <InlineSuccess>{ar ? "تم تأكيد رمز البريد الجديد." : "The new email's code is confirmed."}</InlineSuccess>
        ) : (
          <>
            <label htmlFor="new-email-code">{ar ? "رمز البريد الجديد" : "Code from your new email"}</label>
            <OtpInput id="new-email-code" name="token" error={Boolean(error)} />
          </>
        )}
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
