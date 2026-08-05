"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, SubmitButton } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";
import type { FormState } from "@/server/actions/sales-forms";

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
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "danger",
  title,
  body,
  confirmLabel,
  confirmVariant = "danger",
  action,
  formAction,
  children,
}: {
  trigger: string;
  triggerVariant?: "danger" | "ghost" | "outline" | "accent";
  title: string;
  body?: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "accent" | "primary";
  action?: ((fd: FormData) => void | Promise<void>) | string;
  formAction?: (prev: FormState, fd: FormData) => Promise<FormState>;
  children?: ReactNode | ((state: FormState) => ReactNode);
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
          // dialog without focus (and break the trap) when a form leads with them.
          'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
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
      <Button ref={triggerRef} type="button" variant={triggerVariant} onClick={() => setOpen(true)}>
        {trigger}
      </Button>

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
              "flex max-h-[90dvh] w-full max-w-md flex-col gap-md overflow-auto rounded-md border bg-surface p-lg shadow-lg",
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
                <SubmitButton variant={confirmVariant} pendingLabel={t("common.saving")}>
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
