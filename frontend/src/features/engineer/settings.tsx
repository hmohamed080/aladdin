import Link from "next/link";
import type { ComponentProps } from "react";
import type { Locale } from "@/lib/i18n/locales";
import { PersonalSettings } from "@/features/settings/personal-settings";
import { IdentityCard } from "@/features/settings/identity-card";
import { SubmitButton } from "@/components/ui/controls";
import { ShieldIcon, MonitorIcon, MailIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { signOut } from "@/server/actions/auth";
import type { OAuthAvailability } from "@/server/auth/entry-oauth";
import { SettingsTabs } from "./settings-tabs";
import { SETTINGS_PRESELECT_SCRIPT } from "./settings-sections";
import { ProviderRow } from "./provider-row";
import { DevicesPanel, SessionsPanel } from "./devices-panels";
import type { MyDevice, MySession } from "@/server/queries/account-devices";
import { SettingsSaveBar } from "./settings-save-bar";
import { PersonalDetailsForm } from "./personal-details-form";
import "./settings.css";

type Props = ComponentProps<typeof PersonalSettings> & {
  locale: Locale;
  /** Auth identity providers attached to this account, e.g. ["email", "google"]. */
  linkedProviders: string[];
  /** provider -> the linked account's masked email (or name), for the Sign-in methods rows. */
  linkedDetails: Record<string, string>;
  oauth: OAuthAvailability;
  linkNotice: "connected" | "taken" | "failed" | null;
  sessions: MySession[];
  devices: MyDevice[];
  /** The account has a password of its own (false for a Google/Facebook-only account). */
  hasPassword: boolean;
  linkProvider: string | null;
};

export function EngineerSettings({ identity, signInEmail, signInMethod, locale, linkedProviders, linkedDetails, oauth, linkNotice, linkProvider, sessions, devices, hasPassword }: Props) {
  const ar = locale === "ar";
  const sections = [
    { id: "account", title: ar ? "إعدادات الحساب" : "Account settings", description: ar ? "إدارة بياناتك الشخصية وحالة حسابك على المنصة." : "Manage your personal details and account on Aladdin." },
    { id: "security", title: ar ? "الخصوصية والأمان" : "Privacy & security", description: ar ? "حافظ على أمان حسابك وبياناتك الشخصية." : "Keep your account and personal information secure." },
    { id: "notifications", title: ar ? "الإشعارات" : "Notifications", description: ar ? "تابع إشعارات حسابك وتفضيلات استلامها." : "Stay informed about your account and notification preferences." },
  ];
  const unavailable = ar ? "غير متاح حاليًا" : "Not available yet";
  const methods = (
    <>
            {linkNotice ? <p className={linkNotice === "connected" ? "engineer-link-notice" : "engineer-link-notice engineer-link-notice-error"} role="status">{linkNotice === "connected" ? (ar ? `تم ربط ${linkProvider === "facebook" ? "فيسبوك" : "جوجل"} بحسابك.` : `${linkProvider === "facebook" ? "Facebook" : "Google"} is now connected to your account.`) : linkNotice === "taken" ? (ar ? "هذا الحساب مربوط بحساب آخر في علاء الدين، ولا يمكن ربطه هنا." : "That account is already connected to a different Aladdin account, so it can't be connected here.") : (ar ? "تعذر إكمال الربط. حاول مرة أخرى." : "Couldn't finish connecting. Try again.")}</p> : null}
            {signInMethod === "phone_password"
              ? <div className="engineer-method-row"><span><strong>{ar ? "رقم الهاتف وكلمة المرور" : "Phone and password"}</strong><small><bdi dir="ltr">{identity?.phoneE164 ?? "—"}</bdi> · {ar ? "لا يمكن تغيير رقم الدخول في هذا الإصدار." : "Your sign-in number can't be changed in this version."}</small></span></div>
              : <Link className="engineer-method-row engineer-method-link" href="/home/settings/email?from=security"><span><strong>{ar ? "البريد وكلمة المرور" : "Email and password"}</strong><small><bdi dir="ltr">{signInEmail ?? "—"}</bdi></small></span></Link>}
            <ProviderRow provider="google" name="Google" connected={linkedProviders.includes("google")} detail={linkedDetails.google} available={oauth.google} ar={ar} />
            <ProviderRow provider="facebook" name={ar ? "فيسبوك" : "Facebook"} connected={linkedProviders.includes("facebook")} detail={linkedDetails.facebook} available={oauth.facebook} ar={ar} />
    </>
  );
  const connectedNames = [linkedProviders.includes("google") ? "Google" : null, linkedProviders.includes("facebook") ? (ar ? "فيسبوك" : "Facebook") : null].filter(Boolean).join(ar ? "، " : ", ");
  const recovery = signInMethod === "phone_password" ? (
    <p>{ar ? "استعادة كلمة المرور لحساب الهاتف غير متاحة في هذا الإصدار." : "Password recovery for phone accounts is not available in this version."}</p>
  ) : (
    <>
      <div className="engineer-method-row"><span><strong>{ar ? "بريد الاستعادة" : "Recovery email"}</strong><small><bdi dir="ltr">{signInEmail ?? "—"}</bdi> · {ar ? "يصلك الرمز على هذا البريد." : "Recovery codes are sent here."}</small></span></div>
      <div className="engineer-method-row"><span><strong>{ar ? "كلمة المرور" : "Password"}</strong><small>{hasPassword ? (ar ? "معيّنة" : "Set") : (ar ? "لم تُعيَّن بعد" : "Not set yet")}</small></span></div>
      <div className="engineer-method-row"><span><strong>{ar ? "طرق دخول أخرى" : "Other ways to sign in"}</strong><small>{connectedNames || (ar ? "لا توجد طرق مربوطة بعد." : "None connected yet.")}</small></span></div>
      {hasPassword
        ? <Link className="engineer-method-row engineer-method-link" href="/auth/forgot-password"><span><strong>{ar ? "الاستعادة برمز بريدي" : "Recover with an email code"}</strong><small>{ar ? "نرسل رمزًا من 6 أرقام إلى بريد الاستعادة." : "We send a 6-digit code to your recovery email."}</small></span></Link>
        : <Link className="engineer-method-row engineer-method-link" href="/home/settings/password?from=security"><span><strong>{ar ? "عيّن كلمة مرور" : "Set a password"}</strong><small>{ar ? "لتتمكن من استعادة حسابك عبر البريد." : "So you can recover your account with your email."}</small></span></Link>}
    </>
  );
  const security = [
    { icon: ShieldIcon, title: ar ? "طرق تسجيل الدخول" : "Sign-in methods", description: ar ? "البريد الإلكتروني وجوجل وفيسبوك لتسجيل الدخول إلى حسابك." : "The email, Google and Facebook you use to sign in.", content: methods, open: Boolean(linkNotice) },
    { icon: MonitorIcon, title: ar ? "الجلسات النشطة" : "Active sessions", description: ar ? "عرض وإدارة جلسات حسابك." : "View and manage your account sessions.", content: <SessionsPanel sessions={sessions} locale={locale} /> },
    { icon: MonitorIcon, title: ar ? "الأجهزة الموثوقة" : "Trusted devices", description: ar ? "الأجهزة التي تستخدمها لتسجيل الدخول." : "Devices used to sign in to your account.", content: <DevicesPanel devices={devices} locale={locale} /> },
    { icon: MailIcon, title: ar ? "استعادة الحساب" : "Account recovery", description: ar ? "استرجع الوصول إلى حسابك عند نسيان كلمة المرور." : "Recover access when you forget your password.", content: recovery },
    {
      icon: ShieldIcon,
      title: ar ? "تغيير كلمة المرور" : "Change password",
      description: signInMethod === "phone_password"
        ? (ar ? "غير متاح لحساب الهاتف في هذا الإصدار." : "Not available for phone accounts in this version.")
        : hasPassword
          ? (ar ? "حدّث كلمة المرور باستخدام كلمة المرور الحالية." : "Update your password using your current one.")
          : (ar ? "عيّن كلمة مرور لتسجّل الدخول بالبريد أيضًا." : "Set a password so you can also sign in with your email."),
      href: signInMethod === "phone_password" ? undefined : "/home/settings/password?from=security",
    },
  ];
  const panels = {
    account: (<section className="engineer-settings-panel"><header><div><h2>{sections[0]!.title}</h2><p>{sections[0]!.description}</p></div></header>
          <div className="engineer-settings-group"><h3>{ar ? "المعلومات الأساسية" : "Basic info"}</h3>
            {identity ? <IdentityCard identity={identity} compact afterName={<>
              <PersonalDetailsForm gender={identity.gender} labels={{ gender: ar ? "النوع" : "Gender", female: ar ? "أنثى" : "Female", male: ar ? "ذكر" : "Male", unspecified: ar ? "أفضّل عدم التحديد" : "Prefer not to say", saved: ar ? "تم الحفظ." : "Saved.", error: ar ? "تعذر الحفظ. حاول مرة أخرى." : "Couldn't save. Try again." }} />
              <Link className="engineer-link-row" href="/home/settings/email?from=account"><span>{ar ? "البريد الإلكتروني" : "Email"}</span><span dir="ltr">{signInEmail ?? "—"}</span></Link>
              <div className="engineer-link-row"><span>{ar ? "رقم الهاتف" : "Phone"}</span><span dir="ltr">{identity.phoneE164 ?? "—"}</span></div>
            </>} /> : <p>{ar ? "تعذر تحميل بياناتك. حدّث الصفحة للمحاولة مرة أخرى." : "Your details could not be loaded. Refresh to try again."}</p>}
          </div>
          <div className="engineer-settings-group"><h3>{ar ? "معلومات الحساب" : "Account info"}</h3>
            {signInMethod === "phone_password"
              ? <div className="engineer-password-row" aria-disabled="true"><span>{ar ? "كلمة المرور" : "Password"}</span><span className="engineer-password-dots" aria-hidden="true">••••••••••</span></div>
              : <Link className="engineer-password-row" href="/home/settings/password?from=account"><span>{ar ? "كلمة المرور" : "Password"}</span><span className="engineer-password-dots" aria-hidden="true">••••••••••</span><span className="sr-only">{ar ? "تغيير كلمة المرور" : "Change password"}</span></Link>}
          </div>
          <div className="engineer-settings-danger"><div><strong>{ar ? "إيقاف الحساب مؤقتًا" : "Pause account"}</strong><small>{unavailable}</small></div><div><strong>{ar ? "حذف الحساب" : "Delete account"}</strong><small>{unavailable}</small></div></div>
          <form action={signOut}><SubmitButton variant="outline" pendingLabel={ar ? "جارٍ تسجيل الخروج…" : "Signing out…"}>{ar ? "تسجيل الخروج" : "Sign out"}</SubmitButton></form>
          <SettingsSaveBar label={ar ? "حفظ التغييرات" : "Save changes"} hint={ar ? "لديك تغييرات غير محفوظة." : "You have unsaved changes."} />
        </section>),
    security: (<section className="engineer-settings-panel"><header><div><h2>{sections[1]!.title}</h2><p>{sections[1]!.description}</p></div></header>
          <div className="engineer-security-rows">{security.map(({ icon: Icon, title, description, content, open, href }) => href ? <Link key={title} className="engineer-method-row engineer-method-link" href={href}><span><strong>{title}</strong><small>{description}</small></span></Link> : <details key={title} open={open}><summary><Icon size={22} /><span><strong>{title}</strong><small>{description}</small></span><ChevronLeftIcon size={17} /></summary><div className="engineer-security-detail">{content}</div></details>)}
          <div className="engineer-settings-unavailable"><ShieldIcon size={22} /><div><strong>{ar ? "تفعيل التحقق بخطوتين" : "Two-step verification"}</strong><small>{ar ? "إعداد التحقق بخطوتين للحساب الشخصي غير متاح بعد." : "Two-step verification setup is not available for personal accounts yet."}</small></div><span>{unavailable}</span></div></div>
        </section>),
    notifications: (<section className="engineer-settings-panel engineer-settings-notifications"><header><div><h2>{sections[2]!.title}</h2><p>{ar ? "تظهر إشعارات حسابك في جرس الإشعارات أعلى الصفحة." : "Your account notifications appear in the bell at the top of the page."}</p></div></header><span className="engineer-settings-hint">{ar ? "تخصيص قنوات الإشعارات غير متاح حاليًا." : "Notification channel preferences are not available yet."}</span></section>),
  };
  const tabs = sections.map(({ id, title }) => ({ id, title, panel: panels[id as keyof typeof panels] }));
  return <div className="engineer-settings">
    <SettingsTabs
      tabs={tabs}
      label={ar ? "أقسام الإعدادات" : "Settings sections"}
      heading={<header className="engineer-settings-heading"><h1>{ar ? "الإعدادات" : "Settings"}</h1><p>{ar ? "إدارة بياناتك الشخصية وحسابك." : "Manage your personal details and your account."}</p></header>}
    />
    <script dangerouslySetInnerHTML={{ __html: SETTINGS_PRESELECT_SCRIPT }} />
  </div>;
}
