# Registration data: saved, linked, editable, visible to Admin

Scope: what a person enters at `/showroom/sign-up` and `/installer/sign-up`, where each value is stored, where the
owner sees and edits it afterwards, and where Admin reads it. Migration `20261020090001_registration_data_sync.sql`,
pgTAP `87_registration_data_sync_test.sql`.

## Showroom

| Registration field | Stored in | Owner sees / edits it in Showroom Settings | Admin reads it in |
| --- | --- | --- | --- |
| Business name | `organizations.name` (+ `name_ar` / `name_en`) | Business profile — edit dialog; a verified/active business changes it only through the review request | Organization header |
| Legal / registered name | `organizations.legal_name` (private) | Business profile — **editable until the identity is verified**, then read-only (`organization_legal_name_set`) | Organization → Overview → Registration details |
| Description (≤ 250) | `organizations.description` | Business profile — editable (`organization_description_set`) | Registration details |
| Business phone, business e-mail | `organizations.contact_phone` / `contact_email`, mirrored in `organization_contacts` | **Business contact** card — editable; the phone stays mandatory for a showroom | Overview (phone, e-mail) |
| Business activity | `organization_activities` | Business activities section (`organization_activities_set`) | Registration details |
| Governorate, city / typed city | `branches.governorate_key`, `city_key`, `city_custom_name` (primary branch) | Branches — location line + **Edit location** (`branch_location_set`) | Registration details |
| Detailed address | `branches.address_ar` (primary branch) | Branches — edit dialog (`branch_update_i18n`) | Registration details |
| Primary branch name | `branches.name` | Branches — edit dialog | Branches tab |
| Account type = Showroom | `onboarding_progress.selected_org_type`, then the organization's `org_type` | Business profile (type, read-only) | User → Type; Organization header |

The registration review step now lists every one of these before submit.

### One business contact, not two
Registration wrote `organizations.contact_*`; the owner-editable contact form (`organization_contact_set`, with the
WhatsApp number and the per-field visibility switches) wrote only `organization_contacts`. The two never met, so an
edit never reached Admin and the editor opened empty. Now:

- `organizations.contact_phone` / `contact_email` stay the value Admin and `app.showroom_profile_complete` read;
- `organization_contact_set` updates them in the same transaction (and still validates the numbering plan through the
  existing trigger);
- registration seeds `organization_contacts` (everything hidden by default);
- existing rows are reconciled in both directions by the migration.

## Installer

Sign-up (phone or e-mail) records consent, the **declared persona** `installer_technician`
(`individual_onboarding.prof_concrete_type`), the name and the canonical phone (`profiles.phone_e164`).
`users.primary_account_type` is deliberately left untouched until an upgrade is approved, and
`app.effective_persona` / `account_entry_allowed` read the declared persona. Admin's `admin_users_list` and
`admin_user_detail` read only `primary_account_type`, so a new Installer appeared with **no type** and the
Installer filter never found them. Both now use `app.effective_persona`, and add `registered_account`
(persona, else the business type chosen at sign-up, else the type of the business the person belongs to) so a
Showroom owner who has not finished the business step is still identifiable.

### Installer name, phone and header (browser-verified)
- **Name** — Settings → Identity → display name (`profile_set_display_name`); Admin lists the new name at once.
- **Phone, e-mail accounts** — plain `profile_set_phone`.
- **Phone, phone + password accounts** — the phone is also the sign-in key (an internal alias, `p<digits>@craftsman-login.aladdin.invalid`)
  and the database refuses to move a profile phone away from it. Settings now asks for the **current password** and runs a
  re-key (`changeLoginPhoneAction`): throttle like a sign-in → verify password with a stateless client → refuse a number another
  profile holds → move the alias (Auth admin API) → `profile_set_phone` → on failure put the old alias back. The old number
  stops signing in, the new one starts, and Admin shows the new number. Ownership of the new number is not proven by an OTP
  (none exists, as at sign-up).
- **Header service area** — the topbar chip ("Cairo، Giza") is drawn by the `/home` **layout**, which `revalidatePath("/home")`
  does not refresh. Service-area, profile-editor and identity saves now call `revalidatePath("/home", "layout")`, so the header
  follows every change without a reload. Installer sign-up does not ask for an area, so a brand-new Installer correctly shows
  "Service area not set" (now a link to the editor) until one is chosen.

## Admin read access
Admin reads the registration details under the platform RLS policies it already has on `organizations` and
`branches`; `organization_activities` gained `organization_activities_select_platform` (`organizations.read`).

## Admin directory
`admin_organizations_list` now returns `contact_phone` and the primary branch's governorate / city, so the Organizations table
shows the Phone and City columns instead of "unavailable".

## Verified in a real browser (local stack, 2026-10-20)
Installer phone sign-up → name edit → phone change (wrong password refused, right one accepted) → old number rejected / new
number signs in → Admin lists the new name and phone, Installer filter finds them. Installer e-mail sign-up (OTP) → linked as
Installer, plain phone save. Showroom sign-up → business wizard → Settings shows every field → legal name, contact, WhatsApp,
branch location edits → Admin organization page and list show the edits. An Installer is redirected away from `/admin/*`,
`/showroom/settings` and `/b2b/settings`.

## Not changed
- The registration flow itself, consent, CAPTCHA, the application/approval lifecycle.
- Display-name changes of a verified business still go through the review request.
