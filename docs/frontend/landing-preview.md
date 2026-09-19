# Landing preview

## Purpose and current decision

The landing redesign is developed and reviewed only at `/preview/landing`.
The production `/` route stays unchanged. Promotion requires explicit user
approval and a separate implementation step; it is not part of preview work.

## Rationale and scope

### Approved header refinement — 2026-09-19

The user approved a continuous cream header with the existing logo, expanded
navigation and account actions optically centered on one desktop row. Keep the
existing hero artwork, headline, CTA and qualitative proof unchanged; do not add
a hero video or marketing claims. Narrow screens use an explicit navigation
disclosure. Home/about/features/partners/videos map to existing preview sections;
FAQ uses a local disclosure with current account facts, and contact uses support.
The header is preview-local and does not modify the production navigation.

### Visual fidelity contract — 2026-09-17

The supplied cropped reference beginning “كيف يعمل Aladdin؟” is now the
composition authority for the entire post-hero block, superseding the earlier
inspiration-only treatment. Preserve six process positions, five role cards,
five video slots, one logo row, three testimonial slots with pagination markers,
one wide device CTA, and the compact four-column footer in that order. Reuse
Aladdin fonts, navy/gold/cream palette, icons, terminology, and real logo assets.
The existing preview hero remains; the old audience/products/value bands are
unmounted from this preview to avoid duplication. Production `/` is unchanged.

Desktop proportions are measured against the 614 × 675 supplied reference;
tablet/mobile reflow the same content. Missing video media, titles, durations,
testimonial quotes, author names, roles, and portraits retain explicitly labelled
slots. Play controls and pagination markers are non-interactive until backed by
approved content. Supplied logos do not establish a partnership claim.

The preview retains its isolated hero and now reproduces the full post-hero
reference sequence. Its route lives at
`frontend/src/app/preview/landing/page.tsx`; its presentation, bilingual copy,
and CSS Modules live in `frontend/src/features/landing-preview/`.
Landing artwork is copied into `frontend/public/preview/landing/` so replacing
preview images cannot change the production artwork. The nine supplied partner
images are rendered from those copies with contained sizing, local cropping of
empty canvas margins, and accessible alt text. Their aspect ratios are preserved.
The screenshot governs layout; current branding and verified content govern
appearance and copy. Unsupported metrics and invented video/testimonial claims
are not adopted.

This deliberate presentation fork is explicitly requested for safe iteration.
Existing design-system primitives, locale infrastructure, and business services
are reused without modification. Future preview work must stay within the
preview directories. If a shared primitive needs a visual change, compose or
style it locally rather than changing the primitive for the experiment.
New data access should reuse existing authorized query/action layers.

## Consequences

The preview hero, body and footer share a route-local 2560px wide-screen boundary,
with 24px inner content gutters. This uses ordinary desktop space without the
previous narrow centered column, while preventing unlimited hero growth during
zoom-out. The process flow always reads visually left-to-right from end consumers
to manufacturers in both locales; its text retains the selected locale direction.

The route is publicly reachable but has `noindex, nofollow` metadata; this is
search-index guidance, not access control. No navigation entry, redirect,
middleware change, global stylesheet change, or production homepage import is
needed. CSS Modules scope preview rules; shared tokens remain read-only.

## Deferred review and promotion

### Motion review — 2026-09-19

The supplied Pinterest video is a motion reference only: masked headline entrances,
staggered cards on first intersection, and restrained hover feedback. The isolated
`LandingMotion` wrapper uses browser animation/observer APIs without dependencies.
Content remains visible without JavaScript or animation support. Reduced-motion
preferences cancel active effects and disable subsequent entrances. Desktop keeps
the established composition; below 768px the hero reflows to readable text and
touch controls rather than scaling the entire desktop canvas into tiny text.
Current branding, role order, and honest unpublished-content slots remain intact.
Verified in Edge at 1440px and 390px in Arabic/English, with no horizontal overflow
or runtime errors. Scroll revealed five card animations; reduced-motion revealed zero.

This remains a review preview, not an approved production design. The footer uses
existing authentication, support, privacy, and terms routes; simulated newsletter
submission and generic social destinations are no longer mounted. Five approved
videos (media, thumbnails, titles, descriptions, durations) and three approved
testimonials (quotes, names, roles, portraits) are still needed. Existing product
artwork fills the CTA visual slot. The inherited hero is outside this block's
fidelity pass. Final visual/content approval remains with the user.
Do not replace, redirect, or delete `/` until explicitly instructed after review.

## Related files

- [Production homepage](../../frontend/src/app/page.tsx)
- [Preview route](../../frontend/src/app/preview/landing/page.tsx)
- [UI contract](UI_CONTRACT.md)
