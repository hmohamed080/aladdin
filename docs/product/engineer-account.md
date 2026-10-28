# Engineer account

## Profile completion — 2026-10-28

The completion workspace is also the engineer's canonical profile editor.
Engineer `/home/profile/edit` redirects to `/home/profile/complete`; profile edit
links go directly there, with one edit CTA instead of duplicate completion/edit
buttons. Other account editors remain unchanged. The owner pinned the existing
progress/step navigator; only the editing canvas adopts the installer reference's
cream panels, warm outlines, numbered section headings and compact field grids.

The owner requested the installer's full profile-completion experience for the
engineer. `/home/profile/complete` reuses the existing authenticated engineer
shell and four guided sections: identity, expertise/services/work areas,
availability, and portfolio. Only the selected section is visible; moving
between steps retains unsaved inputs. Each existing editor saves independently.
The professional editor saves in place in this workspace. Username editing
continues through account settings. The home banner and workspace both use
`my_profile_completion()`; browsing steps never increases completion or grants
verification. The guarded route reads only the caller's identity and assets,
with short-lived portfolio preview URLs and existing private-by-default uploads.
No new persistence, schema, sample data or deployment is introduced. Full-stack
release verification remains deferred until the visual review is approved.

Owner refinement: engineer discipline is a single choice, architecture or civil.
Services are multiple choice: 2D design, 3D design, finishing, construction,
consultation and general contracting. Software tools (AutoCAD and 3ds Max) are
multiple choice under their own label, using namespaced `tool_*` keys in the
existing supplemental-skills array. Existing stored values are carried through
until edited; there is no destructive migration. Both onboarding and the editor
consume the same option catalog. Validate small refinements with focused checks,
not repeated broad test runs.

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

### RFQ reference redesign — 2026-10-25

The request composer follows the owner's image with a compact architectural
hero, four task benefits and numbered product, location, optional notes and
reference-image sections. A live summary appears on the right in Arabic and
mirrors in English; mobile stacks it after the form. Showroom selection is
populated from real directory results, never illustrative businesses.

A labelled local example supplies four requirements (wood alternative, marble
alternative, flooring and paint) only through the existing local-app plus
loopback-Supabase gate. Existing drafts and real product requirements take
precedence; production starts with empty inputs unless real data supplies them.
The four-colour palette is unchanged.

Saving creates or updates a draft and opens review. Publication remains a
separate explicit action; drafts are not sent. Images use the existing private
saved-item upload flow, accepting JPEG, PNG and WebP, at most two per item and
5 MB per image. PDF attachments and uploading before the first save are not
supported; the new form explains that the draft must be saved first. This work
is frontend review only. TypeScript, focused lint and six composer tests pass; no hosted, deployment or PR change.

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

## Public portfolio refinement — 2026-10-24

Public portfolios use the owner-supplied light/dark reference and tab-specific content rather than anchors. Existing unique usernames form readable account-type URLs. The requested visual sample is explicitly local and labelled; it is never a real portfolio claim. Messaging/quote controls in that sample do not send anything and remain pending an actual profile-directed workflow. Public records retain their existing eligibility and field restrictions.
