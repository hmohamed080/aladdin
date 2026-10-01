type VisualIconProps = { size?: number; className?: string };

export function NetworkTrophyIcon({ size = 18, className }: VisualIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" className={className}>
      <path d="M7.2 3.5h9.6v5.1A4.8 4.8 0 0 1 12 13.4a4.8 4.8 0 0 1-4.8-4.8V3.5Z" fill="currentColor" />
      <path d="M7.2 5.4H3.8v2A4.2 4.2 0 0 0 8 11.6M16.8 5.4h3.4v2a4.2 4.2 0 0 1-4.2 4.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 13.4v4.1M8.7 20.5h6.6M9.8 17.5h4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m12 5.4.75 1.5 1.65.24-1.2 1.16.28 1.64L12 9.16l-1.48.78.28-1.64-1.2-1.16 1.65-.24L12 5.4Z" className="fill-surface" />
    </svg>
  );
}

export function NetworkStoreIcon({ size = 18, className }: VisualIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" className={className}>
      <path d="M4 9.2 5.7 3.8h12.6L20 9.2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 9.2h16v1.1c0 1.3-1 2.3-2.3 2.3-1 0-1.8-.6-2.2-1.4-.4.8-1.3 1.4-2.3 1.4S11.4 12 11 11.2c-.4.8-1.3 1.4-2.3 1.4-1 0-1.8-.6-2.2-1.4-.4.8-1.2 1.4-2.2 1.4" fill="currentColor" opacity=".28" />
      <path d="M5.4 12v8.2h13.2V12M9.1 20.2v-4.8h5.8v4.8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function NetworkPeopleIcon({ size = 18, className }: VisualIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="7.3" r="3.2" fill="currentColor" />
      <circle cx="5.3" cy="9.5" r="2.3" fill="currentColor" opacity=".72" />
      <circle cx="18.7" cy="9.5" r="2.3" fill="currentColor" opacity=".72" />
      <path d="M6.2 20v-2.1a5.8 5.8 0 0 1 11.6 0V20H6.2Z" fill="currentColor" />
      <path d="M1.8 19.4v-1.2c0-2.6 1.8-4.7 4.2-5.2.9-.2 1.7 0 2.4.5A7.8 7.8 0 0 0 4.7 20H2.4a.6.6 0 0 1-.6-.6ZM22.2 19.4v-1.2c0-2.6-1.8-4.7-4.2-5.2-.9-.2-1.7 0-2.4.5a7.8 7.8 0 0 1 3.7 6.5h2.3a.6.6 0 0 0 .6-.6Z" fill="currentColor" opacity=".72" />
    </svg>
  );
}

export function NetworkStarIcon({ size = 18, className }: VisualIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
      <path fill="currentColor" d="m12 2.7 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 16.9l-5.56 2.92 1.06-6.2L3 9.23l6.22-.9L12 2.7Z" />
    </svg>
  );
}

export function NetworkClockIcon({ size = 18, className }: VisualIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5l3.3 1.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export function ShowroomLogo({ id, mark }: { id: string; mark: string }) {
  if (id === "elite") {
    return <span className="grid h-16 w-16 shrink-0 place-items-center rounded-pill bg-shell text-center shadow-sm"><span className="leading-none text-warning"><span className="block text-label font-bold">النخبة</span><span className="mt-0.5 block text-body font-semibold">Elite</span></span></span>;
  }
  if (id === "modern-floors") {
    return <span className="grid h-16 w-16 shrink-0 place-items-center rounded-pill bg-shell text-center text-shell-fg shadow-sm"><span className="text-[10px] font-bold leading-tight tracking-wide"><span className="block">MODERN</span><span className="block">FLOORS</span></span></span>;
  }
  if (id === "marble-pro") {
    return <span className="grid h-16 w-16 shrink-0 place-items-center rounded-pill bg-shell text-center shadow-sm"><span className="leading-none text-warning"><span className="block text-title font-medium">M</span><span className="mt-0.5 block text-[9px] font-semibold tracking-wide">MARBLE PRO</span></span></span>;
  }
  if (id === "ahram") {
    return <span className="grid h-16 w-16 shrink-0 place-items-center rounded-pill bg-bronze text-center text-on-accent shadow-sm"><span className="leading-none"><span className="block text-body font-bold">الأهرام</span><span className="mt-1 block text-[10px] font-medium">للديكور</span></span></span>;
  }
  return <span className="grid h-16 w-16 shrink-0 place-items-center rounded-pill bg-shell text-label font-bold text-shell-fg shadow-sm">{mark}</span>;
}
