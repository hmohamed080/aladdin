import { ApertureMark } from "@/components/ui/icons";

/**
 * The desktop auth Brand Panel — a premium, always-dark brand plate (a deliberate
 * brand moment, like Admin surfaces) with a restrained Lumen glow and the
 * Aperture mark. Presentational; copy is passed localized. Hidden below desktop
 * (the form panel stacks full-width on tablet/mobile).
 */
export function AuthBrandPanel({ name, tagline, note }: { name: string; tagline: string; note: string }) {
  return (
    <div className="relative hidden overflow-hidden bg-brand-basalt desktop:flex desktop:flex-col desktop:justify-between desktop:p-xl">
      {/* Restrained Lumen bloom in the corner (the aperture's focal glow). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-24 -top-24 h-96 w-96 rounded-pill"
        style={{ background: "radial-gradient(circle, rgba(243,171,62,0.16), transparent 62%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(160deg, transparent, rgba(14,17,19,0.55))" }}
      />

      <div className="relative flex items-center gap-sm">
        <ApertureMark size={32} />
        <span className="font-display-ar text-title text-brand-limestone">{name}</span>
      </div>

      <div className="relative max-w-md">
        <h2 className="font-display-ar text-display-ar text-brand-limestone">{tagline}</h2>
        <p className="mt-md text-body-lg leading-relaxed" style={{ color: "var(--on-dark-secondary)" }}>
          {note}
        </p>
      </div>

      <p className="relative text-label" style={{ color: "var(--on-dark-muted)" }}>
        © {name}
      </p>
    </div>
  );
}
