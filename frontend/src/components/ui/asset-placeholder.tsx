/**
 * An HONEST placeholder for a real photography asset this pass does not have
 * — never an invented substitute dressed up to look like content. Per the
 * approved Landing visual reference, several Hero/section zones need real
 * finishing-industry/showroom photography that does not exist anywhere in
 * this repository (confirmed by search). Rather than fabricate an abstract
 * stand-in for it again, this renders as a plainly-labelled placeholder in
 * the correct region, so the gap is visible and reportable instead of hidden.
 *
 * `label` names the requested asset (e.g. "HERO_VISUAL_ASSET_REQUIRED"); the
 * component is deliberately NOT styled to resemble a photo (no gradients
 * imitating marble/wood) — a diagonal hazard-stripe pattern is the one visual
 * convention actually meant to read as "placeholder", not "picture".
 */
export function AssetPlaceholder({
  label,
  note,
  className,
}: {
  label: string;
  note: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: "var(--stone-muted)",
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 10px, rgba(0,0,0,0.06) 10px 20px)",
      }}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-md text-center">
        <span className="rounded-sm bg-black/40 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-white">
          {label}
        </span>
        <span className="max-w-xs text-label text-white/80">{note}</span>
      </div>
    </div>
  );
}
