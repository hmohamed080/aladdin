"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";

/**
 * PREVIEW-ONLY action dialog — Phase 0 Admin Frontend Blueprint.
 *
 * This is a deliberately SELF-CONTAINED sibling of `components/ui/confirm-dialog.tsx`,
 * not a reuse of it: the real `ConfirmDialog` is wired for genuine Server Actions
 * (`action`/`formAction` that mutate real data). This component NEVER calls a
 * server action, NEVER calls an RPC, and NEVER performs `router.refresh()` —
 * there is nothing to refresh, because nothing was written. Confirming here only
 * moves local component state from "open" to "a preview-only acknowledgement was
 * shown" — it exists to demonstrate the intended interaction shape (title, body,
 * fields, confirm/cancel) for Product Owner review, per PD-013.
 *
 * Every instance renders an explicit, permanent "Preview only" note inside the
 * dialog body — never only in a tooltip or a corner label — so there is no way
 * to mistake the confirm action for a real mutation.
 */

/**
 * The controlled dialog body, factored out so `RowActionsMenu` (Phase 0B) can
 * drive the SAME modal from a menu item instead of a dedicated trigger button —
 * one row cannot show ten trigger buttons. `PreviewActionDialog` below is the
 * original uncontrolled shape (its own Button trigger + local open state),
 * unchanged for every existing call site.
 */
export function PreviewConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  confirmVariant = "primary",
  confirmDisabled = false,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "accent" | "primary";
  confirmDisabled?: boolean;
  /** Wider panel for editors (role editor, follow-up, report). */
  wide?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    setConfirmed(false);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-brand-basalt/60 p-md"
      style={{ zIndex: 500 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        className={cn("flex max-h-[90dvh] w-full flex-col gap-md overflow-auto rounded-md border bg-surface p-lg shadow-lg", wide ? "max-w-2xl" : "max-w-md")}
      >
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="text-title text-fg">
            {title}
          </h2>
          <span className="rounded-pill bg-warning/15 px-2 py-0.5 text-label font-medium text-warning">
            {t("admin.preview.previewOnlyBadge")}
          </span>
        </div>
        {body ? (
          <p id={bodyId} className="text-body text-fg-secondary">
            {body}
          </p>
        ) : null}

        {/* Permanent, not conditional on state — this note is always visible
            whenever the dialog is open, per the Phase 0 safety requirement. */}
        <p className={cn("rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary")}>
          {t("admin.preview.previewOnlyNote")}
        </p>

        {confirmed ? (
          <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success">
            {t("admin.preview.previewConfirmed")}
          </p>
        ) : (
          <div className="flex flex-col gap-md">{children}</div>
        )}

        <div className="flex flex-wrap justify-end gap-sm">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {!confirmed ? (
            <Button
              type="button"
              variant={confirmVariant}
              disabled={confirmDisabled}
              onClick={() => setConfirmed(true)}
            >
              {confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PreviewActionDialog({
  trigger,
  triggerVariant = "outline",
  title,
  body,
  confirmLabel,
  confirmVariant = "primary",
  confirmDisabled = false,
  wide = false,
  children,
}: {
  trigger: string;
  triggerVariant?: "danger" | "ghost" | "outline" | "accent" | "primary";
  title: string;
  body?: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "accent" | "primary";
  confirmDisabled?: boolean;
  wide?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={triggerRef} type="button" variant={triggerVariant} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <PreviewConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) triggerRef.current?.focus();
        }}
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        confirmDisabled={confirmDisabled}
        wide={wide}
      >
        {children}
      </PreviewConfirmDialog>
    </>
  );
}
