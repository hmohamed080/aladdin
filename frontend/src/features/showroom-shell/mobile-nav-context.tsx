"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type MobileNav = { open: boolean; openMenu: () => void; closeMenu: () => void };

const MobileNavContext = createContext<MobileNav | null>(null);

/**
 * Lets a server-rendered layout connect the topbar's menu button to the sidebar's slide-in drawer.
 * Both ends are client components, but the layout that mounts them is not, so a callback prop
 * cannot cross between them; they meet here instead. `null` outside a provider (the Showroom
 * shell, which owns this state itself).
 */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, openMenu: () => setOpen(true), closeMenu: () => setOpen(false) }), [open]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav(): MobileNav | null {
  return useContext(MobileNavContext);
}
