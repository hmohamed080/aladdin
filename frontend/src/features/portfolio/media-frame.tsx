import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The frame every portfolio image sits in.
 *
 * A fixed ratio because a gallery of mixed aspect ratios reads as a broken layout
 * rather than as variety, and `object-cover` because a work photo cropped is still
 * the photo, while a letterboxed one is mostly empty card. This is what lets the
 * reference's image-led composition hold without knowing anything about what was
 * uploaded.
 *
 * DELIBERATELY NOT A CLIENT COMPONENT. It is a div with a class, and it is used by
 * the public profile and the hub — both server components — as well as by the
 * owner's manager. Leaving it in `parts.tsx` would have shipped `useActionState`,
 * the router and the whole manager's client bundle to a page that renders a
 * rectangle.
 */
export function MediaFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-md bg-surface-sunken",
        className,
      )}
    >
      {children}
    </div>
  );
}
