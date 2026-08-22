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
 * PROVENANCE — both files under `public/brand/` are derived from the APPROVED
 * artwork, losslessly, and neither is drawn or generated here:
 *
 *   aladdin-logo.png  684×643  the approved lockup, with its transparent
 *                              padding trimmed. No resampling — every pixel of
 *                              the artwork is the supplied one.
 *   aladdin-mark.png  261×384  the emblem alone, cut from that same file above
 *                              the wordmark's first scanline and box-filtered
 *                              down in premultiplied alpha (so the transparent
 *                              ground cannot bleed a dark fringe into the gold).
 *
 * The emblem is what the header uses; see below for why it is not the lockup.
 * The artwork's ground is fully transparent, which is what lets one file sit on
 * Limestone and on Carbon without a plate behind it.
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
 *
 * There is also a plain arithmetic reason. The lockup is 684×643 with the
 * wordmark occupying its bottom sixth; scaled to the 30px the header gives it,
 * "ALADDIN" would land at about four pixels tall — not small type, just a grey
 * smear under the emblem. `aladdin-logo.png` is therefore the asset of record
 * for anywhere the lockup gets real estate, and not what the header draws.
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
  //
  // `md` IS THE AUTHENTICATED HEADER'S LOCKUP, and 48 is chosen against the type
  // beside it rather than against the bar around it. The name renders at
  // `text-title` (20px), whose Arabic word-height including the dots is roughly
  // 24px; a 48px emblem therefore stands about 2× the wordmark, which is the
  // ordinary proportion for an emblem introducing a wordmark and still reads as
  // ONE lockup rather than as a picture with a caption.
  //
  // The NAME deliberately did not grow with it. The type scale steps from
  // `title` (20px) straight to `headline` (32px, weight 800), which in a header
  // would outshout the page title two rows below it; and inventing a 24px step
  // here would put an off-scale size in the most-seen component in the product.
  // The emblem carries the increase, which is the half of the lockup that had
  // detail to gain from it.
  //
  // `sm` is untouched at 26: it belongs to the PRE-WORKSPACE surfaces (sign-in,
  // onboarding, the no-organization notice), which are not this header and have
  // their own, quieter chrome.
  //
  // WHY `md` IS TWO SIZES AND NOT ONE
  // Below `tablet` it stays exactly where `sm` is, because the phone header has
  // no room to give: at 393px the lockup shares one row with a collapsed search
  // and six more controls, and the ~40px a 48px mark adds is the difference
  // between that row fitting and that row wrapping. The mark grows at the same
  // breakpoint the bar does, so the two never disagree — a 48px lockup in a 48px
  // bar would sit edge to edge with no clearance at all.
  //
  // Sized in CSS rather than through an inline `style`, which is the whole
  // reason this can be responsive at all: a number in a style attribute has no
  // breakpoints.
  const mark =
    size === "lg" ? "h-[38px]" : size === "sm" ? "h-[26px]" : "h-[26px] tablet:h-12";
  const text =
    size === "lg"
      ? "text-headline"
      : size === "sm"
        ? "text-body-lg"
        : "text-body-lg tablet:text-title";
  return (
    <span className={cn("inline-flex items-center gap-sm", className)}>
      <Image
        src="/brand/aladdin-mark.png"
        alt=""
        aria-hidden="true"
        /* The mark's INTRINSIC size, which must track the file: `next/image`
           derives the aspect ratio from these two numbers, so a stale pair
           silently distorts the artwork rather than failing. 261×384 against a
           48px rendered height is 8× the CSS pixels, so the mark still has 2.7×
           in hand on a 3× display and never resolves soft. */
        width={261}
        height={384}
        priority
        className={cn("w-auto shrink-0 object-contain", mark)}
      />
      <span className={cn("font-display-ar leading-none text-fg", text)}>{name}</span>
    </span>
  );
}
