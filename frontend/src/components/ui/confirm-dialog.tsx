"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, SubmitButton } from "@/components/ui/controls";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/ui/cn";
import type { FormState } from "@/server/actions/sales-forms";

const ICON_TONES = {
  neutral: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "text-danger hover:bg-danger/10",
  success: "text-success hover:bg-success/10",
} as const;

/**
 * Accessible confirmation dialog for a destructive/terminal action. Focus moves
 * into the dialog on open, is trapped, Escape closes, a backdrop click closes,
 * and focus returns to the trigger on close. The confirm button is disabled while
 * pending (no double submit).
 *
 * Two action modes:
 *  - `action` (void/string): a plain Server Action form (fire-and-forget; the
 *    action redirects/revalidates). Used for simple archive/cancel.
 *  - `formAction` (FormState): a STATEFUL action via `useActionState`. The dialog
 *    stays OPEN on error and renders `state.code` (so a required reason and its
 *    validation feedback survive — useActionState does not reset the form on a
 *    non-redirect return); on success it refreshes and closes. `children` may be a
 *    render function `(state) => ReactNode` to show per-field errors.
 *
 * Success feedback: a successful `formAction` that returns a `code` ("Review started.", "Cooldown lifted.")
 * is shown as a Toast (`@/components/ui/toast`, drawn by the root layout's `<Toaster />`, a polite live
 * region). It cannot be drawn inside the dialog: the dialog closes on success, and the refreshed server data
 * often unmounts the control that opened it, so anything local to either would be thrown away unseen.
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "danger",
  triggerIcon,
  triggerClassName,
  title,
  body,
  confirmLabel,
  confirmVariant = "danger",
  action,
  formAction,
  confirmDisabled = false,
  defaultOpen = false,
  wide = false,
  triggerIconOnly = false,
  triggerTone = "neutral",
  children,
}: {
  trigger: string;
  triggerVariant?: "danger" | "ghost" | "outline" | "accent";
  /** Optional icon beside the trigger label, and extra classes for the trigger button (sizing in a button row). */
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  title: string;
  body?: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "accent" | "primary";
  action?: ((fd: FormData) => void | Promise<void>) | string;
  formAction?: (prev: FormState, fd: FormData) => Promise<FormState>;
  /**
   * Extra gate ORed with the form's own pending state (e.g. a field inside
   * `children` is in a state that must not be submitted — a branch move that
   * would strand the currently-selected assignee). The dialog itself carries
   * no knowledge of what makes a submission unsafe; the caller decides.
   */
  confirmDisabled?: boolean;
  /** Opens on first render (a deep link into the confirmation). Nothing is submitted until the person confirms. */
  defaultOpen?: boolean;
  /** Wider panel for editors (e.g. the Admin role editor). */
  wide?: boolean;
  /**
   * Render the trigger as a compact icon button (a table-row action) showing only
   * `triggerIcon`; `trigger` becomes its accessible name and tooltip.
   */
  triggerIconOnly?: boolean;
  triggerTone?: keyof typeof ICON_TONES;
  children?: ReactNode | ((state: FormState) => ReactNode);
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const [state, dispatch] = useActionState(
    async (prev: FormState, fd: FormData): Promise<FormState> => {
      if (!formAction) return prev;
      const res = await formAction(prev, fd);
      // Success (or a conflict we refreshed): close and reload the server data.
      if (res.ok) {
        if (res.code) showToast(t(res.code));
        router.refresh();
        setOpen(false);
      } else if (res.code === "states.staleConflict" || res.code === "leads.conflict") {
        router.refresh();
      }
      return res;
    },
    { ok: false } as FormState,
  );

  useEffect(() => {
    if (!open) return;
    const triggerEl = triggerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          // Exclude hidden inputs — focusing one is a no-op, which would leave the
          // dialog without focus (and break the trap) when a form leads with them. Likewise the shared Select's
          // aria-hidden native <select> (its form-value carrier): the visible button is the focusable control.
          'button, [href], input:not([type="hidden"]), select:not([aria-hidden="true"]), textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
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
      (previouslyFocused ?? triggerEl)?.focus();
    };
  }, [open]);

  const formProps = formAction ? { action: dispatch } : { action };
  const renderedChildren = typeof children === "function" ? children(state) : children;

  return (
    <>
      {triggerIconOnly && triggerIcon ? (
        <button
          ref={triggerRef}
          type="button"
          title={trigger}
          aria-label={trigger}
          onClick={() => setOpen(true)}
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
            ICON_TONES[triggerTone],
          )}
        >
          {triggerIcon}
        </button>
      ) : (
        <Button ref={triggerRef} type="button" variant={triggerVariant} className={triggerClassName} onClick={() => setOpen(true)}>
          {triggerIcon}
          {trigger}
        </Button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-brand-basalt/60 p-md"
          style={{ zIndex: 500 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={body ? bodyId : undefined}
            className={cn(
              "flex max-h-[90dvh] w-full flex-col gap-md overflow-auto rounded-md border bg-surface p-lg shadow-lg",
              wide ? "max-w-2xl" : "max-w-md",
            )}
          >
            <h2 id={titleId} className="text-title text-fg">
              {title}
            </h2>
            {body ? (
              <p id={bodyId} className="text-body text-fg-secondary">
                {body}
              </p>
            ) : null}

            {formAction && state.code && !state.ok ? (
              <p role="alert" className="rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger">
                {t(state.code)}
              </p>
            ) : null}

            <form {...formProps} className="flex flex-col gap-md">
              {renderedChildren}
              <div className="flex flex-wrap justify-end gap-sm">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <SubmitButton variant={confirmVariant} pendingLabel={t("common.saving")} disabled={confirmDisabled}>
                  {confirmLabel}
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
