import Image from "next/image";
import { cn } from "@/lib/ui/cn";

/**
 * The Aladdin brand lockup — the approved mark + the localized wordmark.
 * Presentational; the localized name is passed in so it works in both server and
 * client trees. The wordmark uses the Arabic display family (Reem Kufi) for the
 * AR brand moment.
 *
 * WHY THE MARK IS AN IMAGE AND NOT A GLYPH
 * It used to be `ApertureMark`, a stroked SVG drawn in this repository as a
 * stand-in until a real logo existed. One now does, and it is an illustration —
 * a gold genie over a furnished interior — which is not a thing that can be
 * expressed as a two-path icon. So the header carries the artwork.
 *
 * `next/image` rather than a bare `<img>`: this is a LOCAL asset in `public/`,
 * so none of the reason `ProductMedia` avoids it applies (there is no
 * supplier-controlled host to allow-list, and nothing here can throw at render).
 * What it buys is the thing that actually matters at this size — the source is
 * 192px so it stays sharp on a 3× display, and every visitor on a 1× screen is
 * served a resized copy instead of the full file.
 *
 * WHY ONLY THE EMBLEM, WITH THE NAME STILL AS TEXT
 * The supplied artwork is a lockup: emblem above a Latin "ALADDIN" wordmark.
 * Using it whole would put a Latin wordmark in the Arabic UI and print the
 * product's name twice in the English one. The emblem alone, beside the
 * localized name, keeps the header bilingual — and keeps the name selectable,
 * translatable and readable to a screen reader, which baked-in type is not.
 */
export function Brand({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // The emblem is PORTRAIT (the ponytail carries it well above the circle), so
  // it is sized by height and left to find its own width. Sizing it by width —
  // the reflex, and what the square `ApertureMark` used to do — would make it
  // half again as tall as the wordmark beside it and drag the header's height
  // with it.
  const mark = size === "lg" ? 38 : size === "sm" ? 26 : 30;
  const text = size === "lg" ? "text-headline" : size === "sm" ? "text-body-lg" : "text-title";
  return (
    <span className={cn("inline-flex items-center gap-sm", className)}>
      <Image
        src="/brand/aladdin-mark.png"
        alt=""
        aria-hidden="true"
        width={192}
        height={286}
        priority
        className="w-auto shrink-0 object-contain"
        style={{ height: mark }}
      />
      <span className={cn("font-display-ar leading-none text-fg", text)}>{name}</span>
    </span>
  );
}
