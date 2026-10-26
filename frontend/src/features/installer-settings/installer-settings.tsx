"use client";

import { startTransition, useState, useTransition, type ComponentType, type FormEvent } from "react";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { BellIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, GlobeIcon, MailIcon, MonitorIcon, PhoneIcon, SettingsIcon, ShieldIcon, TrashIcon, UserIcon } from "@/components/ui/icons";
import { SettingRow, SettingsSection } from "@/features/installer-settings-preview/installer-settings-preview";
import { settingsCopy } from "@/features/installer-settings-preview/settings-copy";
import styles from "@/features/installer-settings-preview/settings.module.css";
import { useI18n } from "@/lib/i18n/context";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { setDisplayNameAction, setUsernameAction, type IdentityFieldState, type UsernameFieldState } from "@/server/actions/profile-identity";
import { PasswordChangeRow } from "./password-change-panel";
import { PhoneChangePanel } from "./phone-change-panel";
import { productionCopy, type ProductionCopy } from "./production-copy";
import { ContactEmailField } from "@/features/settings/contact-email-field";
import { SecondaryPhoneSection } from "@/features/settings/secondary-phone";
import type { ContactEmailStatus } from "@/server/identity/contact-email";
import type { SecondaryPhone } from "@/server/queries/profile-identity";

type Icon = ComponentType<{ size?: number; className?: string }>;

/**
 * The caller's own data for the page, resolved on the server. It carries NO login alias, token or credential: a phone
 * account is reduced to the boolean `phoneAccount`, and the phone is the profile's own (the number the user typed).
 */
export type InstallerSettingsData = {
  displayName: string;
  username: string | null;
  phoneE164: string | null;
  phoneNational: string | null;
  phoneVerified: boolean;
  /** Signs in with phone + password (the only account kind the phone/password actions accept). */
  phoneAccount: boolean;
  /** The optional contact email as the database holds it (never a sign-in identity). */
  contactEmail: ContactEmailStatus;
  /** The account has a password to confirm sensitive changes with (social-only accounts do not). */
  hasPassword: boolean;
  /** PR #88: the one unverified secondary phone reservation, or null. */
  secondaryPhone: SecondaryPhone | null;
};

const INITIAL: IdentityFieldState = { ok: false };
const INITIAL_USERNAME: UsernameFieldState = { ok: false };
const NAME_FORM = "settings-profile-form";

/**
 * `/home/settings` for an Installer: the APPROVED Settings design (`installer-settings-preview`, same sections, rows,
 * tokens and copy) connected to the real backend. The sidebar and topbar are the production shell's; this renders only
 * the page body.
 *
 * WORKING NOW: real identity (name, username, current phone and its verification state), display-name and username save,
 * the journaled sign-in phone change and the password change (PR #88's current-password confirmation), the optional
 * contact email (single-use link + explicit confirmation), PR #88's unverified secondary phone (7 + 7 days, 30-day
 * cooldown), and the shell's own sign-out.
 *
 * NOT CONNECTED YET - shown as "Not available yet", never as a fake state: connected accounts, sessions, trusted
 * devices, account recovery, two-step verification, notifications, suspend, delete (docs/frontend/installer-settings.md).
 * No control here shows a saved/connected/enabled state that nothing persisted.
 */
export function InstallerSettings({ data }: { data: InstallerSettingsData }) {
  const { locale, dir, t } = useI18n();
  const c = settingsCopy[locale];
  const p: ProductionCopy = productionCopy[locale];
  const Chevron = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;
  const [saving, startSaving] = useTransition();
  // Both fields are controlled and compared with what is SAVED, so "unsaved" is always exactly "differs from the stored
  // value": input typed while a save is in flight, or after a partial failure, is never lost or silently marked saved.
  const [displayName, setDisplayName] = useState(data.displayName);
  const [savedName, setSavedName] = useState(data.displayName);
  const [nameState, setNameState] = useState<IdentityFieldState | null>(null);
  const [username, setUsername] = useState(data.username ?? "");
  const [savedUsername, setSavedUsername] = useState(data.username ?? "");
  const [usernameState, setUsernameState] = useState<UsernameFieldState | null>(null);
  const [showShapeError, setShowShapeError] = useState(false);
  const nameDirty = displayName.trim() !== savedName;
  const trimmedUsername = username.trim();
  const usernameDirty = trimmedUsername !== savedUsername;
  // Early, local feedback only (the same rules the database enforces); the database stays the authority.
  const usernameLocalError = trimmedUsername.length === 0 ? "registration.error.usernameRequired" : isUsernameWellFormed(trimmedUsername) ? null : "registration.error.usernameShape";
  const usernameError = usernameState && !usernameState.ok && usernameState.code ? usernameState.code : showShapeError && usernameLocalError ? usernameLocalError : null;
  // The outcome of the LAST save that touched both fields: shown as one honest sentence only when the two disagree.
  const [attempt, setAttempt] = useState<{ name: boolean; username: boolean } | null>(null);
  const partial = attempt && attempt.name !== attempt.username ? attempt : null;

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || (!nameDirty && !usernameDirty)) return;
    if (usernameDirty && usernameLocalError) {
      setShowShapeError(true);
      return;
    }
    // Only what changed is sent: a field that is already saved is never sent again.
    const sendName = nameDirty ? displayName.trim() : null;
    const sendUsername = usernameDirty ? trimmedUsername : null;
    setAttempt(null);
    startSaving(async () => {
      // Each field goes through its own single-purpose authority. A failure (or a thrown network error) in one never
      // hides, undoes or repeats the other's result.
      let nameOk: boolean | null = null;
      let usernameOk: boolean | null = null;
      if (sendName !== null) {
        const body = new FormData();
        body.set("displayName", sendName);
        const result = await setDisplayNameAction(INITIAL, body).catch((): IdentityFieldState => ({ ok: false, code: "profileIdentity.displayName.error" }));
        nameOk = result.ok;
        startTransition(() => {
          setNameState(result);
          if (result.ok) setSavedName(sendName);
        });
      }
      if (sendUsername !== null) {
        const body = new FormData();
        body.set("username", sendUsername);
        const result = await setUsernameAction(INITIAL_USERNAME, body).catch((): UsernameFieldState => ({ ok: false, code: "profileIdentity.username.error" }));
        usernameOk = result.ok === true && Boolean(result.username);
        startTransition(() => {
          setUsernameState(result);
          if (result.ok && result.username) {
            const stored = result.username;
            setSavedUsername(stored);
            // Show the stored spelling - unless the user has already typed something else while this was saving.
            setUsername((current) => (current.trim() === sendUsername ? stored : current));
          }
        });
      }
      if (nameOk !== null && usernameOk !== null) startTransition(() => setAttempt({ name: nameOk, username: usernameOk }));
    });
  };

  // Mirrors the server's account-related password rule (installer-security.ts): the phone in its forms and the name.
  const passwordContext = [
    data.phoneE164 ? data.phoneE164.slice(1) : "",
    data.phoneNational ?? "",
    data.phoneNational ? `0${data.phoneNational}` : "",
    data.displayName.replace(/\s+/g, ""),
  ].filter((value) => value.length > 0);

  const unavailableNote = <span className="text-caption text-fg-secondary">{p.notAvailable}</span>;
  const lockedRow = (title: string, hint: string, Icon: Icon) => (
    <SettingRow key={title} title={title} hint={hint} icon={Icon}>
      <span className="flex items-center gap-sm">
        {unavailableNote}
        <Button variant="ghost" aria-label={`${title} — ${p.notAvailable}`} disabled><Chevron size={18} /></Button>
      </span>
    </SettingRow>
  );
  const lockedSwitch = (label: string) => (
    <div className="flex items-center gap-sm">
      {unavailableNote}
      <Button variant="ghost" role="switch" aria-checked={false} aria-label={`${label} — ${p.notAvailable}`} disabled className={styles.toggle}>
        <span aria-hidden="true" className={styles.thumb} />
      </Button>
    </div>
  );

  return (
    // The shell's `installer-surface` carries the default Installer palette; the approved Settings look is the shared
    // `flat` variant of the same palette, selected on this page body exactly as the preview does on its root.
    <div dir={dir} data-installer-settings data-installer-theme="flat" className="installer-surface flex w-full min-w-0 flex-col gap-md bg-workspace text-fg">
      <header className="flex items-center gap-md py-sm">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-surface-2"><SettingsIcon size={28} /></span>
        <div><h1 className="text-headline font-semibold">{c.title}</h1><p className="mt-1 text-body text-fg-secondary">{c.subtitle}</p></div>
      </header>

      <SettingsSection number="01" title={c.personal} description={c.personalHint} icon={UserIcon}>
        <div className="grid min-w-0 gap-md tablet:grid-cols-2">
          {/* The form element is empty on purpose: the fields use `form=` so the grid keeps the approved order. */}
          <form id={NAME_FORM} onSubmit={saveProfile} hidden />
          <LabeledField htmlFor="settings-name" label={c.name} hint={p.nameHint} error={nameState && !nameState.ok && nameState.code ? t(nameState.code) : undefined}>
            <Input id="settings-name" name="displayName" form={NAME_FORM} required maxLength={80} value={displayName} autoComplete="name" onChange={(event) => { setDisplayName(event.target.value); setNameState(null); setAttempt(null); }} />
          </LabeledField>
          <ContactEmailField status={data.contactEmail} hasPassword={data.hasPassword} />
          <LabeledField htmlFor="settings-username" label={c.username} hint={p.usernameHint} error={usernameError ? t(usernameError) : undefined}>
            <Input
              id="settings-username"
              name="username"
              form={NAME_FORM}
              dir="ltr"
              value={username}
              maxLength={24}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={usernameError ? true : undefined}
              onChange={(event) => { setUsername(event.target.value); setUsernameState(null); setShowShapeError(false); setAttempt(null); }}
            />
          </LabeledField>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-label font-medium text-fg-secondary">{p.currentPhone}</span>
            <div className="flex min-h-11 flex-wrap items-center gap-sm rounded-md border bg-canvas px-3.5 py-2.5" data-testid="settings-current-phone">
              <PhoneIcon size={18} className="shrink-0" />
              <bdi dir="ltr" className="text-body-lg">{data.phoneE164 ?? "—"}</bdi>
              <span
                className="ms-auto flex items-center gap-1 rounded-sm bg-surface-2 px-3 py-1 text-caption"
                data-testid="settings-phone-status"
                aria-label={p.phoneStatus}
              >
                {data.phoneVerified ? <CheckIcon size={13} /> : null}
                {data.phoneVerified ? p.phoneVerified : p.phoneUnverified}
              </span>
            </div>
            {/* Only a phone + password account signs in with this number; an email account's phone is contact data. */}
            {data.phoneAccount ? <p className="text-label text-fg-secondary">{p.phoneSignInHint}</p> : null}
          </div>
          {data.phoneAccount ? <PhoneChangePanel c={p} /> : <p className="text-caption text-fg-secondary tablet:col-span-2">{p.phoneOnlyPhoneAccounts}</p>}
          <div className="flex flex-wrap items-center justify-between gap-md tablet:col-span-2">
            <Button type="submit" form={NAME_FORM} disabled={saving || (!nameDirty && !usernameDirty)} aria-busy={saving}>{saving ? p.savingName : c.save}</Button>
          </div>
          <div className="tablet:col-span-2" data-testid="settings-secondary-phone">
            <SecondaryPhoneSection secondary={data.secondaryPhone} phoneLogin={data.phoneAccount} />
          </div>
          {partial ? (
            <p role="status" className="flex items-start gap-sm text-body tablet:col-span-2" data-testid="partial-save">
              {p.partialSaved.replace("{fields}", partial.name ? c.name : c.username)}
              {" "}
              {p.partialNotSaved.replace("{fields}", partial.name ? c.username : c.name)}
            </p>
          ) : null}
          {nameState?.ok && !nameDirty ? <p role="status" className="flex items-center gap-sm text-body tablet:col-span-2" data-testid="name-saved"><CheckIcon size={18} />{p.nameSaved}</p> : null}
          {usernameState?.ok && !usernameDirty ? <p role="status" className="flex items-center gap-sm text-body tablet:col-span-2" data-testid="username-saved"><CheckIcon size={18} />{p.usernameSaved} <bdi dir="ltr">{savedUsername}</bdi></p> : null}
        </div>
      </SettingsSection>

      <SettingsSection number="02" title={c.security} description={c.securityHint} icon={ShieldIcon}>
        <div className="flex flex-col gap-sm">
          <div className="flex items-center gap-sm"><ShieldIcon size={23} /><div><h3 className="text-body-lg font-semibold">{c.login}</h3><p className="text-caption text-fg-secondary">{p.loginHint}</p></div></div>
          {/* How THIS account signs in, in the same words as the personal Settings page. */}
          <p className="text-body text-fg-secondary" data-testid="settings-sign-in-method">
            {t(data.phoneAccount ? "personalSettings.account.signInBodyPhonePassword" : "personalSettings.account.signInBody")}
          </p>
          <ul className="divide-y rounded-sm border">
            {[
              { name: "Google", connected: false, known: false, Icon: GlobeIcon },
              { name: "Facebook", connected: false, known: false, Icon: GlobeIcon },
              { name: c.phone, connected: data.phoneAccount, known: true, Icon: PhoneIcon },
            ].map(({ name, connected, known, Icon }) => (
              <li key={name} className="flex items-center gap-md px-md py-2">
                <Icon size={20} />
                <span className="min-w-0 flex-1 text-body font-medium">{name}</span>
                <span className="flex items-center gap-1 rounded-sm bg-surface-2 px-3 py-1 text-caption">
                  {known && connected ? <CheckIcon size={13} /> : null}
                  {!known ? p.notAvailable : connected ? c.connected : c.disconnected}
                </span>
              </li>
            ))}
          </ul>
          {lockedRow(c.sessions, c.sessionsHint, MonitorIcon)}
          {lockedRow(c.devices, c.devicesHint, MonitorIcon)}
          {lockedRow(c.recovery, c.recoveryHint, MailIcon)}
          <PasswordChangeRow
            title={c.password}
            hint={c.passwordHint}
            c={p}
            context={passwordContext}
            disabledReason={data.phoneAccount ? null : p.phoneOnlyPhoneAccounts}
          />
          <SettingRow title={c.twoFactor} hint={c.twoFactorHint} icon={ShieldIcon}>{lockedSwitch(c.twoFactor)}</SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection number="03" title={c.notifications} description={c.notificationsHint} icon={BellIcon} compact>
        <SettingRow title={c.enableNotifications} hint={c.enableNotificationsHint} icon={BellIcon}>{lockedSwitch(c.enableNotifications)}</SettingRow>
      </SettingsSection>

      <SettingsSection number="04" title={c.account} description={c.accountHint} icon={SettingsIcon} compact>
        <div className="grid gap-md tablet:grid-cols-2">
          <div className="flex items-start gap-sm rounded-sm border p-md"><SettingsIcon size={24} className="shrink-0" /><div><Button variant="ghost" disabled>{c.suspend}</Button><p className="mt-1 text-caption text-fg-secondary">{c.suspendHint}</p><p className="mt-1 text-caption text-fg-secondary">{p.notAvailable}</p></div></div>
          <div className="flex items-start gap-sm rounded-sm border border-danger p-md"><TrashIcon size={24} className="shrink-0 text-danger" /><div><Button variant="danger" disabled>{c.delete}</Button><p className="mt-1 text-caption text-fg-secondary">{c.deleteHint}</p><p className="mt-1 text-caption text-fg-secondary">{p.notAvailable}</p></div></div>
        </div>
      </SettingsSection>
    </div>
  );
}
