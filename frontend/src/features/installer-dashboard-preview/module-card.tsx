import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const MODULE_HEADER_ICON_SIZE = 18;

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
  children,
  className,
}: {
  id?: string;
  icon: ComponentType<{ size?: number }>;
  iconClassName: string;
  title: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div id={id} className={cn("flex h-full scroll-mt-24 flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ModuleHeaderIcon icon={Icon} className={iconClassName} />
          <h2 className="text-title leading-snug text-fg">{title}</h2>
        </div>
        {headerAction}
      </div>

      <div className="flex flex-1 flex-col gap-2">{children}</div>

      {footer ? <div className="border-t pt-3">{footer}</div> : null}
    </div>
  );
}

export function ModuleFooterLink({ href = "#", children }: { href?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={href === "#" ? (e) => e.preventDefault() : undefined}
      className="block text-center text-label font-medium text-iris hover:underline"
    >
      {children}
    </a>
  );
}
