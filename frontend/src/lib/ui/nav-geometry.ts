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
 * ONE TILE, ONE COLUMN, EVERY MODE
 * The icon box used to be presentation-dependent: a 36px tile when collapsed, a
 * bare 19px glyph when expanded. That made the lit hover/focus tile a
 * COLLAPSED-ONLY affordance, so the same rail answered a pointer two different
 * ways depending on its width — and in expand-on-hover it answered both ways
 * within one gesture, since the panel flips from narrow to wide under the cursor
 * that is still resting on the icon. The tile is now the icon's box in all three
 * modes, which is what lets `workspace-nav` and `sidebar-shell` apply the SAME
 * hover/focus classes unconditionally instead of re-deriving a second hover
 * style for wide panels.
 */

/**
 * How one navigation GROUP is separated from the one above it, where there is no
 * heading between them.
 *
 * The expanded workspace rail separates its groups with a section heading, which
 * supplies its own vertical rhythm. Two lists have no heading to lean on — the
 * COLLAPSED rail, where 3.5rem leaves no room for a word, and the personal
 * navigation, whose three-to-five destinations would spend more height on a
 * heading than on the group it introduces. Both draw a rule instead, and this is
 * that rule, defined once.
 *
 * It lives here rather than in either list because the two were drifting the
 * moment there were two: the rail wrote `mt-sm … pt-sm` on the group's own
 * wrapper, the personal list wrote `mx-3 my-1.5` on a bare `<div>` — a
 * DIFFERENT inset, a DIFFERENT rhythm and a rule that stopped short of the
 * column on both sides, for the same structural statement. A shared string is
 * what makes "the navigation language may not vary" true by construction rather
 * than by review.
 */
export const NAV_GROUP_SEPARATOR_CLASS = "mt-sm border-t border-shell-line pt-sm";

/** Horizontal inset of the column that holds the rows. */
export function navColumnClass(narrow: boolean): string {
  return narrow ? "px-2" : "px-3";
}

/**
 * Layout of one row — a nav link, or the mode control that sits below them.
 *
 * `py` is now the same in both states, because the row's height comes from the
 * same 36px tile in both. It used to differ (`py-2` when expanded) only because
 * an expanded row had a 19px glyph to stand on and needed padding to reach a
 * comfortable height; that padding on top of a tile would make a 52px row, and
 * — worse — expand-on-hover would jolt the whole list vertically as it opened,
 * since every row would change height mid-reveal.
 *
 * The expanded `gap` is deliberately tight: the tile already carries ~8.5px of
 * its own padding beside the glyph, so the OPTICAL distance from glyph to label
 * is the tile padding plus the gap. `gap-1` keeps that optical distance where
 * `gap-3` put it back when the glyph had no box of its own.
 */
export function navRowClass(narrow: boolean): string {
  return narrow ? "justify-center px-0 py-0.5" : "gap-1 px-3 py-0.5";
}

/**
 * The icon's own box: a 36px tile that hover/focus can light.
 *
 * Fixed size and mode-independent, so the lit tiles form an even column rather
 * than touching, the collapsed and expanded centre lines animate between each
 * other without the glyph resizing mid-transition, and one hover rule serves
 * every mode.
 */
export function navIconClass(): string {
  return "shrink-0 grid h-9 w-9 place-items-center rounded-sm transition-[background-color,box-shadow] duration-fast ease-standard motion-reduce:transition-none";
}

/**
 * The hover/focus paint for an icon tile — ONE appearance, two triggers.
 *
 * The paint itself (`bg-surface-2` + `shadow-sm`, and `bg-surface-2` alone for
 * keyboard focus) is written for the COLLAPSED rail, where the row is 40px of
 * icon and the tile is effectively the row. Both constants below are that same
 * paint; they differ only in WHAT ARMS IT, and the difference is not cosmetic:
 *
 *   ROW-DRIVEN (`NAV_ICON_HOVER_CLASS`) — for a collapsed nav link, where the
 *   pointer is over the row and the row is the tile. Driven by the row's
 *   `group`, so the whole 40px target lights as one thing.
 *
 *   SELF-SCOPED (`NAV_ICON_SELF_HOVER_CLASS`) — for the display-mode control at
 *   the foot of the panel, in EVERY mode. That button is `w-full` so its CLICK
 *   target matches a nav row, but it has no label: row-driven, its tile lit from
 *   anywhere in the footer, including 200px of empty space beside it, which
 *   reads as the bottom of the sidebar glowing at a pointer nowhere near the
 *   icon. Here the pointer must be over the 36px tile itself.
 *
 * NEITHER is used on a WIDE nav row. An expanded (or revealed) navigation item
 * highlights as a ROW — one subtle surface behind icon AND label, the shape the
 * design references show — and painting a tile inside that highlight would draw
 * a second, smaller box around the icon and split one target into two.
 *
 * `group-focus-visible:` stays in BOTH. The tile is a span and spans are not
 * focusable, so its own `focus-visible:` could never match; the `group` it reads
 * is the single focusable control that owns the tile, so this is still that
 * control's own focus and not an area-wide trigger. Dropping it would silently
 * cost keyboard users the cue that a mouse user keeps.
 */
export const NAV_ICON_HOVER_CLASS =
  "group-hover:bg-surface-2 group-hover:shadow-sm group-focus-visible:bg-surface-2";

/** The same paint, armed only by the pointer being over the tile itself. */
export const NAV_ICON_SELF_HOVER_CLASS =
  "hover:bg-surface-2 hover:shadow-sm group-focus-visible:bg-surface-2";

/** Glyph size, shared so the column reads as one weight of line. */
export const NAV_ICON_SIZE = 19;

/**
 * Where the icon column STARTS, in px, measured from the shell's leading edge.
 *
 * DERIVED, NOT CHOSEN. At rail width the shell is `SIDEBAR_WIDTH.rail` (3.5rem
 * = 56px), `navColumnClass(true)` insets it by `px-2` (8px each side) leaving a
 * 40px track, and `navRowClass(true)` centres the 36px tile in that track — so
 * the tile's leading edge lands at 8 + (40 - 36) / 2 = 10.
 *
 * It is exported because the CARVE needs it and must not re-derive it. The carve
 * is one element that becomes the icon's tile at rail width and a full-width
 * band when the shell opens, and its leading edge is the one thing that should
 * not move between those two shapes: a band starting 8px in while the tile it
 * grew out of started at 10px is a 2px slide of the whole active surface every
 * time the sidebar opens, which is small enough to look like a bug rather than
 * an effect. Both shapes therefore start HERE, and the number lives in the
 * module that owns the padding it comes from.
 */
export const NAV_COLUMN_START = 10;
