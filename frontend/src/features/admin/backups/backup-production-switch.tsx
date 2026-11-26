"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { showToast } from "@/components/ui/toast";
import { setProductionBackupAction } from "@/server/actions/admin-backups";
import type { FormState } from "@/server/actions/sales-forms";

const INITIAL: FormState = { ok: false };

/**
 * The Production On/Off switch. Turning ON is one press; turning OFF asks first (owner, 2026-11-26).
 * Presentation only: the action takes the actor from the verified session and the database checks the permission.
 * The position shown is the saved one, so a refused change leaves the switch where it was.
 */
export function BackupProductionSwitch({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, turnOn, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await setProductionBackupAction(prev, fd);
    if (result.ok) {
      if (result.code) showToast(t(result.code));
      router.refresh();
    }
    return result;
  }, INITIAL);

  // On and off are drawn by different elements, so a change made here would drop the keyboard user on the page body.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pressedFrom = useRef<boolean | null>(null);
  useEffect(() => {
    if (pending || pressedFrom.current === null || pressedFrom.current === enabled) return;
    pressedFrom.current = null;
    if (!document.activeElement || document.activeElement === document.body) toggleRef.current?.focus();
  }, [enabled, pending]);

  const toggle = (type: "button" | "submit", onClick?: () => void) => (
    <button
      ref={toggleRef}
      type={type}
      role="switch"
      aria-checked={enabled}
      aria-label={t("backups.activation.title")}
      aria-describedby="backup-production-switch-help"
      disabled={!canManage || pending}
      onClick={() => {
        pressedFrom.current = enabled;
        onClick?.();
      }}
      data-testid="backup-production-toggle"
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-50",
        enabled ? "border-success bg-success" : "border-strong bg-surface-hover",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-5 w-5 rounded-pill shadow-sm transition-transform",
          enabled ? "bg-surface" : "bg-fg-muted",
          // logical offsets keep the knob on the correct side in RTL
          enabled ? "ltr:translate-x-6 rtl:-translate-x-6" : "ltr:translate-x-1 rtl:-translate-x-1",
        )}
      />
    </button>
  );

  return (
    <Card>
      <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between" data-testid="backup-production-switch">
        <div className="min-w-0 sm:flex-1">
          <SectionTitle>{t("backups.activation.title")}</SectionTitle>
          <p id="backup-production-switch-help" className="mt-xs text-label text-fg-muted">{t("backups.activation.description")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-sm">
          <span className="text-body font-medium text-fg">{t(enabled ? "backups.activation.on" : "backups.activation.off")}</span>
          {enabled ? (
            <ConfirmDialog
              trigger={t("backups.activation.turnOff")}
              title={t("backups.activation.confirmOffTitle")}
              body={t("backups.activation.confirmOffBody")}
              confirmLabel={t("backups.activation.turnOff")}
              formAction={setProductionBackupAction}
              renderTrigger={({ open }) => toggle("button", open)}
            >
              <input type="hidden" name="enabled" value="false" />
            </ConfirmDialog>
          ) : (
            <form action={turnOn} className="flex">
              <input type="hidden" name="enabled" value="true" />
              {toggle("submit")}
            </form>
          )}
        </div>
      </div>
      {!canManage ? <p className="mt-sm text-body text-fg-secondary">{t("backups.viewOnly")}</p> : null}
      {!enabled && state.code && !state.ok ? <p role="alert" className="mt-sm text-body text-danger">{t(state.code)}</p> : null}
    </Card>
  );
}
