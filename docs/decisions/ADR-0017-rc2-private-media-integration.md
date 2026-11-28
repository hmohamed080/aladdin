# ADR-0017 — RC2 private-media provider integration

**Status:** Accepted for local implementation — 2026-10-17; explicit product-owner authorization. Hosted changes and rollout require separate approval.

## Purpose and current decision

Integrate the verified R2 work with RC2 commit8bde19c4a3dea9bfd97c18c41bc20f405467ec6e and its163 applied migrations. Preserve that baseline byte-for-byte; introduce new forward-only migrations. Preserve the original R2 worktree and do not import its backdated migration history.

Supabase remains identity, tenancy, lifecycle and file-metadata authority. Reuse the existing provider/receipt/private-delivery design for avatar, portfolio and certificates. Extend it to RC2 product images and organization logos. Both categories remain private, including published products: catalog membership, current workspace audience, offer eligibility and organization governance continue to authorize each request.

## Rationale and scope

The old function-grant correction references removed RC2 functions. Review current exact signatures and explicit/effective permissions, including PUBLIC, instead of suppressing missing-function errors or automatically approving unknown signatures. Freeze the163-migration baseline and require an explicit reviewed function contract after each forward migration, atomically before commit.

Use existing product/logo metadata, slots, current-image pointers and caller-scoped RPCs. Trusted backend verification validates actual size/content/hash and records a provider-bound receipt before pending-to-ready changes. Organization ownership and current capability checks govern upload/finalization/deletion; receipt issuance alone never grants the caller a capability. Reservation accounting serializes per organization as well as per user. Private reads use application routes with current authorization and no-store responses, for both providers. No browser receives a durable private provider read URL. Product read URLs carry the selected workspace explicitly rather than relying on mutable session-global image grants.

## Deferred and consequences

No public product CDN, paid resource, hosted migration, fixture cleanup, deployment, push or merge. Both R2 flags defaultfalse. Historical bearer/CDN responses cannot be recalled by changing application routes; the separately tracked transition risk remains a rollout gate. Purchase-request/chat media retain their existing independent authority and are not silently included in this migration.

RC2 UI, account flows, image ordering, replacement and legacy media remain compatible. Rollback disables new routing while retaining provider-aware reads and verified receipt finalization; it never drops mappings or fabricates Supabase sources. Migration tooling stays dry-run by default and retains source objects.

Related: [architecture](../architecture/ARCHITECTURE_GUIDE.md), [migration strategy](../database/migration-strategy.md), [professional media](../database/professional-asset-storage.md).
