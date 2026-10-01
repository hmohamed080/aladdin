import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const MODULE_HEADER_ICON_SIZE = 22;

function ModuleHeaderIcon({
  icon: Icon,
  className,
}: {
  icon: ComponentType<{ size?: number }>;
  className: string;
}) {
  return (
    <span
      data-module-header-icon=""
      className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-sm", className)}
    >
      <Icon size={MODULE_HEADER_ICON_SIZE} />
    </span>
  );
}

/**
 * The shared shape every secondary dashboard module (needs-attention, brand
 * ecosystem, learning) renders inside: one bordered card, an icon + title
 * header with an optional "view all" trailing link, a body, and an optional
 * footer link — so the four-up row at the bottom of the page reads as one
 * family of modules rather than four differently-built widgets.
 *
 * THE TITLE WRAPS RATHER THAN TRUNCATES. At the four-up desktop width each
 * column is under 260px, and "From factories & brands" — worse, its Arabic
 * "من المصانع والعلامات التجارية" — does not fit on one line beside the icon
 * at any reasonable size. Ellipsis there hid real words from a section whose
 * whole job is telling the reader what it is; two lines costs a little
 * vertical rhythm and keeps every title fully readable.
 */
export function ModuleCard({
  id,
  icon: Icon,
  iconClassName,
  title,
  headerAction,
  footer,
  footerClassName,
  children,
  className,
}: {
  id?: string;
  icon: ComponentType<{ size?: number }>;
  iconClassName: string;
  title: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  footerClassName?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      data-module-card=""
      className={cn(
        "flex h-full min-h-0 scroll-mt-24 flex-col gap-3 rounded-lg border border-strong bg-surface p-4 shadow-card desktop:min-h-96 desktop:gap-2 desktop:p-3",
        className,
      )}
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded-sm border border-strong bg-surface-2/45 px-2.5 py-1.5">
          <ModuleHeaderIcon icon={Icon} className={iconClassName} />
          <h2 className="text-title leading-snug text-fg">{title}</h2>
        </div>
        {headerAction}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 desktop:gap-1">{children}</div>

      {footer ? (
        <div className={cn("mt-auto shrink-0 border-t border-strong pt-3 desktop:pt-2", footerClassName)}>{footer}</div>
      ) : null}
    </div>
  );
}

export function ModuleFooterLink({
  href = "#",
  boxed = false,
  children,
}: {
  href?: string;
  boxed?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={href === "#" ? (e) => e.preventDefault() : undefined}
      className={cn(
        "text-center text-label font-medium text-fg transition-colors hover:text-fg-secondary hover:underline",
        boxed && "flex min-h-9 w-full items-center justify-center rounded-sm border border-strong px-3",
        !boxed && "block",
      )}
    >
      {children}
    </a>
  );
}
