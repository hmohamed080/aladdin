"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, SubmitButton } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";

/**
 * Accessible confirmation dialog for a destructive/terminal action. The confirm
 * control submits an enclosed Server Action form (so the action still runs on
 * the server and enforces authorization); `children` supplies the hidden inputs
 * (and any extra field such as a required reason). Focus moves into the dialog on
 * open, is trapped, Escape closes, a backdrop click closes, and focus returns to
 * the trigger on close. The confirm button is disabled while pending, preventing
 * a double submit.
 */
export function ConfirmDialog({
  trigger,
  triggerVariant = "danger",
  title,
  body,
  confirmLabel,
  confirmVariant = "danger",
  action,
  children,
}: {
  trigger: string;
  triggerVariant?: "danger" | "ghost" | "outline";
  title: string;
  body?: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "accent" | "primary";
  action: ((fd: FormData) => void | Promise<void>) | string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the first focusable control inside the dialog.
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
      (previouslyFocused ?? trigger)?.focus();
    };
  }, [open]);

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

            <form action={action} className="flex flex-col gap-md">
              {children}
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
