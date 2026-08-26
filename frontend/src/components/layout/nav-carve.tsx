"use client";

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { NAV_COLUMN_START } from "@/lib/ui/nav-geometry";

/**
 * DESIGN-LAB `roundedBand` corner radius, in px — refined rather than the
 * tile's own half-height. See the prop's own note for why this stays a plain
 * number instead of a token reference.
 */
const BAND_RADIUS = 10;

/**
 * The carved active-navigation surface — ONE element, every display mode.
 *
 * WHAT IT IS
 * The selected module is not a pill floating on the sidebar — it is the PAGE
 * arriving into it. One light surface runs from the navigation column out to the
 * shell's trailing edge, where it meets the workspace body, and the shell closes
 * back around it above and below through two concave fillets. The item reads as
 * carved out of the material rather than painted onto it, which is the whole
 * point: a pill says "this row is highlighted", a carve says "this row is the
 * page you are on".
 *
 * ONE MECHANIC, THREE MODES — AND THE PREVIOUS RULE IS REVERSED
 * This used to be the docked-and-expanded treatment only. A collapsed rail got
 * an accent-tinted tile plus a 2px marker bar, and an expand-on-hover reveal got
 * a third thing again — a translucent accent wash — on the reasoning that a
 * floating panel cannot merge into a body 15rem away and behind it.
 *
 * That reasoning is now rejected, and the rejection is the correct one. It
 * produced three different answers to one question, so collapsing the sidebar or
 * hovering it did not narrow the same object — it swapped in a different object
 * that happened to list the same modules. The user reads that immediately, and
 * reads it as two components badly matched rather than as one component in two
 * states.
 *
 * So there is one surface and it MORPHS:
 *
 *   narrow (the rail)     a tile the width of the icon's own box, fully rounded,
 *                         standing clear of the trailing edge. There is nothing
 *                         on the other side of 56px to arrive from, so it does
 *                         not reach for it, and the fillets fade out because
 *                         there is no edge for them to close around. This is
 *                         exactly what the reference rail draws: a light
 *                         circle, dark glyph.
 *   wide (docked or       the band, flush with the shell's trailing edge, pill
 *   revealed on hover)    on the leading side, square on the trailing side where
 *                         the fillets take over.
 *
 * Between the two it is the SAME element travelling and re-proportioning, which
 * is why the collapse reads as one object changing shape rather than as a
 * cross-fade between two designs.
 *
 * WHY IT IS ONE ELEMENT AND NOT A CLASS ON THE ROW
 * The obvious implementation is a background on the active `<Link>`. It cannot
 * work. The fillets live OUTSIDE the row's own box — above its top edge and
 * below its bottom edge — so a row-scoped background has nowhere to draw them,
 * and `overflow` on the row would clip them. More importantly the surface has to
 * MOVE between rows rather than disappear from one and appear on another: a
 * cross-fade between two static backgrounds is the thing this design is
 * specifically not.
 *
 * MEASUREMENT, NOT ARITHMETIC
 * Every number below is read from the live DOM. Rows are uniform today, but the
 * list is grouped under section headings whose presence depends on capability,
 * on stance, and on the translated label's wrapping — an index-times-row-height
 * constant would be correct in English, wrong in Arabic the moment one heading
 * wraps to two lines, and silently wrong again the first time a section is
 * added. The horizontal geometry is measured for the same reason: the rail's
 * tile inset is `(shell width - tile width) / 2`, and both of those are
 * component decisions living in `nav-geometry`, not constants this file is
 * entitled to a copy of.
 *
 * The observers are what keep it honest without a `pathname` dependency: a
 * `MutationObserver` on `data-nav-active` catches navigation (the attribute
 * moves), and a `ResizeObserver` catches the panel changing width — which is now
 * load-bearing rather than defensive, since the hover reveal changes the panel's
 * width continuously and the carve has to re-proportion the whole way.
 */

export function ActiveCarve({
  container,
  narrow = false,
  roundedBand = false,
}: {
  /**
   * The positioned list container — the active row's `offsetParent`, so it must
   * carry `position: relative`.
   *
   * It is the ELEMENT, not a ref object, and that is load-bearing. React attaches
   * refs and runs layout effects bottom-up, so a child's `useLayoutEffect` fires
   * BEFORE its parent's `ref` is populated: reading `containerRef.current` here
   * on mount yields null, the first measurement finds nothing, and — because the
   * effect depends only on the stable ref object — it never re-runs to correct
   * itself. The carve simply never appears. The caller therefore holds the node
   * in state via a callback ref and passes it down, which costs one extra render
   * on mount and makes the null window impossible to reintroduce.
   */
  container: HTMLElement | null;
  /**
   * Whether the shell is currently at rail width.
   *
   * A prop rather than something measured, because it is a STATE the sidebar is
   * in rather than a fact about the DOM: during a hover reveal the panel's
   * measured width is somewhere between the two for a quarter of a second, and
   * a carve that decided its own shape from that number would flip mechanic
   * halfway through the gesture. The sidebar knows which state it is heading
   * for; this follows it there.
   */
  narrow?: boolean;
  /**
   * DESIGN-LAB PROTOTYPE GATE — see `app/b2b/layout.tsx`. One account only.
   *
   * Draws the band as a self-contained rounded chip, inset from BOTH ends of
   * the nav column, instead of the shared shell's band — which runs flush to
   * the shell's trailing edge and squares off there for two concave fillets
   * to close around. That shape reads as one-sided: a surface that touches
   * the material's own edge on one side and floats free on the other, which
   * is exactly the "cut off / asymmetric" complaint. `roundedBand` mirrors
   * the leading inset on the trailing side and rounds both, so the band
   * reads as one calm object regardless of which end it is. Off (default)
   * leaves every other account's carve pixel-identical to before.
   */
  roundedBand?: boolean;
}) {
  const [box, setBox] = useState<{
    /** The active ROW's box — what the band occupies at full width. */
    top: number;
    height: number;
    /** The active row's ICON TILE — what the carve shrinks to on the rail. */
    tileTop: number;
    tileSize: number;
    /** The shell's material width, excluding the gutter the container spans. */
    shellW: number;
  } | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const root = container;
    if (!root) return;

    const measure = () => {
      const el = root.querySelector<HTMLElement>('[data-nav-active="true"]');
      if (!el) {
        setBox(null);
        return;
      }
      // The <nav> holds itself to `--shell-nav-w`, so its width IS the shell's
      // material width — the column the carve is allowed to occupy, excluding
      // the gutter the container also spans.
      const nav = el.closest("nav");
      // The icon's own 36px box. On the rail the carve becomes exactly this,
      // which is what makes the reference's light CIRCLE a circle rather than a
      // rounded rectangle: the row is 40px tall (the tile plus its `py-0.5`), so
      // a carve sized to the ROW would be 36x40 and read as a stadium. Measured
      // rather than assumed for the usual reason — the tile's size is a decision
      // in `nav-geometry`, not a number this file is entitled to a copy of.
      const tile = el.querySelector<HTMLElement>("[data-nav-icon]");
      setBox({
        top: el.offsetTop,
        height: el.offsetHeight,
        // `offsetTop` on the tile is relative to the ROW (the nearest positioned
        // ancestor), so it has to be lifted into the container's frame before it
        // can be compared with the row's own.
        tileTop: el.offsetTop + (tile?.offsetTop ?? 0),
        tileSize: tile?.offsetWidth ?? el.offsetHeight,
        shellW: nav?.offsetWidth ?? root.offsetWidth,
      });
    };

    measure();

    const resize = new ResizeObserver(measure);
    resize.observe(root);

    const mutate = new MutationObserver(measure);
    mutate.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-nav-active"],
    });

    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
  }, [container]);

  // No active module in this list — a legitimate state on a route the rail does
  // not own (a detail page under a module the caller cannot see, say). Drawing
  // nothing is correct; drawing a carve at row zero would claim the wrong page.
  if (!box) return null;

  /* THE TWO SHAPES, AND WHY THE WIDTH IS A `calc()` RATHER THAN A NUMBER.
     ---------------------------------------------------------------------
     The obvious implementation animates `width` from 36 to 232 with the same
     spring the panel uses. It produces a visible defect, and the defect is
     instructive: the band's own spring is chasing `shellW`, which this component
     re-measures from a ResizeObserver as the panel widens — so it is a spring
     following a value that is ITSELF a spring. Two damped systems in series lag,
     and mid-reveal the band trailed the shell's edge by 30-odd pixels with both
     fillets already drawn at its short end. The active surface rendered as a
     light "T" floating inside the material, joined to nothing.

     So the width is not animated here at all. It is a CSS expression over
     `--shell-nav-w` — the variable the PANEL animates — which means it is
     recomputed by the style engine on the same frame the shell's edge moves,
     and cannot lag by construction. `--carve-p` is the one value this component
     animates, and it carries the SHAPE change (tile ↔ band) rather than the
     size: 0 is the tile, 1 is the band, and it runs on the identical spring, so
     the two variables move as one gesture.

     At p=0 the width reduces to the tile's own size independently of the shell,
     which is what keeps the collapse honest — the tile stays a tile the whole
     way down while the material narrows around it, rather than being a band
     that snaps.

       p=0            → tile
       p=1, shell=240 → 10 → 240, flush with the trailing edge
       p=1, shell=56  → the same expression, mid-reveal, with no discontinuity

     `inset` is a CONSTANT and is the leading edge of the icon column in both
     shapes — see NAV_COLUMN_START for why that is worth two pixels of care. It
     is applied logically, so RTL is the mirror with no second rule. */
  const p = narrow ? 0 : 1;
  const tile = box.tileSize;
  // `roundedBand` mirrors `NAV_COLUMN_START` on the trailing side too, so the
  // band stops that far short of the shell's edge instead of reaching it —
  // the inset a fillet-free, rounded-both-ends shape needs to look inset
  // rather than merely narrower.
  const trailingInset = roundedBand ? NAV_COLUMN_START : 0;
  const width = `calc(${tile}px + (var(--shell-nav-w) - ${tile + NAV_COLUMN_START + trailingInset}px) * var(--carve-p))`;
  const top = narrow ? box.tileTop : box.top;
  const height = narrow ? tile : box.height;
  /* THE LEADING RADIUS IS NOT `9999px`, AND THAT IS A CORRECTNESS FIX.
     It was — `rounded-s-pill` — which is a silently wrong way to ask for a pill
     on one side of a box that is also rounded on the other. When the sum of two
     radii along an edge exceeds that edge's length, CSS scales EVERY corner of
     the box by the same factor to make them fit. A 36px-wide tile asking for
     999px + 20px got f = 36/1019, so the 20px trailing radius the rail needs
     came out at 0.7px: a square-ended tile, from a rule that named a round one.
     Half the height is the same pill, expressed as a number that cannot trigger
     the scaling. */
  /* `roundedBand`'s LEADING radius stops being `height / 2` once the band is
     wide: on a full row-height band that is a half-height radius of roughly
     20px, which is precisely the "exaggerated capsule" the brief rules out.
     `BAND_RADIUS` — a fixed, refined value close to `NAV_COLUMN_START` rather
     than derived from the row's own height — is what both ends hold instead.
     It is a plain number, not a `var()`, because this value is fed straight
     into Motion's `animate` below and Motion spring-interpolates a bare
     number; a CSS custom-property reference is exactly the string it cannot
     parse (see the width `calc()` two lines up for the pattern that CAN
     carry one, and why it cannot be used here). The narrow/tile shape is
     unchanged in every mode — a 36px tile's own half-height IS the circle
     the rail wants. */
  const startRadius = roundedBand && !narrow ? BAND_RADIUS : height / 2;
  // Square where the fillets take over, round where they do not — which is the
  // same statement as "the band reaches the edge, the tile does not". Blended
  // through the same `p`, so the trailing end unrolls as the band grows.
  // `roundedBand` never reaches an edge, so it never squares off: the trailing
  // end blends from the tile's own circle (p=0) to the same fixed, refined
  // radius the leading end holds (p=1) instead of to zero.
  const endRadius = roundedBand
    ? `calc(${tile / 2}px * (1 - var(--carve-p)) + ${BAND_RADIUS}px * var(--carve-p))`
    : `calc(${tile / 2}px * (1 - var(--carve-p)))`;

  return (
    /**
     * MOTION, AND WHAT IT REPLACED
     * This was a CSS `transition` on transform plus an `armed` flag and a
     * `requestAnimationFrame` whose entire job was suppressing the entrance
     * animation on first paint — a transition cannot distinguish "arrived" from
     * "moved", so the carve slid down from the top of the panel on every full
     * page load. `initial={false}` states that directly: the first render is a
     * position, every later one is a movement.
     *
     * The spring is the second reason. This element's movement is the whole
     * point of the mechanic — it says "the page you are on moved to here" — and
     * a cubic-bezier arriving dead-flat reads as a slide, where a spring with a
     * little overshoot reads as a physical object settling.
     *
     * `y` is a transform and stays on the compositor. `width` and the two
     * custom properties are not, and they are the price of the morph: they only
     * animate while the shell is actually changing width, which is a deliberate
     * gesture a few times a session rather than something that runs on scroll.
     */
    <motion.span
      aria-hidden="true"
      data-testid="nav-carve"
      data-carve-narrow={narrow ? "true" : undefined}
      className="pointer-events-none absolute z-0"
      style={{
        insetInlineStart: `${NAV_COLUMN_START}px`,
        width,
        // Not in `animate`: these are EXPRESSIONS over `--carve-p`, so they
        // follow the animation without being animated themselves. Putting a
        // `calc()` in `animate` would ask motion to interpolate a string it
        // cannot parse.
        "--carve-end-r": endRadius,
      } as CSSProperties}
      initial={false}
      animate={{
        y: top,
        height,
        // 0 is the tile, 1 is the band. The ONE value this component animates,
        // on the same spring the panel widens with, so shape and size arrive
        // together.
        "--carve-p": p,
        "--carve-start-r": `${startRadius}px`,
        // The fillets exist to close the shell around a band that reaches its
        // edge. At rail width nothing reaches the edge, so they have no corner
        // to fill and would paint two light stubs floating in the material.
        // `roundedBand` never reaches the edge in ANY width, so it is always 0
        // there regardless of `p` — see the fillet spans themselves, which
        // `roundedBand` skips mounting entirely rather than relying on opacity
        // alone to hide them.
        "--carve-fillet-o": roundedBand ? 0 : p,
      }}
      transition={
        reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 520, damping: 42, mass: 1 }
      }
    >
      {/* The surface. Rounded on the LEADING side always; the TRAILING side is
          driven by `--carve-end-r`, which is the tile's own pill radius on the
          rail and zero once the band reaches the edge and the fillets take the
          joint over. */}
      <span
        className="absolute inset-0 bg-shell-active shadow-[0_2px_10px_rgba(0,10,30,0.28)]"
        style={{
          borderStartStartRadius: "var(--carve-start-r)",
          borderEndStartRadius: "var(--carve-start-r)",
          borderStartEndRadius: "var(--carve-end-r)",
          borderEndEndRadius: "var(--carve-end-r)",
        }}
      />

      {/* The two fillets that close the shell back around it. Geometry and the
          RTL mirror live in globals.css, because a radial-gradient whose centre
          has to flip with writing direction is a stylesheet's job, not a
          template's. Skipped entirely for `roundedBand`: that band never
          reaches an edge for them to close around, so they would be two
          zero-opacity nodes doing nothing rather than a shape decision. */}
      {roundedBand ? null : (
        <>
          <span className="nav-carve-fillet nav-carve-fillet--top" />
          <span className="nav-carve-fillet nav-carve-fillet--bottom" />
        </>
      )}
    </motion.span>
  );
}
