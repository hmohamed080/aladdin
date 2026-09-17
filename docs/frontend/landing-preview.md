# Landing preview

## Purpose and current decision

The landing redesign is developed and reviewed only at `/preview/landing`.
The production `/` route stays unchanged. Promotion requires explicit user
approval and a separate implementation step; it is not part of preview work.

## Rationale and scope

The preview begins with a snapshot of the current homepage, preserving its
content and interactions as a baseline for review. It now adds an ecosystem
explanation immediately after the hero: a participant flow, three role/value
cards, and a supplied-logo showcase. Its route lives at
`frontend/src/app/preview/landing/page.tsx`; its presentation, bilingual copy,
and CSS Modules live in `frontend/src/features/landing-preview/`.
Landing artwork is copied into `frontend/public/preview/landing/` so replacing
preview images cannot change the production artwork. The nine supplied partner
images are rendered from those copies with contained sizing and accessible alt
text. The purple reference contributed the information patterns only; its
palette, hero, testimonials, unsupported metrics, and invented video/content
claims were intentionally not adopted.

This deliberate presentation fork is explicitly requested for safe iteration.
Existing design-system primitives, locale infrastructure, and business services
are reused without modification. Future preview work must stay within the
preview directories. If a shared primitive needs a visual change, compose or
style it locally rather than changing the primitive for the experiment.
New data access should reuse existing authorized query/action layers.

## Consequences

The route is publicly reachable but has `noindex, nofollow` metadata; this is
search-index guidance, not access control. No navigation entry, redirect,
middleware change, global stylesheet change, or production homepage import is
needed. CSS Modules scope preview rules; shared tokens remain read-only.

## Deferred review and promotion

This is an isolated starting point, not an approved new visual design. Footer
destinations and locally simulated
newsletter submission, and responsive/theme/accessibility limitations still need
review before promotion. No new factual claims are approved by copying the page.
Do not replace, redirect, or delete `/` until explicitly instructed after review.

## Related files

- [Production homepage](../../frontend/src/app/page.tsx)
- [Preview route](../../frontend/src/app/preview/landing/page.tsx)
- [UI contract](UI_CONTRACT.md)
