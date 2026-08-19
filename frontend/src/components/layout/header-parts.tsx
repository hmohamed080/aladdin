import { cn } from "@/lib/ui/cn";

/**
 * Geometry shared by everything that sits in the top header.
 *
 * It lives in its own module — not in `app-header` — because both the server
 * header and the CLIENT panels inside it need these values, and `app-header`
 * reads `cookies()`. Importing it from a client component would drag
 * `next/headers` into the browser bundle and fail the build.
 */

/**
 * The header's icon-only control: 28px, so four of them fit inside a 48px bar
 * without crowding the avatar. Defined once so Help, the theme switch, Chat,
 * Notifications and anything a surface adds later cannot each pick their own box.
 */
export const headerIconClass = cn(
  "grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors",
  "hover:bg-surface-hover hover:text-fg",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
);

/** A header panel: same width, ground, border and elevation for every one. */
export const headerPanelClass = cn(
  "absolute end-0 top-full mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-strong bg-surface shadow-lg",
);

/**
 * The breadcrumb slash between the mark and the context it introduces, and
 * between two context chips.
 *
 * A rule or a chevron would both say more than is true here: the workspace is
 * not INSIDE the brand, and the branch is not a child route of the organization.
 * A hairline slash reads as "then", which is what the relationship actually is,
 * and it is the same device the reference uses.
 */
export function HeaderSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("hidden shrink-0 select-none text-body text-fg-muted/60 tablet:block", className)}
    >
      /
    </span>
  );
}
