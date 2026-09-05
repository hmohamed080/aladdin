import { cn } from "@/lib/ui/cn";

/**
 * The hero's illustrated mark — a storefront with a plus, in the reference's
 * visual direction (soft illustration, showroom metaphor, a clear "add"
 * action) rendered in the Foundation's own tokens rather than copied art.
 *
 * Sized by `className` (a `h-*`/`w-*` pair) rather than a pixel prop, so the
 * hero can hand it a real illustration-sized slot on desktop and shrink it on
 * mobile with ordinary responsive utilities instead of a second numeric size.
 * The soft blurred halo behind the mark is the "decorative background shape"
 * the reference sets its storefront into — it scales with the same
 * className, so the illustration keeps its visual weight at every size.
 *
 * Lives here rather than in the shared `icons.tsx` set because it is a
 * one-off illustration for this one hero, not a reusable glyph — the same
 * reasoning `ApertureMark` there is a named exception rather than a pattern
 * to repeat.
 */
export function StorefrontAddIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)}>
      <span
        aria-hidden="true"
        className="absolute inset-0 scale-125 rounded-full bg-accent-solid/10 blur-md"
      />
      <svg
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="relative h-full w-full"
      >
        <circle cx="28" cy="28" r="28" className="fill-accent-solid/10" />
        {/* Awning */}
        <path
          d="M15 22.5 17 15h22l2 7.5"
          className="stroke-accent"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 22.5c0 1.8 1.5 3.2 3.3 3.2s3.3-1.4 3.3-3.2c0 1.8 1.5 3.2 3.3 3.2s3.3-1.4 3.3-3.2c0 1.8 1.5 3.2 3.3 3.2s3.3-1.4 3.3-3.2c0 1.8 1.5 3.2 3.3 3.2s3.3-1.4 3.3-3.2"
          className="stroke-accent"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Shopfront body */}
        <path
          d="M17 25.5V38a1.5 1.5 0 0 0 1.5 1.5h19a1.5 1.5 0 0 0 1.5-1.5V25.5"
          className="stroke-accent"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Door */}
        <path
          d="M24.5 39.5V31a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v8.5"
          className="stroke-accent"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Window */}
        <rect x="19.5" y="30" width="3.5" height="4.5" rx="0.75" className="stroke-accent" strokeWidth="1.75" />
        <rect x="33" y="30" width="3.5" height="4.5" rx="0.75" className="stroke-accent" strokeWidth="1.75" />
        {/* Add badge */}
        <circle cx="41" cy="38" r="8" className="fill-success stroke-surface" strokeWidth="2" />
        <path d="M41 34.5v7M37.5 38h7" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
