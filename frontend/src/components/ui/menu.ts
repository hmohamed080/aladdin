import { cn } from "@/lib/ui/cn";

/**
 * THE ONE DEFINITION OF A FLOATING MENU SURFACE.
 *
 * The account menu, the workspace switcher, the sidebar mode menu and the header
 * panels each drew this recipe themselves. They agreed on the important part —
 * `rounded-md border border-strong bg-surface shadow-lg` — which is why the drift
 * was easy to miss: only ONE of the four capped its width against the viewport,
 * so on a 360px phone the widest menus ran under the screen edge, and the one
 * that was right was right by accident rather than by rule.
 *
 * Written as a class string rather than a <Menu> component on purpose. These four
 * surfaces differ in anchoring, width, open direction, and whether they are a
 * `menu` or a `dialog`; a component that took all of that as props would be a
 * worse abstraction than the string it replaced. What has to be shared is the
 * SURFACE — ground, border, radius, elevation, clipping, and the viewport cap —
 * and that is exactly what this is.
 *
 * Anchoring, width and z-layer stay with the caller: `end-0` vs `start-0` is a
 * question about which edge the trigger sits on, and only the caller knows.
 */
export const menuSurfaceClass = cn(
  "overflow-hidden rounded-md border border-strong bg-surface shadow-lg",
  // The viewport cap, which is the whole reason this is shared. `1.5rem` is the
  // shell's horizontal gutter doubled — the menu stops one gutter short of each
  // edge instead of touching them. Applies in both directions: a `start-0` menu
  // in Arabic overflows the same way a `end-0` one does in English.
  "max-w-[calc(100vw-1.5rem)]",
);

/**
 * A row inside a menu.
 *
 * The selected/hover rule is the subtle part and it was already written twice,
 * identically, with the same long comment: selection and hover are two DIFFERENT
 * statements, so they cannot share one ground. Pointing at the row you are
 * already on must not repaint it as merely hovered — it keeps its accent and
 * only deepens. It is a branch rather than `hover:` plus a conditional base
 * because a hover variant always outranks a base utility in the emitted sheet,
 * which silently washed the selection out the first time it was written that way.
 *
 * `text-start` rather than `text-left`: these rows are read right-to-left in
 * Arabic, and a physical alignment strands every label against the wrong edge.
 */
export function menuItemClass(selected: boolean, className?: string): string {
  return cn(
    "flex w-full items-center gap-2.5 px-3 py-2 text-start text-body text-fg",
    "transition-colors focus-visible:outline-none",
    selected
      ? "bg-accent-solid/10 hover:bg-accent-solid/20 focus-visible:bg-accent-solid/20"
      : "hover:bg-surface-hover focus-visible:bg-surface-hover",
    className,
  );
}

/**
 * The small uppercase caption that titles a group of rows ("Signed in as",
 * "Workspace", "Language"). Written out four times at three different sizes and
 * two different tracking values before this existed.
 */
export const menuSectionLabelClass = cn(
  "text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted",
);
