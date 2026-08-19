/**
 * The sidebar's icon COLUMN, defined once.
 *
 * WHY THIS MODULE EXISTS
 * A sidebar is a vertical list of icons with a label beside each one, and the
 * single thing a user's eye checks is whether those icons form a straight line.
 * They did not. The navigation rows were laid out by `workspace-nav`, the
 * display-mode control at the foot of the panel was laid out by `sidebar-shell`,
 * and the two files had each chosen their own padding: the nav column sat inside
 * `px-3` and each row added another `px-3`, putting its glyph 1.5rem from the
 * panel edge, while the control's footer used `p-2` and its button added `px-3`,
 * putting its glyph at 1.25rem. Four pixels — small enough to survive review,
 * large enough that the bottom icon visibly falls out of the column above it.
 *
 * The tempting fix is to nudge the control by 4px. That is exactly how the
 * defect returns: the nudge is a constant tuned against today's padding, and it
 * has to be re-derived by hand for the collapsed rail, then again for RTL, where
 * a physical margin lands on the wrong side entirely. So instead of a
 * correction, both call sites now ask the SAME functions for their geometry and
 * cannot disagree by construction.
 *
 * Everything here is logical (`px`, `gap`, `start`), so Arabic is the mirror of
 * English with no Arabic-only rule anywhere — the requirement that ruled out the
 * one-off margin in the first place.
 *
 * TWO PRESENTATIONS, ONE COLUMN
 *   expanded — a bare 19px glyph at `px-3` inside a `px-3` column, label beside.
 *   narrow   — a 36px tile centred in a `px-2` column, no label.
 * In both, every icon in the panel shares one centre line, and the collapsed
 * centre line is the same one the expand-on-hover transition animates between,
 * so nothing slides sideways as the panel opens.
 */

/** Horizontal inset of the column that holds the rows. */
export function navColumnClass(narrow: boolean): string {
  return narrow ? "px-2" : "px-3";
}

/**
 * Layout of one row — a nav link, or the mode control that sits below them.
 * `py` differs between the two states because a collapsed row's height comes
 * from its 36px tile, while an expanded row has only a 19px glyph to stand on.
 */
export function navRowClass(narrow: boolean): string {
  return narrow ? "justify-center px-0 py-0.5" : "gap-3 px-3 py-2";
}

/**
 * The icon's own box. Fixed at 36px when collapsed so the lit hover/active tiles
 * form an even column rather than touching; intrinsic when expanded, where the
 * row padding already establishes the column and a tile would only push the
 * labels inward.
 */
export function navIconClass(narrow: boolean): string {
  return narrow
    ? "shrink-0 grid h-9 w-9 place-items-center rounded-sm transition-[background-color,box-shadow] duration-fast ease-standard motion-reduce:transition-none"
    : "shrink-0";
}

/** Glyph size, shared so the column reads as one weight of line. */
export const NAV_ICON_SIZE = 19;
