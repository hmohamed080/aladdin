# ADR-0010 — Organization Activity Log Projection

**Status:** Accepted · 2026-09-09 · **Refines [ADR-0007](ADR-0007-identity-and-tenancy-model.md)**

## Purpose

Define the organization-readable business activity feed without weakening the
platform-administrator security audit trail.

## Context

`public.audit_log` is an append-only security record. Its payloads and platform
events are intentionally visible only to platform administrators, so granting
organization members access to a filtered view of that table would couple a
user-facing product surface to security-internal data and make every future
audit action a potential tenant disclosure.

Organizations nevertheless need a concise record of their own business actions.
That record must be tenant-scoped, capability-gated, append-only, and safe to
render without exposing raw audit metadata.

## Current decision

- `public.organization_activity_events` is a separate, append-only projection.
  It stores only organization-scoped actions from a closed allow-list and only
  explicitly projected, bounded JSON scalar parameters.
- `app.record_audit_event(...)` remains the single business-event writer. In the
  same transaction, after writing the security audit row, it projects eligible
  actions into the activity table. Projection failures propagate so the audit,
  activity row, and business transition cannot disagree.
- `app.activity_event_params(...)` is default-deny: every retained parameter is
  named explicitly per action; unknown actions return an empty object. Raw IDs,
  notes, reasons, comments, secrets, tokens, and private metadata are excluded.
- Organization members may select rows only when they hold `activity.read` for
  that organization, or `org.manage`, which is the existing blanket in-org
  authority. RLS remains the enforcement layer. No client role receives insert,
  update, or delete authority.
- `activity.read` is founder-granted, backfilled to existing owners who already
  hold `org.manage`, and may be delegated only through the existing
  `membership_set_capabilities` no-escalation path.

## Rationale

A separate projection makes the public contract narrow by construction. The
security audit can continue to evolve for incident response and compliance
without silently enlarging what organization members can read. Projecting at
the one audit writer keeps the business transition, audit row, and activity row
atomic and avoids duplicating activity wiring across every workflow RPC.

## Scope

Organization activity storage, projection, read authorization, capability
delegation, and the `/b2b/activity` read surface with URL-driven family/date
filters and opaque keyset pagination.

## What is deferred

- Jobs activity; the Jobs domain receives its own projection review later.
- Membership lifecycle activity; ticket #56 will decide its surface and
  authority separately from the general `activity.read` feed.
- Realtime delivery, export, configurable retention, and activity search.
- Rich actor profiles. The first surface distinguishes the current member,
  another person, and system activity without claiming that a non-self actor
  belongs to the organization or widening profile visibility.

## Consequences

- `public.audit_log` remains unchanged and platform-administrator-only.
- Adding an organization-visible event requires updating both the table CHECK
  and the explicit parameter projection in a migration.
- The activity table deliberately duplicates a safe subset of audit facts in
  exchange for an enforceable disclosure boundary.

## Related files

[`../architecture/ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md) ·
`supabase/migrations/20260917090001_organization_activity_log.sql` ·
`frontend/src/app/b2b/activity/page.tsx`
