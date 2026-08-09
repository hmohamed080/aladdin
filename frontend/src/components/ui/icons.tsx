import type { SVGProps } from "react";

/**
 * Minimal inline icon set (no runtime dependency). Lucide-style geometry:
 * 24×24 viewBox, `currentColor` stroke, 1.75 width, round caps/joins — so icons
 * inherit text color and theme automatically. Add new glyphs here rather than
 * pulling in an icon library (dependency policy). `aria-hidden` by default; give
 * an accessible name on the interactive element that wraps the icon.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Svg>
);

export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
    <circle cx="9.5" cy="7.5" r="3.5" />
    <path d="M21 20v-1.5a4 4 0 0 0-3-3.87" />
    <path d="M15.5 4.13a3.5 3.5 0 0 1 0 6.74" />
  </Svg>
);

export const TargetIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const CalendarCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
    <path d="M3.5 9h17M8 3v3M16 3v3" />
    <path d="m9 14.5 2 2 4-4" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.3 4.3 2.6 17.5A1.8 1.8 0 0 0 4.2 20.2h15.6a1.8 1.8 0 0 0 1.6-2.7L13.7 4.3a1.8 1.8 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const ActivityIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h4l2.5 6L14 6l2.5 6H21" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const LogOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H15" />
    <path d="M10 12h10m0 0-3.5-3.5M20 12l-3.5 3.5" />
  </Svg>
);

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
  </Svg>
);

export const PackageIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 8.5 12 3.5 3 8.5v7L12 20.5l9-5v-7Z" />
    <path d="M3 8.5 12 13.5l9-5M12 13.5V20.5" />
  </Svg>
);

export const FileTextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
    <path d="M14 3.5V8.5h5M8.5 13h7M8.5 16.5h7M8.5 9.5h2" />
  </Svg>
);

export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5h14v17l-2.5-1.5L14 20.5l-2-1.5-2 1.5-2.5-1.5L5 20.5Z" />
    <path d="M9 8.5h6M9 12h6" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

/** The Aperture mark — a chamfered opening with a warm Lumen core. */
export function ApertureMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" className="stroke-fg/25" strokeWidth={1.5} />
      <path
        d="M12 6.2 17.8 12 12 17.8 6.2 12Z"
        className="stroke-fg/40"
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="12" cy="12" r="2.6" fill="var(--accent-solid)" />
      <circle cx="12" cy="12" r="2.6" fill="var(--accent-solid)" opacity="0.35" style={{ filter: "blur(3px)" }} />
    </svg>
  );
}
