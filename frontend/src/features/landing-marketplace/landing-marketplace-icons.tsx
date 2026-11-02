import type { SVGProps } from "react";
import { GridIcon } from "@/components/ui/icons";
import type { CategoryFilter } from "./landing-marketplace-content";

/**
 * Domain glyphs for the six Marketplace product types. Same geometry as the
 * shared set in `components/ui/icons.tsx` (24×24, currentColor, 1.75 stroke,
 * round caps) so they read as one family; kept local to this feature because
 * the shared file is owned by the wider UI foundation.
 */
function Glyph({ children, size = 22, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function CategoryIcon({ type }: { type: CategoryFilter }) {
  switch (type) {
    case "all":
      return <GridIcon size={22} />;
    case "wallpaper":
      return <Glyph><path d="M7 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7" /><ellipse cx="7" cy="12" rx="3" ry="8" /><path d="M13 9h2M12 14h3" /></Glyph>;
    case "wood_alternative":
      return <Glyph><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M13 4v16M18 4v16" /></Glyph>;
    case "marble_alternative":
      return <Glyph><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15 10 9l3 2 8-6M12 20l4-5" /></Glyph>;
    case "sheeboard":
      return <Glyph><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="m3 14 9 5 9-5" /></Glyph>;
    case "cornice":
      return <Glyph><path d="M3 5h18v3H3zM6 8v3h12V8M9 11v3h6v-3" /></Glyph>;
    case "corner_trim":
      return <Glyph><path d="M5 4h4v11h10v4H5V4Z" /></Glyph>;
  }
}

export function ArrowIcon({ size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <Glyph size={size} strokeWidth={2.25} {...rest}><path d="M5 12h14M13 6l6 6-6 6" /></Glyph>
  );
}
