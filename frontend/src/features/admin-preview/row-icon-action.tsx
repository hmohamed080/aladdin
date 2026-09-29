"use client";

import { useState, type ReactNode } from "react";
import { PreviewConfirmDialog } from "@/features/admin-preview/preview-action-dialog";

const toneClass = {
  neutral: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  accent: "text-accent hover:bg-accent-solid/10",
  danger: "text-danger hover:bg-danger/10",
  success: "text-success hover:bg-success/10",
} as const;

/**
 * The visible, icon-only sibling of `PreviewActionDialog` — same preview-only
 * confirm dialog underneath, but the trigger is a compact icon button (for a
 * directory row) rather than a labelled `Button`. Phase 0C: core row actions
 * (Verify/Reject/Suspend/Restore) must stay visible, not collapse into the
 * overflow menu.
 *
 * `icon` is an already-rendered node, not a component reference — a Server
 * Component parent can pass rendered JSX across the client boundary, but NOT
 * a bare function/component type (RSC only serializes elements, not
 * arbitrary functions), so the caller renders `<EyeIcon size={16} />` itself
 * and hands it in as a child element.
 */
export function RowIconAction({
  label,
  icon,
  tone = "neutral",
  title,
  body,
  confirmLabel,
  confirmVariant = "primary",
}: {
  label: string;
  icon: ReactNode;
  tone?: keyof typeof toneClass;
  title: string;
  body?: string;
  confirmLabel: string;
  confirmVariant?: "danger" | "accent" | "primary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${toneClass[tone]}`}
      >
        {icon}
      </button>
      <PreviewConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
      />
    </>
  );
}
