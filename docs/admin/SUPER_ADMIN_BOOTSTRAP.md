# Super Admin Bootstrap — Deployment Gate

**Status:** Required one-time step for every environment that runs migration `20260929100001_admin_rbac_foundation.sql` · **Owner:** Admin Core / Operations · **Related:** [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md), [`ADMIN_RBAC_ARCHITECTURE.md`](ADMIN_RBAC_ARCHITECTURE.md) §5

## Purpose

Create the **first** Super Admin of an environment, deliberately and exactly once. Only a Super Admin holds `roles.manage`, and only Super Admins can manage other Super Admins, so until this step is done **Roles management is not operational** (Administrators can still manage staff below rank 80).

## Current decision

- **There is no automatic Super Admin.** No migration, seed, trigger, sign-up flow or "first admin becomes Super Admin" rule exists anywhere. After migrating, an environment has **zero** Super Admins. Legacy `platform_role_grants` cannot create one either: its `platform_role` enum has no Super Admin tier.
- **The only path** is `app.admin_bootstrap_super_admin(p_user_id uuid)`, which:
  - is executable **only by the database owner** (no grant to `anon`, `authenticated` or `service_role`, and those roles also lack usage on schema `app`);
  - refuses unless the target is an existing user with `status = 'active'` (`22023`);
  - refuses once **any** active Super Admin exists (`42501`), so it is one-time by construction; afterwards Super Admins are managed only through the audited Admin Staff workflow by another Super Admin;
  - writes an `admin_role.assigned` audit row with `source = dba_bootstrap` (actor = null, the database owner).
- **No personal email or user id is embedded in any migration.** The target is chosen at run time.

## Who may run it

An authorized maintainer with **database-owner** access to the target environment, through the reviewed operational channel, with the choice of target account recorded in the change record (who, which account, why). Never application code, never a service-role client, never an end user. **Production requires the Product Owner's explicit written choice of the account** and a second person reviewing the target check below before the call.

## Procedure (run once per environment)

0. **If the chosen account is still `pending_verification`** (the canonical registration flow never activates anyone — [BL-033](ADMIN_IMPLEMENTATION_BACKLOG.md)) and is meant to be a **dedicated platform account** (no persona, no organization), prepare it first with `app.admin_prepare_platform_account()` — never by editing `users.status` — following [`PLATFORM_ADMIN_ACCOUNT_PREPARATION.md`](PLATFORM_ADMIN_ACCOUNT_PREPARATION.md). The bootstrap function below is unchanged and still requires an `active` account.
1. **Choose the account explicitly.** The person must already have a normal, verified, `active` Aladdin account (created through the product sign-up). Pick them by their verified contact, never by guessing:
   ```sql
   select u.id, p.display_name, u.status, c.value as verified_email
   from public.users u
   join public.profiles p on p.user_id = u.id
   join public.contacts c on c.user_id = u.id and c.channel = 'email' and c.is_verified
   where lower(c.value) = lower('<the chosen person''s email>');
   ```
   Exactly one row must come back with `status = active`. Record the `id`.

   > **Known gap (found 2026-10-01 in Production):** this query depends on `public.contacts`, which only the legacy passwordless flow filled (27 of 189 users). Accounts created through the canonical email + password sign-up have **no** `contacts` row, so the query returns nothing for them. For those accounts identify the target by the single **confirmed** `auth.users.email` instead (`select id, email_confirmed_at from auth.users where lower(email) = lower('<email>')` must return exactly one confirmed row, and `public.users.status` must be `active`), and have the second person confirm the id before the call.
2. **Confirm no Super Admin exists yet** (must return `0`):
   ```sql
   select count(*) from public.admin_role_assignments a
   join public.admin_roles r on r.id = a.role_id
   where r.key = 'super_admin' and a.is_active;
   ```
3. **Bootstrap** (as the database owner):
   ```sql
   select app.admin_bootstrap_super_admin('<the recorded user id>');
   ```
4. **Verify the assignment and its audit row:**
   ```sql
   select p.display_name, r.key, a.scope_type, a.is_active, a.created_at
   from public.admin_role_assignments a
   join public.admin_roles r on r.id = a.role_id
   join public.profiles p on p.user_id = a.user_id
   where r.key = 'super_admin' and a.is_active;          -- exactly 1 row: the chosen person, platform, true

   select action, metadata->>'source', metadata->>'target_user_id', created_at
   from public.audit_log
   where action = 'admin_role.assigned' and metadata->>'source' = 'dba_bootstrap';   -- 1 row
   ```
5. **Verify at least one active Super Admin exists** (step 2's query now returns `1`), and that the person can operate Roles: sign in as them, open **Admin → Preview → Admin Staff → Roles** — **Create role** and **Edit role** must be present.
6. **Recommended:** have the new Super Admin promote a **second** trusted staff member to Super Admin through Admin Staff (Change role), so the platform never depends on one account. The last active Super Admin can never be removed or disabled (trigger-enforced for every writer).

## Deployment gate (staging and production)

A deployment carrying this migration is **not complete** — and Roles management must not be announced as available — until:

- [ ] steps 1–5 were performed and recorded (environment, operator, reviewer, chosen account, timestamp);
- [ ] step 2's query returns `≥ 1`;
- [ ] the bootstrapped person has signed in and seen **Create role**.

Until then, Admin Staff management below rank 80 by existing Administrators works normally; only role management is unavailable.

## Rationale

Automatic promotion ("first admin wins", or promoting the seeded Platform Admin) would hand the highest authority to whichever account happened to exist first, with no human decision and no record of one. A DB-owner-only, one-time, audited call makes the choice explicit and attributable, and cannot be reached from the application.

## Verification record

- **pgTAP** (`supabase/tests/66_admin_rbac_foundation_test.sql`, §F and §I): DBA bootstrap of the first Super Admin · refused for a non-active target · refused for `service_role` · the legacy bridge cannot mint a Super Admin · refused once a Super Admin exists · not client-callable (`authenticated`) · the last Super Admin cannot be deactivated, deleted or demoted · a Super Admin cannot disable themselves.
- **Isolated `aladdin_rbac` run (2026-09-30)**, fresh from zero: 0 Super Admins → six improper attempts refused (client `authenticated`, `service_role`, `anon`, non-active target, unknown id, legacy bridge) with 0 Super Admins after → Platform Admin bootstrapped explicitly → 1 active platform `super_admin` assignment + `dba_bootstrap` audit row → `roles.manage` false → true and `admin_role_create` refused → succeeded → a second bootstrap refused → deactivate / delete / self-disable of the only Super Admin all refused.
- **Never run against staging or production by an agent.**

## What is deferred

Nothing in this procedure. Onboarding a person with **no** Aladdin account as staff is the separate Invitation sub-phase.

## Related files

`supabase/migrations/20260929100001_admin_rbac_foundation.sql` (`app.admin_bootstrap_super_admin`, `app.admin_last_super_admin_guard`) · `supabase/tests/66_admin_rbac_foundation_test.sql`
