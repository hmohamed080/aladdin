import type { SVGProps } from "react";
import type { IconName } from "./landing-brand-content";

const PATHS: Record<IconName, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  "user-plus": "M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M19 8v6M16 11h6",
  play: "M7 4l13 8-13 8z",
  users: "M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M16 5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .8 3.2 2.6 3.5 5.5",
  building: "M4 21V5l8-2v18M12 9l8 2v10M2 21h20M7 8v.01M7 12v.01M7 16v.01M16 14v.01M16 17v.01",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  home: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6",
  compass: "M12 3v3M12 6L6 21M12 6l6 15M8.5 15h7",
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z",
  cart: "M3 4h2l2.5 11h10L20 7H6.5",
  tag: "M3 12V4h8l10 10-8 8z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  star: "M12 3l2.7 5.6 6.3.9-4.5 4.3 1 6.2-5.5-3-5.5 3 1-6.2L3 9.5l6.3-.9z",
  bolt: "M13 2L5 14h6l-1 8 8-12h-6z",
  headset: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H4zM17 14h3v5h-3zM20 19c0 2-2 2-5 2",
  search: "M20 20l-4.5-4.5",
  check: "M8 12l3 3 5-6",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  phone: "M8 2h8v20H8zM11 18h2",
  clock: "M12 12l4-3",
  arrow: "M19 12H5M11 6l-6 6 6 6",
  bag: "M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  diamond: "M12 3l9 9-9 9-9-9z",
  sofa: "M4 11V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v4M2 11h4v5h12v-5h4v9H2z",
  chevron: "M15 5l-7 7 7 7",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
};

/** Round shapes that need an explicit circle in addition to the path (the path alone would be incomplete). */
const CIRCLES: Partial<Record<IconName, [number, number, number][]>> = {
  "user-plus": [[9, 8, 3.5]],
  users: [[9, 8, 3.5]],
  search: [[11, 11, 6]],
  check: [[12, 12, 9]],
  clock: [[12, 12, 9]],
  cart: [[9, 19, 1.4], [17, 19, 1.4]],
};

export function BrandIcon({ name, size = 24, ...rest }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {CIRCLES[name]?.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
      <path d={PATHS[name]} fill={name === "play" ? "currentColor" : "none"} />
    </svg>
  );
}

export function SocialIcon({ name }: { name: "facebook" | "instagram" | "tiktok" }) {
  if (name === "facebook") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>;
  if (name === "instagram") return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></svg>;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9.2a7.3 7.3 0 0 0 4.2 1.3V7.4a4.3 4.3 0 0 1-3.1-1.6z" /></svg>;
}
