# Admin View-As — synthetic Acceptance fixture

**Prepared, NOT executed anywhere hosted.** Running it against Acceptance modifies Acceptance data and needs the owner's separate, explicit approval.

Creates exactly: one craftsman, one company owner and one organization (reserved ids `7fa0…`, addresses `…@fixture.invalid`), with realistic View-As content
(2 assignments incl. 1 reviewed, points, a portfolio project with 2 file placeholders, a certificate, a masked secondary phone).

| File | Purpose |
|---|---|
| `01_apply.sql` | Atomic, idempotent create (a second run says "already present"). |
| `02_verify.sql` | Read-only safety checks; fails loudly if a property is violated. |
| `03_cleanup.sql` | **Retires** the fixture (see below). |

## Safety properties (checked by `02_verify.sql`)
- Accounts have no password and no sign-in identity: nobody can sign in as them. Addresses use the reserved `.invalid` TLD.
- No contact row, invitation, OTP, WhatsApp or email is created. The notifications feature has no outbound delivery; the 5 rows it writes are in-app inbox rows for the synthetic users.
- The craftsman is **not** publicly listed; no job is left open; an unrelated signed-in user and anonymous callers cannot read the organization or the craftsman profile.
- Private files are metadata only (keys point at nothing, nothing is uploaded to R2 or Storage). Stage 4 will need real objects: separate approval.
- Refuses to run if `app.environment = 'production'` or the database holds more than 500 users.

## Why cleanup "retires" instead of deleting
The platform makes `points_ledger`, `job_reviews`, `job_progress_updates` and audit events append-only (a trigger forbids DELETE, also via cascade), so an account that owns
them cannot be deleted. Tested locally. The script does not disable triggers: it deletes everything deletable and sets the accounts to `deactivated` and the organization to
`archived`, leaving 2 assignments, 1 review, 2 points rows and audit events, all carrying the reserved ids. A rebuilt Acceptance removes everything. The cleanup only acts on accounts that carry the fixture marker.

## How it would be run (only after approval)
Using the already-authenticated Supabase CLI against the linked Acceptance project (temporary login role, no password in chat):
`supabase db query --linked -f supabase/fixtures/view-as-acceptance/01_apply.sql`, then `02_verify.sql`. The role must be allowed to `SET ROLE authenticated` (checked by the script).
Verified locally on the full combined schema: apply → apply again (no-op) → verify (pass) → retire → verify (pass) → retire again.
