import { getServerSupabase } from "@/lib/supabase/server";
import { isCraftsmanLoginAlias, userFacingEmail } from "@/lib/auth/craftsman-login-alias";
import { EmailChange } from "@/features/engineer/email-change";
import { isSettingsSectionId } from "@/features/engineer/settings-sections";
import { ContactPageShell, loadContactPageFrame } from "../_contact-page";

export const dynamic = "force-dynamic";

/** `/home/settings/email` — the full sign-in email and the password + code protected change. */
export default async function SettingsEmailPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const { ar } = await loadContactPageFrame();
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const phoneAccount = isCraftsmanLoginAlias(auth?.user?.email);
  return (
    <ContactPageShell
      ar={ar}
      from={isSettingsSectionId(from) ? from : "account"}
      title={ar ? "البريد الإلكتروني" : "Email"}
      intro={ar ? "بريد تسجيل الدخول. لتغييره نتحقق من كلمة المرور ثم نرسل رمزًا إلى البريد الجديد." : "Your sign-in email. To change it we check your password, then send a code to the new address."}
    >
      <section className="engineer-settings-group">
        <div className="engineer-contact-current">
          <span>{ar ? "بريدك الحالي" : "Current email"}</span>
          <strong dir="ltr">{userFacingEmail(auth?.user?.email) ?? "—"}</strong>
        </div>
        {phoneAccount ? (
          <p className="engineer-contact-empty">{ar ? "حسابك مسجّل برقم الهاتف، ولا يوجد بريد لتغييره." : "Your account is registered with a phone number, so there is no email to change."}</p>
        ) : (
          <EmailChange ar={ar} />
        )}
      </section>
    </ContactPageShell>
  );
}
