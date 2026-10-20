# Engineer account

## Purpose and current decision

The owner requested a production engineer account on a new branch on 2026-10-19,
using the four supplied Arabic screen references and the palette `#D8C7A6`,
`#B96F52`, `#F2E9D8`, `#071A2D`. Build into the existing application; no preview
routes, fabricated customer records, or deployment before PR review.

## Scope

### Review sequence (owner decision, 2026-10-20)

The owner subsequently released earlier composition constraints except the
four-colour palette and requested populated local data. Engineer-scoped CSS may
therefore adjust shell placement, gutters, density and card geometry to match
the supplied reference. Local illustrative cards/photos are explicitly marked
and rendered only when both app environment is local and Supabase is loopback.
They are presentation fixtures, not real businesses, ratings, saved records or
project records; their favorite toggles are session-local. Hosted data behavior
and production routes remain unchanged. Shared shell bottom padding is reduced
only inside the engineer theme, retaining ordinary viewport fill.

Homepage revision requested on 2026-10-20: place a compact, segmented profile
completion banner above the architectural hero (Wellfound placement reference),
embed the real account card in the hero, and use five discovery shortcuts.
Remove the homepage product grid and editorial guidance; their separate
destinations remain available. Reuse the showroom topbar with personal search
and account destinations. Decorative generated imagery must not impersonate
real showroom or portfolio records.

Finish and review the frontend suite first; full-stack integration and release
verification are paused. Keep the real application routes and the existing
feature branch. The local app at port 3350 remains available for visual review.
Existing database work is preserved, but it is not a production readiness claim.
Resume the full-stack phase after frontend review.

- Engineer-specific composition of `/home`, retaining canonical identity and shell.
- Profile overview and existing profile/portfolio editors; true verification,
  completeness, reviews and projects, with honest empty states.
- Personal quotation requests using `purchase_requests`, including editable
  items, draft recovery, publication, reference images and response comparison.
- Showroom, product and professional discovery using public directory projections
  and the personal-audience catalog RPC. Never read private business records.
- Personal saved records and personally managed collaboration teams. A saved
  professional or team roster entry does not grant membership or permissions.
- Editorial guidance is original static content; no invented articles or metrics.

## Rationale and boundaries

The engineer is a personal persona and must not need an organization to request
materials. Reuse caller-JWT purchase request RPCs, private media delivery,
professional profile editing, reviews and messaging. Existing business RFQs stay
unchanged. Shared components keep their semantics; the owner-specified palette
is a named semantic theme, not raw color literals in feature components.

## Acceptance

Arabic RTL and English LTR, both themes, keyboard and mobile support; server
authorization on every route and mutation; no cross-user bookmark/team access;
no false submission success; validated quantities and file limits; request
revisions preserve identity and optimistic versions. Typecheck, lint, focused
unit/component tests and database isolation checks precede readiness claims.

## Deferred and consequences

No checkout, payments, automatic binding order, or changes to verification
authority. Recommendations mean discoverable entries, not an unimplemented AI
ranking. Production application of migrations and deployment follow review.

## Related files

- [Product direction](PRODUCT_DIRECTION_GUIDE.md)
- [Architecture](../architecture/ARCHITECTURE_GUIDE.md)
- [UI contract](../frontend/UI_CONTRACT.md)
