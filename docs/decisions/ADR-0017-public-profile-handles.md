# ADR-0017 — Public profile URLs use account type and username

Status: Accepted for implementation; hosted rollout remains subject to review.
Date: 2026-10-24

## Decision

Use `/p/{persona}/{username}` for every already-supported, listed personal
professional profile with an existing username. Use the normalized, unique
username, not a slug manufactured from a non-unique display name. Legacy UUID
links temporarily redirect after a successful public lookup; missing handles
retain the existing route until the owner chooses a username. Mixed-case handles
redirect to their lowercase canonical path.

The additive `profile_public_routes` view exposes only profile ID, canonical
persona and normalized username. Its security-invoker view calls a constrained
internal definer reader, matching the established public-directory pattern.
The reader starts from `app._profile_public_directory()` before joining the
username, so listed, active, non-deleted professional eligibility remains one
shared rule. No public identity is inferred from private profile rows.

Missing, unpublished, deleted, inactive and wrong-persona paths return the same
not-found result. The resolved profile is checked again by the existing public
page reader. Portfolio bytes still use the publication-checked, no-store media
endpoint. A readable URL improves sharing; it is not an authorization mechanism.

## Scope and consequences

No new audience is made public: consumer and business-only profiles remain
outside the existing personal professional publication model. No service-role
credential, phone, email, address, drafts or verification evidence is exposed.
Changing a username invalidates its previous named link; the original UUID link
continues resolving to the current name. No alias-history table is introduced.

Migration `20261024100000` has been applied only to the isolated local engineer
database. Thirteen rollback-based database assertions cover anonymous reads,
the exact column list, account-type matching, hidden/suspended/deleted profiles,
missing handles and read-only grants. Hosted migration application is deferred.
