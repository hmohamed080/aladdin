# Staging demo accounts

**Status:** Generated — do not edit by hand. Rebuild with `python scripts/build_staging_seed.py --write-docs`.

The 26 demo identities in the STAGING demo world: who they are, where they land, what they can see, and what each one is for. Source of truth: [`supabase/staging/demo-accounts.toml`](../../supabase/staging/demo-accounts.toml).

## How these accounts sign in

The application is **passwordless** — Email OTP and nothing else. There is no demo
password, no shared credential, and no bypass: each account requests a six-digit code
and types it in, exactly as a real user does.

That makes the address the credential path, which is why the seeded `@example.test`
addresses are not usable as-is — that TLD is reserved and can never receive mail
(RFC 6761). The loader repoints all 26 accounts at addresses composed from **a mailbox
the repository owner configures**, and the build refuses to produce a cloud artifact
without one:

```
plus mode      <mailbox-local>+<prefix>-<slug>@<mailbox-domain>
domain mode    <slug>@<your-demo-domain>
```

Configure it in `supabase/staging/demo-email.toml` (gitignored — copy
`demo-email.example.toml`). The resolved addresses are written to the gitignored
`supabase/.staging-demo-manifest.md` and `.csv` at build time. **No real address
appears in this repository.**

## The accounts

| # | Name | Slug | Persona | Organization | Role | Lands on |
|---|---|---|---|---|---|---|
| 1 | Amina Farouk | `amina-supplier-owner` | — (business-only identity) | Nile Finishing Supplies (`supplier`) | owner | `/b2b` |
| 2 | Karim Adel | `karim-branch-sales` | sales | Nile Finishing Supplies (`supplier`) | member (branch-limited to Cairo) | `/home` |
| 3 | Nadia Salem | `nadia-design-owner` | interior_designer | Delta Interiors Studio (`design_office`) | owner | `/home` |
| 4 | Omar Zaki | `omar-consumer` | end_consumer | — (no organization) | personal account, no organization | `/home` |
| 5 | Platform Admin | `platform-admin` | end_consumer | — (no organization) | platform administrator (platform_role_grants) | `/admin` |
| 6 | Hana Mansour | `hana-showroom-owner` | — (business-only identity) | Cairo Ceramics Showroom (`showroom_dealer`) | owner | `/b2b` |
| 7 | Youssef Amin | `youssef-showroom-sales` | sales | Cairo Ceramics Showroom (`showroom_dealer`) | member (branch-limited to Nasr City Showroom) | `/home` |
| 8 | Tarek Halim | `tarek-manufacturer-owner` | — (business-only identity) | Egypt Marble Manufacturing (`manufacturer`) | owner | `/b2b` |
| 9 | Sara Nabil | `sara-importer-owner` | — (business-only identity) | Nile Import & Trade (`importer`) | owner | `/b2b` |
| 10 | Khaled Roushdy | `khaled-wholesaler-owner` | — (business-only identity) | Delta Wholesale Supply (`wholesaler`) | owner | `/b2b` |
| 11 | Mostafa Bakr | `mostafa-contractor-owner` | contractor | Horizon Contracting (`contractor_company`) | owner | `/home` |
| 12 | Laila Shafik | `laila-contractor-manager` | sales | Horizon Contracting (`contractor_company`) | manager | `/home` |
| 13 | Yasser Fouad | `yasser-engineer` | engineer | Horizon Contracting (`contractor_company`) | member (branch-limited to New Cairo Office) | `/home` |
| 14 | Ahmed Sobhy | `ahmed-installer` | installer_technician | Horizon Contracting (`contractor_company`) | member (branch-limited to New Cairo Office) | `/home` |
| 15 | Nour Hegazy | `nour-invited` | engineer | — (no organization) | pending invitation, account not yet activated | `/onboarding (consent step)` |
| 16 | Mahmoud Ezzat | `mahmoud-glass-owner` | — (business-only identity) | Alexandria Glass & Aluminium (`manufacturer`) | owner | `/b2b` |
| 17 | Rania Gamal | `rania-paints-owner` | — (business-only identity) | Suez Paints & Coatings (`supplier`) | owner | `/b2b` |
| 18 | Fady Riad | `fady-sanitary-owner` | — (business-only identity) | Cairo Sanitary Ware Trading (`importer`) | owner | `/b2b` |
| 19 | Dina Sherif | `dina-design-owner` | — (business-only identity) | New Cairo Design Studio (`design_office`) | owner | `/b2b` |
| 20 | Hazem Lotfy | `hazem-showroom-owner` | — (business-only identity) | Zayed Home Showroom (`showroom_dealer`) | owner | `/b2b` |
| 21 | Sayed Abdel-Rahman | `sayed-marble-fixer` | installer_technician | — (no organization) | listed independent professional | `/home` |
| 22 | Mahmoud Fathy | `fathy-electrician` | installer_technician | — (no organization) | listed independent professional | `/home` |
| 23 | Ibrahim Nasr | `ibrahim-plumber` | installer_technician | — (no organization) | listed independent professional | `/home` |
| 24 | Wael Sobhy | `wael-gypsum-fitter` | installer_technician | — (no organization) | listed independent professional | `/home` |
| 25 | Heba Kamal | `heba-interior-designer` | interior_designer | — (no organization) | listed independent professional | `/home` |
| 26 | Amr Selim | `amr-site-engineer` | engineer | — (no organization) | listed independent professional | `/home` |

## What each account shows

### 1. Amina Farouk

- **Email slug:** `amina-supplier-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Nile Finishing Supplies (`supplier`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 3 published products; 4 customers and 4 leads across the Cairo and Sheikh Zayed branches; 3 follow-ups; an inbound RFQ from Delta Interiors Studio, the quotation she sent, the resulting order and the active delivery project; a full 5-section workspace nav.
- **What to demo:** The supplier owner's whole day. Open Leads to show both branches at once, then the RFQ → quotation → order → project chain with Delta Interiors. Contrast with Karim, who sees only the Cairo half of the same book.

### 2. Karim Adel

- **Email slug:** `karim-branch-sales` — composed against your configured mailbox
- **Persona / account type:** sales
- **Organization:** Nile Finishing Supplies (`supplier`)
- **Role:** member (branch-limited to Cairo)
- **Expected landing route:** `/home`
- **Key visible data:** Personal salesperson profile at 100% completeness; a PENDING affiliation request to Cairo Ceramics Showroom; in the business workspace, strictly the Cairo branch slice — 2 customers, 2 leads, 2 follow-ups — and none of the Sheikh Zayed rows.
- **What to demo:** Branch isolation, proven live. Sign in beside Amina and show the same Leads screen returning fewer rows. Also the salesperson affiliation panel on /home with a real pending request.

### 3. Nadia Salem

- **Email slug:** `nadia-design-owner` — composed against your configured mailbox
- **Persona / account type:** interior_designer
- **Organization:** Delta Interiors Studio (`design_office`)
- **Role:** owner
- **Expected landing route:** `/home`
- **Key visible data:** Personal interior-designer profile at 100%; in the studio workspace, 2 purchase requests (one closed, one awaiting a price), the quotation she accepted, the resulting order, an active project, and a 3-item saved-products shortlist.
- **What to demo:** The dual identity the product model is built on: a personal Interior Designer who ALSO owns a business, switching context without any persona switch. Then the buyer side of the value chain end to end.

### 4. Omar Zaki

- **Email slug:** `omar-consumer` — composed against your configured mailbox
- **Persona / account type:** end_consumer
- **Organization:** — (no organization)
- **Role:** personal account, no organization
- **Expected landing route:** `/home`
- **Key visible data:** Consumer profile at 100% — renovation intent, four interests, New Cairo location and budget band; the public catalogue of 16 published products; the verified-business and professional directories.
- **What to demo:** The B2C entry point: a consumer with a real stated need, browsing the catalogue and the technician directory. Shows what a consumer can and cannot see (no organization data at all).

### 5. Platform Admin

- **Email slug:** `platform-admin` — composed against your configured mailbox
- **Persona / account type:** end_consumer
- **Organization:** — (no organization)
- **Role:** platform administrator (platform_role_grants)
- **Expected landing route:** `/admin`
- **Key visible data:** The verification queue — 2 organizations and 3 individual professionals awaiting review; the full audit trail; every organization and user; platform-wide commerce (17 RFQs, 14 quotations, 10 orders, 5 projects).
- **What to demo:** The Admin console. Work the verification queue, approve an organization and watch it appear in the public directory, then read the audit trail behind the Cairo Ceramics → Horizon chain.

### 6. Hana Mansour

- **Email slug:** `hana-showroom-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Cairo Ceramics Showroom (`showroom_dealer`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** The richest account: 12 purchase requests over six months, 10 received offers, 7 supplier orders, 2 incoming delivery projects, an 8-item shortlist, its own 4-product shelf, 4 outgoing sales quotations, 5 customers, 6 leads, 6 follow-ups, and a 4-person team with a pending invitation.
- **What to demo:** THE primary demo account. Buying, selling and delivery in one workspace, with a six-month purchase-value trend and a spend ranking that are real aggregates of the rows behind them.

### 7. Youssef Amin

- **Email slug:** `youssef-showroom-sales` — composed against your configured mailbox
- **Persona / account type:** sales
- **Organization:** Cairo Ceramics Showroom (`showroom_dealer`)
- **Role:** member (branch-limited to Nasr City Showroom)
- **Expected landing route:** `/home`
- **Key visible data:** Personal salesperson profile at 100%, with Cairo Ceramics showing as an ACTIVE showroom affiliation; in the workspace, the Nasr City sales book — 5 customers, 6 leads across every stage including one won and one lost, 6 follow-ups (2 overdue).
- **What to demo:** The daily-active user. Start at the affiliation panel on /home, switch into the showroom, then work the overdue follow-ups and move a lead through its stages.

### 8. Tarek Halim

- **Email slug:** `tarek-manufacturer-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Egypt Marble Manufacturing (`manufacturer`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 1 published product, 1 inbound RFQ from Cairo Ceramics, the EGP 415,000 quotation he won and its completed order; an organization verification sitting in the Admin queue as `submitted`.
- **What to demo:** Verification as a TRUST state, not an access gate: a business that is still pending review trades normally but is absent from the public directory. Pair with the Admin account to approve it live.

### 9. Sara Nabil

- **Email slug:** `sara-importer-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Nile Import & Trade (`importer`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 2 published imported products; an inbound RFQ from Cairo Ceramics with the quotation she has submitted and is awaiting a decision on; one completed order and its delivery project; an organization verification in the Admin queue.
- **What to demo:** The supplier side of the RFQ inbox: an offer that has been sent and is waiting on the buyer. Show the same quotation from Hana's side to prove both parties read one shared record.

### 10. Khaled Roushdy

- **Email slug:** `khaled-wholesaler-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Delta Wholesale Supply (`wholesaler`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 3 published products; 3 inbound RFQs from Cairo Ceramics; 3 quotations — two accepted, one rejected on price; 2 orders (one completed, one in progress) and an active ceiling-board delivery project.
- **What to demo:** A distributor's inbox, including a LOST offer. The rejected LED quotation is the honest case most demos leave out.

### 11. Mostafa Bakr

- **Email slug:** `mostafa-contractor-owner` — composed against your configured mailbox
- **Persona / account type:** contractor
- **Organization:** Horizon Contracting (`contractor_company`)
- **Role:** owner
- **Expected landing route:** `/home`
- **Key visible data:** Personal contractor profile at 100%; in the Horizon workspace, 2 RFQs (one quoted and accepted, one still awaiting a price from Cairo Ceramics), the EGP 143,000 quotation he accepted, the resulting in-progress order, an active villa project, and a 4-person team with Nour's pending invitation.
- **What to demo:** The buyer's half of the core value chain, plus people operations: show the pending invitation on the Team screen, then open Nour's invitation link in a private window.

### 12. Laila Shafik

- **Email slug:** `laila-contractor-manager` — composed against your configured mailbox
- **Persona / account type:** sales
- **Organization:** Horizon Contracting (`contractor_company`)
- **Role:** manager
- **Expected landing route:** `/home`
- **Key visible data:** Personal salesperson profile at 100% with a SUBMITTED showroom referral awaiting platform review; in the workspace, the same Horizon commerce as the owner but WITHOUT org.manage — no Settings, no catalogue publishing.
- **What to demo:** "Manager" as a relationship, not an account type. Put her screen beside Mostafa's: same organization, same data, visibly fewer controls. Also the showroom-referral half of the affiliation panel.

### 13. Yasser Fouad

- **Email slug:** `yasser-engineer` — composed against your configured mailbox
- **Persona / account type:** engineer
- **Organization:** Horizon Contracting (`contractor_company`)
- **Role:** member (branch-limited to New Cairo Office)
- **Expected landing route:** `/home`
- **Key visible data:** Personal engineer profile at 100% with an approved professional verification (the verified badge); in the workspace, the active New Cairo villa project and the catalogue, and the ability to raise an RFQ — but no quotation decisions and no team management.
- **What to demo:** Capability scoping inside one organization. He can start a purchase request but cannot accept the offer that comes back — the decision stays with Mostafa or Laila.

### 14. Ahmed Sobhy

- **Email slug:** `ahmed-installer` — composed against your configured mailbox
- **Persona / account type:** installer_technician
- **Organization:** Horizon Contracting (`contractor_company`)
- **Role:** member (branch-limited to New Cairo Office)
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (tiling trade, 15 years) that appears in the Technicians directory; personal profile at 100%; in the workspace, project execution only — the active villa project, no commerce, no catalogue publishing.
- **What to demo:** The narrowest workspace in the demo, and the one identity that is BOTH an org member and publicly discoverable. Find him in the Technicians directory from Omar's consumer account, then sign in as him.

### 15. Nour Hegazy

- **Email slug:** `nour-invited` — composed against your configured mailbox
- **Persona / account type:** engineer
- **Organization:** — (no organization)
- **Role:** pending invitation, account not yet activated
- **Expected landing route:** `/onboarding (consent step)`
- **Key visible data:** Deliberately none. A PENDING invitation to Horizon Contracting (New Cairo Office, valid 14 days) and no memberships. `my_registration_state()` resolves to `consent_pending`, so she lands on an actionable consent form.
- **What to demo:** THE ONLY DELIBERATELY EMPTY ACCOUNT — it is the brand-new-user journey. Open her invitation link, accept consent, walk profile → contact → account type, and watch a real account come into existence. Everything else in this manifest is a populated account; this one is the flow that creates them.

### 16. Mahmoud Ezzat

- **Email slug:** `mahmoud-glass-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Alexandria Glass & Aluminium (`manufacturer`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 2 published products; 2 inbound RFQs from Cairo Ceramics; 2 quotations (one accepted at EGP 268,000, one awaiting decision); a completed order and the completed glass-partition installation project he executed.
- **What to demo:** A manufacturer that also EXECUTES a project, not just supplies material — the order → project handover on the supplier side.

### 17. Rania Gamal

- **Email slug:** `rania-paints-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Suez Paints & Coatings (`supplier`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 2 published products; 2 inbound RFQs; 2 accepted quotations; 2 orders — one completed six months ago, one confirmed and not yet started.
- **What to demo:** An Arabic-primary supplier (the organization's primary_locale is `ar`). Good account for showing the RTL workspace against Mahmoud's English one.

### 18. Fady Riad

- **Email slug:** `fady-sanitary-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Cairo Sanitary Ware Trading (`importer`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 2 published products; 2 inbound RFQs; 2 quotations — one accepted, one for 100 basins still awaiting Cairo Ceramics' decision; a completed order.
- **What to demo:** The other side of Hana's open offers list. Show his submitted quotation, then accept it from Hana's account and watch both screens agree.

### 19. Dina Sherif

- **Email slug:** `dina-design-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** New Cairo Design Studio (`design_office`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 2 purchase requests to Cairo Ceramics; 2 quotations she received and accepted (EGP 182,500 and EGP 240,000); 2 orders; 2 projects — one completed Maadi apartment, one planned villa marble package.
- **What to demo:** A design office as a BUYER of finishing materials — the professional-services demand side, and a planned (not yet active) project.

### 20. Hazem Lotfy

- **Email slug:** `hazem-showroom-owner` — composed against your configured mailbox
- **Persona / account type:** — (business-only identity)
- **Organization:** Zayed Home Showroom (`showroom_dealer`)
- **Role:** owner
- **Expected landing route:** `/b2b`
- **Key visible data:** 2 published products; an inbound sample-order RFQ from Cairo Ceramics awaiting his price; his own outgoing RFQ to Cairo Ceramics and the quotation he received.
- **What to demo:** A PEER showroom — the same workspace as Hana's, seen from the other side of the same two transactions. Proves tenant isolation: he sees those two records and nothing else of hers.

### 21. Sayed Abdel-Rahman

- **Email slug:** `sayed-marble-fixer` — composed against your configured mailbox
- **Persona / account type:** installer_technician
- **Organization:** — (no organization)
- **Role:** listed independent professional
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (marble and granite fixing) in the Technicians directory; personal profile at 100% — 18 years, service areas, availability, day rate band; an APPROVED professional verification showing the verified badge.
- **What to demo:** The trusted-match supply side. Find him in the directory as a consumer, then sign in as him to show the profile and the verified state behind that listing.

### 22. Mahmoud Fathy

- **Email slug:** `fathy-electrician` — composed against your configured mailbox
- **Persona / account type:** installer_technician
- **Organization:** — (no organization)
- **Role:** listed independent professional
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (electrical installation and lighting); personal profile at 100%; no verification submitted — the `not verified` trust state.
- **What to demo:** The contrast case to Sayed: listed and fully complete, but not yet verified. Shows that completeness and verification are two independent signals, and neither blocks access.

### 23. Ibrahim Nasr

- **Email slug:** `ibrahim-plumber` — composed against your configured mailbox
- **Persona / account type:** installer_technician
- **Organization:** — (no organization)
- **Role:** listed independent professional
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (plumbing and sanitary fitting); personal profile at 100%; a SUBMITTED professional verification awaiting review in the Admin queue.
- **What to demo:** The verification round trip. Show his pending badge, approve it from the Admin account, then reload his home and see the state change.

### 24. Wael Sobhy

- **Email slug:** `wael-gypsum-fitter` — composed against your configured mailbox
- **Persona / account type:** installer_technician
- **Organization:** — (no organization)
- **Role:** listed independent professional
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (gypsum board and false ceilings); personal profile at 100%; a `needs_more_info` verification carrying the reviewer's stated reason.
- **What to demo:** The third verification outcome, and the one that must read as actionable rather than punitive: the reason is shown to him and the account keeps working throughout.

### 25. Heba Kamal

- **Email slug:** `heba-interior-designer` — composed against your configured mailbox
- **Persona / account type:** interior_designer
- **Organization:** — (no organization)
- **Role:** listed independent professional
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (residential interior design) in the professionals directory; personal profile at 100% — remote-capable, so the travel-radius item is correctly excluded from her denominator.
- **What to demo:** An independent professional with NO organization — the personal-professional identity that holds zero businesses. Also the completeness rule that drops inapplicable items for a remote-only designer.

### 26. Amr Selim

- **Email slug:** `amr-site-engineer` — composed against your configured mailbox
- **Persona / account type:** engineer
- **Organization:** — (no organization)
- **Role:** listed independent professional
- **Expected landing route:** `/home`
- **Key visible data:** A LISTED public profile (site and finishing engineering); personal profile at 100% — quantity take-offs, contractor coordination, Cairo and Giza service areas.
- **What to demo:** The consultation-first entry point: the engineer a consumer or contractor would find and engage before any product is chosen.

## Verifying

```bash
psql "<connection string>" -f supabase/staging/verify-staging-seed.sql
```

Read-only and wrapped in a transaction that always rolls back. It checks population,
address uniqueness and deliverability, persona/membership/branch linkage, commerce
totals against their own line items, and — impersonating all 26 accounts under RLS —
the landing route and non-emptiness of every one of them.

## Related

[`staging-deployment-runbook.md`](staging-deployment-runbook.md) ·
[`../../supabase/staging/demo-enrichment.sql`](../../supabase/staging/demo-enrichment.sql) ·
`scripts/build_staging_seed.py` · `scripts/rehearse_staging_seed.py`
