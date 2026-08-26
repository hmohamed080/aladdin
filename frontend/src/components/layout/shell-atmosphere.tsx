/**
 * The sidebar's ground treatment.
 *
 * A 15rem × 100vh rectangle of one flat colour is the largest single area in the
 * workspace, and flat is exactly how it reads: dead. This gives it a material —
 * a slow tonal gradient plus a few gold flow-lines — without giving it a
 * pattern. The distinction matters, because the navigation has to stay the most
 * legible thing on this panel and every unit of contrast spent here is taken
 * from it.
 *
 * THE THREE LAYERS, AND WHY EACH IS ALLOWED
 *   1. A vertical ramp, lit at the top and deepening toward the foot. It follows
 *      the panel's own information gradient — the brand mark and the first,
 *      most-used modules are at the top — so the light lands where the eye
 *      already goes.
 *   2. Two very wide radial pools, off-axis and low-contrast. They break the
 *      flatness of the mid-panel where the ramp alone is nearly constant. At
 *      3-5% they are invisible as shapes and only perceptible as unevenness,
 *      which is the entire intent.
 *   3. Gold flow-lines: authored curves at 6-14% of Lumen. These are the brand
 *      detail. They are drawn — not a texture, not a filter, not noise — so they
 *      scale cleanly, cost one path each, and can be placed deliberately: they
 *      sweep from the panel's trailing edge inward and fade before they reach
 *      the navigation column, so no label ever sits on top of a line.
 *
 * ALL OF IT IS INERT AND UNANNOUNCED: `aria-hidden`, `pointer-events-none`, and
 * `preserveAspectRatio="none"` so the curves stretch with the panel instead of
 * tiling. Nothing here reacts to state and nothing here animates — a moving
 * background behind a navigation rail is a distraction with no message.
 */
export function ShellAtmosphere() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Layer 1 — the vertical ramp. */}
      <div className="absolute inset-0 bg-gradient-to-b from-shell-lit via-shell to-shell-deep" />

      {/* Layer 2 — tonal pools. Deliberately larger than the panel so their
          edges never appear as a visible circle. */}
      <div className="absolute -start-1/4 top-[8%] h-[42rem] w-[42rem] rounded-full bg-[radial-gradient(circle,var(--shell-pool)_0%,transparent_62%)] opacity-[0.28]" />
      <div className="absolute -end-1/3 top-[46%] h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle,var(--shell-pool)_0%,transparent_58%)] opacity-[0.2]" />

      {/* Layer 3 — the gold flow-lines. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 240 900"
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          {/* Each line fades out toward the leading edge so it dies BEFORE the
              label column rather than passing behind the text. */}
          <linearGradient id="shell-flow" x1="240" y1="0" x2="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--lumen)" stopOpacity="0.34" />
            <stop offset="0.45" stopColor="var(--lumen)" stopOpacity="0.12" />
            <stop offset="1" stopColor="var(--lumen)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="shell-flow-faint" x1="240" y1="0" x2="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--lumen)" stopOpacity="0.18" />
            <stop offset="0.5" stopColor="var(--lumen)" stopOpacity="0.06" />
            <stop offset="1" stopColor="var(--lumen)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* A family of curves sharing one origin gesture, sweeping up and out of
            the panel's trailing edge. Vector-effect keeps them hairlines at any
            panel height, which non-uniform scaling would otherwise distort. */}
        <g vectorEffect="non-scaling-stroke" strokeWidth="1" fill="none">
          <path d="M240 96 C 176 128, 132 196, 120 300 C 108 404, 140 470, 240 512" stroke="url(#shell-flow)" />
          <path d="M240 148 C 190 178, 156 232, 148 316 C 140 400, 168 452, 240 486" stroke="url(#shell-flow-faint)" />
          <path d="M240 604 C 168 636, 116 702, 104 800 C 96 862, 108 886, 128 900" stroke="url(#shell-flow)" />
          <path d="M240 656 C 186 686, 146 744, 138 820 C 133 866, 142 888, 156 900" stroke="url(#shell-flow-faint)" />
        </g>
      </svg>

      {/* The trailing edge. A gold hairline rather than a border, because a
          `border-e` would also outline the carve where it breaks through this
          edge — the one place the shell is supposed to open. */}
      <div className="absolute inset-y-0 end-0 w-px bg-gradient-to-b from-transparent via-shell-gold to-transparent opacity-70" />
    </div>
  );
}
