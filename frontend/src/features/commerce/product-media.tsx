import { PackageIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The image on a product card.
 *
 * A finishing catalogue is a catalogue of SURFACES — a buyer picks a floor tile
 * by looking at it, and a grid of grey boxes with names on them is a spreadsheet
 * with extra steps. So where `image_ref` exists, it is shown at a fixed 4:3 ratio
 * so the grid keeps its rhythm no matter what the supplier uploaded.
 *
 * A plain `<img>`, not `next/image`: `image_ref` is a free-text reference a
 * supplier controls, `next/image` would need every possible host allow-listed in
 * `next.config`, and an un-allow-listed host throws at render — one bad reference
 * would take down the whole catalog page. Lazy loading and `decoding="async"`
 * give the part of `next/image` that actually matters here.
 *
 * With no image, the card falls back to a neutral marked panel rather than an
 * empty box or a broken-image glyph: "no photo yet" is information, a broken
 * icon is a bug report.
 */
export function ProductMedia({
  src,
  alt,
  className,
}: {
  src: string | null;
  /** The product name — never "product image", which tells a screen reader nothing. */
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-sm bg-surface-2",
        className,
      )}
    >
      {src ? (
        /* next/image is not usable here — see the component note above. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-fg-muted" aria-hidden="true">
          <PackageIcon size={28} />
        </div>
      )}
    </div>
  );
}
