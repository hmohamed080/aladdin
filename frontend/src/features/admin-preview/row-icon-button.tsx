import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const toneClass = {
  neutral: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  accent: "text-accent hover:bg-accent-solid/10",
  danger: "text-danger hover:bg-danger/10",
  success: "text-success hover:bg-success/10",
} as const;

const baseClass =
  "grid h-8 w-8 shrink-0 place-items-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface";

/**
 * Phase 0C — "do not hide all important actions behind a three-dot menu."
 * A compact, ALWAYS-VISIBLE icon button for a row's core actions (View,
 * WhatsApp, Verify/Reject, Suspend/Restore) — the reference implementation's
 * own row-action pattern (inline icons with a `title` tooltip, not a hidden
 * dropdown). Less-common actions still go in `RowActionsMenu`'s overflow.
 */
export function RowIconLink({
  href,
  label,
  Icon,
  tone = "neutral",
  external,
}: {
  href: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  tone?: keyof typeof toneClass;
  external?: boolean;
}) {
  const className = cn(baseClass, toneClass[tone]);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label} className={className}>
        <Icon size={16} />
      </a>
    );
  }
  return (
    <Link href={href} title={label} aria-label={label} className={className}>
      <Icon size={16} />
    </Link>
  );
}

export function RowIconButton({
  label,
  Icon,
  tone = "neutral",
  onClick,
  children,
}: {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  tone?: keyof typeof toneClass;
  onClick?: () => void;
  /** Optional dialog rendered alongside — the button just becomes the visible trigger. */
  children?: ReactNode;
}) {
  return (
    <>
      <button type="button" title={label} aria-label={label} onClick={onClick} className={cn(baseClass, toneClass[tone])}>
        <Icon size={16} />
      </button>
      {children}
    </>
  );
}
