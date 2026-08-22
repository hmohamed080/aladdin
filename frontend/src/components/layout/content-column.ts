/**
 * THE CONTENT COLUMN — one geometry for every authenticated product surface.
 *
 * The B2B workspace, the personal `/home` workspace and the Admin console each
 * had their own hardcoded `max-w-[…]` on `<main>` (1200 / 1120 / 1200). Three
 * literals, three files, no shared reason — the same drift the shared header was
 * built to end, one layer down.
 *
 * WHAT WAS WRONG WITH THE OLD WIDTHS
 * They were fixed pixel caps chosen for a ~1440px laptop, and they did not grow.
 * On a 2560px display the B2B workspace put a 1200px column inside ~2300px of
 * available space: roughly 550px of dead margin on EACH side, while the tables
 * and dashboards inside that column were the densest content in the product and
 * the ones that most wanted the room. The wider the display, the more of it the
 * product refused to use.
 *
 * WHAT THIS IS INSTEAD
 * Fluid between the sidebar and the viewport edge, with padding that opens up as
 * the display does (16 → 24 → 32px), and a cap that only engages on genuinely
 * extreme widths. At 1440 and 1920 the column is fully fluid; the 1920px cap
 * exists so that an ultrawide does not stretch a table row into something the eye
 * cannot track from key column to value. Readability sets the ceiling — it just
 * sets it where readability actually breaks, not at a laptop's width.
 *
 * WHAT THIS IS NOT
 * It is not a licence to stretch every page to 1920. Prose and FORMS still need a
 * measure, and they bound themselves at the page level (`readableColumnClass`, or
 * their own `max-w-*`) INSIDE this column. The shell's job is to stop wasting the
 * viewport; deciding that a two-field form should not be 1900px wide is the
 * page's job, and pages already do it.
 *
 * `min-w-0` is load-bearing: it lets a flex child shrink below its content's
 * intrinsic width, so a wide table scrolls inside its own container (see
 * `data-table`) instead of forcing the page to scroll sideways.
 */
export const contentColumnClass =
  "mx-auto w-full min-w-0 max-w-[1920px] flex-1 px-md desktop:px-lg wide:px-xl";

/**
 * The measure for text a person actually READS — long-form copy, policy and
 * explanation, and single-column forms.
 *
 * Nested INSIDE `contentColumnClass`, never used in place of it: the shell stays
 * fluid so the page's own chrome (headings, rails, tables) can use the display,
 * and only the part that is genuinely line-length-bound is narrowed.
 */
export const readableColumnClass = "w-full max-w-3xl";
