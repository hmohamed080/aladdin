"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { BellIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, GlobeIcon, MailIcon, MonitorIcon, PhoneIcon, PlusIcon, SettingsIcon, ShieldIcon, TrashIcon, UserIcon } from "@/components/ui/icons";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import { useI18n } from "@/lib/i18n/context";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { settingsCopy } from "./settings-copy";
import styles from "./settings.module.css";

type Icon = ComponentType<{ size?: number; className?: string }>;

// Intl country names differ between Node and browser ICU versions. Keep the
// shared control client-rendered in this preview without changing auth callers.
const PhoneField = dynamic(() => import("@/components/ui/phone-field").then((module) => module.PhoneField), {
  ssr: false,
  loading: () => <div className="h-11 rounded-md border bg-canvas" aria-busy="true" />,
});

function SettingsSection({ number, title, description, icon: Icon, compact, children }: {
  number: string; title: string; description: string; icon: Icon; compact?: boolean; children: ReactNode;
}) {
  return (
    <section aria-labelledby={`settings-${number}`} className="grid min-w-0 gap-md rounded-lg border bg-surface p-sm desktop:grid-cols-4">
      <div className={`relative flex gap-md rounded-md bg-surface-2 p-md desktop:col-span-1 ${compact ? "items-center" : "items-center desktop:flex-col desktop:justify-center desktop:py-xl desktop:text-center"}`}>
        <span className="absolute end-3 top-3 text-label font-semibold tabular-nums text-fg" aria-hidden="true">{number}</span>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-canvas text-fg"><Icon size={28} /></span>
        <div className="min-w-0 pe-lg">
          <h2 id={`settings-${number}`} className="text-title font-semibold text-fg">{title}</h2>
          <p className="mt-2 text-body leading-relaxed text-fg-secondary">{description}</p>
        </div>
      </div>
      <div className="min-w-0 p-sm desktop:col-span-3 desktop:p-md">{children}</div>
    </section>
  );
}

function SettingRow({ title, hint, icon: Icon, children }: { title: string; hint: string; icon: Icon; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-sm rounded-sm border p-3">
    <div className="flex min-w-0 flex-1 items-center gap-sm">
      <Icon size={23} className="shrink-0 text-fg" />
      <div><h3 className="text-body font-semibold text-fg">{title}</h3><p className="mt-1 text-caption text-fg-secondary">{hint}</p></div>
    </div>
    {children}
  </div>;
}

export function InstallerSettingsPreview({ theme, sidebarMode }: { theme: "light" | "dark"; sidebarMode: SidebarMode }) {
  const { locale, dir } = useI18n();
  const c = settingsCopy[locale];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [secondary, setSecondary] = useState(false);
  const [phoneValid, setPhoneValid] = useState(false);
  const [secondPhoneValid, setSecondPhoneValid] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [notice, setNotice] = useState("");
  const Chevron = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;
  const showPreview = (label: string) => setNotice(`${label}: ${c.unavailable}`);
  const toggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <div className="flex items-center gap-sm">
      <span className="text-caption text-fg-secondary">{checked ? c.enabled : c.disabled}</span>
      <Button variant="ghost" role="switch" aria-checked={checked} aria-label={label} title={c.localToggle} onClick={() => onChange(!checked)} className={styles.toggle}>
        <span aria-hidden="true" className={styles.thumb} />
      </Button>
    </div>
  );

  return <div dir={dir} data-installer-settings-preview className={`${styles.theme} installer-surface flex min-h-dvh bg-workspace text-fg`}>
    <InstallerSidebar initialMode={sidebarMode} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} previewActiveItemId="settings" />
    <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-md pb-lg pt-2 tablet:pt-3`}>
      <InstallerTopbar theme={theme} onMenuClick={() => setMobileOpen(true)} />
      <main id="top" className="flex w-full min-w-0 flex-col gap-md">
        <header className="flex items-center gap-md py-sm">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-surface-2"><SettingsIcon size={28} /></span>
          <div><h1 className="text-headline font-semibold">{c.title}</h1><p className="mt-1 text-body text-fg-secondary">{c.subtitle}</p><p className="mt-1 text-caption text-fg-secondary">{c.preview}</p></div>
        </header>
        <SettingsSection number="01" title={c.personal} description={c.personalHint} icon={UserIcon}>
          <form className="grid min-w-0 gap-md tablet:grid-cols-2" onChange={(event) => { setSaved(false); if (event.target instanceof HTMLInputElement && event.target.id === "settings-secondary-phone" && !event.target.value.trim()) setSecondPhoneValid(true); }} onSubmit={(event) => { event.preventDefault(); setSubmitted(true); setSaved(phoneValid && (!secondary || secondPhoneValid)); }}>
            <LabeledField htmlFor="settings-name" label={c.name}><Input id="settings-name" name="displayName" required maxLength={100} defaultValue={locale === "ar" ? "أحمد محمود" : "Ahmed Mahmoud"} autoComplete="name" /></LabeledField>
            <LabeledField htmlFor="settings-email" label={c.email} optional={c.optional}><Input id="settings-email" name="email" type="email" dir="ltr" placeholder="example@mail.com" autoComplete="email" /></LabeledField>
            <LabeledField htmlFor="settings-username" label={c.username}><Input id="settings-username" name="username" required pattern="[a-zA-Z0-9_]{3,30}" dir="ltr" defaultValue="ahmed123" aria-describedby="settings-username-hint" /><p id="settings-username-hint" className="text-caption text-fg-secondary">{c.usernameHint}</p></LabeledField>
            <div className={styles.phone}><LabeledField htmlFor="settings-phone" label={c.phone}><PhoneField id="settings-phone" defaultCountryIso2="EG" placeholder="01012345678" onChange={(value) => setPhoneValid(value !== null)} error={submitted && !phoneValid ? c.phoneError : undefined} /></LabeledField></div>
            {secondary && <div className={`${styles.phone} tablet:col-span-2`}><LabeledField htmlFor="settings-secondary-phone" label={c.secondaryPhone} optional={c.optional}><PhoneField id="settings-secondary-phone" defaultCountryIso2="EG" onChange={(value) => setSecondPhoneValid(value !== null)} error={submitted && !secondPhoneValid ? c.phoneError : undefined} /></LabeledField></div>}
            <div className="flex flex-wrap items-center justify-between gap-md tablet:col-span-2">
              <Button type="submit">{c.save}</Button>
              <Button variant="outline" onClick={() => { setSecondary(!secondary); setSecondPhoneValid(true); setSaved(false); }}><PlusIcon size={16} />{secondary ? c.removePhone : c.addPhone}</Button>
            </div>
            {saved && <p role="status" className="flex items-center gap-sm text-body tablet:col-span-2"><CheckIcon size={18} />{c.saved}</p>}
          </form>
        </SettingsSection>
        <SettingsSection number="02" title={c.security} description={c.securityHint} icon={ShieldIcon}>
          <div className="flex flex-col gap-sm">
            <div className="flex items-center gap-sm"><ShieldIcon size={23} /><div><h3 className="text-body-lg font-semibold">{c.login}</h3><p className="text-caption text-fg-secondary">{c.loginHint}</p></div></div>
            <ul className="divide-y rounded-sm border">
              {[{ name: "Google", connected: true, Icon: GlobeIcon }, { name: "Facebook", connected: false, Icon: GlobeIcon }, { name: c.phone, connected: true, Icon: PhoneIcon }].map(({ name, connected, Icon }) => <li key={name} className="flex items-center gap-md px-md py-2"><Icon size={20} /><span className="min-w-0 flex-1 text-body font-medium">{name}</span><span className="flex items-center gap-1 rounded-sm bg-surface-2 px-3 py-1 text-caption">{connected && <CheckIcon size={13} />}{connected ? c.connected : c.disconnected}</span></li>)}
            </ul>
            {([{ title: c.sessions, hint: c.sessionsHint, Icon: MonitorIcon }, { title: c.devices, hint: c.devicesHint, Icon: MonitorIcon }, { title: c.recovery, hint: c.recoveryHint, Icon: MailIcon }, { title: c.password, hint: c.passwordHint, Icon: ShieldIcon }]).map(({ title, hint, Icon }) => <SettingRow key={title} title={title} hint={hint} icon={Icon}><Button variant="ghost" aria-label={title} onClick={() => showPreview(title)}><Chevron size={18} /></Button></SettingRow>)}
            <SettingRow title={c.twoFactor} hint={c.twoFactorHint} icon={ShieldIcon}>{toggle(c.twoFactor, twoFactor, setTwoFactor)}</SettingRow>
          </div>
        </SettingsSection>
        <SettingsSection number="03" title={c.notifications} description={c.notificationsHint} icon={BellIcon} compact><SettingRow title={c.enableNotifications} hint={c.enableNotificationsHint} icon={BellIcon}>{toggle(c.enableNotifications, notifications, setNotifications)}</SettingRow></SettingsSection>
        <SettingsSection number="04" title={c.account} description={c.accountHint} icon={SettingsIcon} compact>
          <div className="grid gap-md tablet:grid-cols-2">
            <div className="flex items-start gap-sm rounded-sm border p-md"><SettingsIcon size={24} className="shrink-0" /><div><Button variant="ghost" onClick={() => showPreview(c.suspend)}>{c.suspend}</Button><p className="mt-1 text-caption text-fg-secondary">{c.suspendHint}</p></div></div>
            <div className="flex items-start gap-sm rounded-sm border border-danger p-md"><TrashIcon size={24} className="shrink-0 text-danger" /><div><Button variant="danger" onClick={() => showPreview(c.delete)}>{c.delete}</Button><p className="mt-1 text-caption text-fg-secondary">{c.deleteHint}</p></div></div>
          </div>
        </SettingsSection>
        <p role="status" aria-live="polite" className="text-body text-fg-secondary">{notice}</p>
      </main>
    </div>
  </div>;
}
