# Marketplace PR 10 — saved addresses and verified recipient mobile

Status: implemented on branch `feat/mkt-addresses-phone-20261124` (draft PR). Local evidence only. Nothing applied to Acceptance or Production, no variable or secret set, no message sent.

## 1. What it is

Saved buyer addresses (Home / Work / Other, recipient first and last name, recipient mobile, governorate + area, optional map pin) in `public.marketplace_buyer_addresses` (migration `20261125090001`), with the page `/settings/addresses`. The page follows the Marketplace release flag (`NEXT_PUBLIC_MARKETPLACE_PREVIEW`), is not linked from anywhere public and offers no ordering: cart and checkout stay behind `NEXT_PUBLIC_MARKETPLACE_ORDERING`.

## 2. Phone verification: one authority, no second one

The recipient mobile is **verified by the existing phone verification authority** (`phone_verification_start/verify`, WhatsApp, R1/R2; `PHONE_SIGNUP_R2_INTEGRATION.md`). This PR adds no code table, no sender, no flag and no alias-guard change; the authority still ships OFF and its alias guard and single-use grant design are untouched.

- "Verified" is **derived, never stored**: the address's `recipient_phone_e164` equals `profiles.phone_e164` and `profiles.phone_verified_at` is not null (`app.marketplace_buyer_phone_is_verified`). Changing the account phone clears that proof through the authority's own trigger, so every address becomes unverified again with no write here.
- The buyer proves the phone with the existing server actions `startPrimaryPhoneVerification` / `verifyPrimaryPhone` (the account is the session user; no number or id comes from the client).
- A buyer with no account phone can store the recipient number as the account phone through the one existing write path `profile_set_phone` (checkbox, only while the account has no phone), after which the authority can prove it.
- A recipient number that is **not** the account's own number is stored but never verified and never "ready" (`marketplace_buyer_checkout_readiness` reports `phone_unverified`). Proving a third party's number would need the authority to gain a new purpose; that is an owner decision (below).
- While the authority is off (default) the panel answers "verification is not available" and nothing is sent.

## 3. Data, security, privacy

- RLS on both tables; owner-only `select` policy; **no client write grant**; every write is a `SECURITY DEFINER` RPC bound to `auth.uid()` (a user id is never a parameter); RPCs are `authenticated` only.
- Cap of 10 addresses per buyer, enforced under a per-user advisory lock (concurrent saves cannot overshoot); one default (partial unique index); the first address is the default; deleting the default promotes the oldest.
- Idempotent: the client supplies the address id; a retry updates the same row; another user's id answers 42501; deleting a missing address answers `false`.
- Append-only event trail `marketplace_buyer_address_events` (kind + address id + user id; **no value, no foreign key**, no API-role grant). Addresses themselves cascade-delete with the account.
- No logging of values; no address or phone value in a URL; the UI masks the phone (`+20••••••••78`).
- Validation in the database mirrors the form: place keys must exist in `app.place_governorates` / `app.place_cities` (the same keys `marketplace_delivery_rates` uses), pin inside an Egypt bounding box, no control characters, length limits.

## 4. Link to delivery areas

`governorate_key` / `area_key` are the keys of showroom delivery areas (PR 8) and of the buyer place picker (PR 9, `BuyerPlace`). `toBuyerPlace(address)` returns `{ gov, area }` for `marketplace_public_delivery` / `marketplace_public_browse`, and `marketplace_buyer_checkout_readiness()` returns the place keys, so the estimate can be computed for the saved address later (PR 12). An area missing from the catalogue collapses to the governorate.

## 5. Map provider seam and configuration

`frontend/src/lib/env/maps.ts` is the only reader of `NEXT_PUBLIC_MAPS_PROVIDER` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Google is used only when the switch is exactly `google` **and** the key is well-formed; anything else is `none`.

| Provider | Place search | Pin |
|---|---|---|
| `none` (today, owner decision 2026-11-24: Google not needed now) | Egypt catalogue search (Arabic/English, spelling variants, typos) + governorate/area lists | the buyer's own device location (browser Geolocation API, no key, no third-party call) |
| `google` (after the owner's decision) | catalogue + Places autocomplete (Egypt only) | draggable pin; a failed load falls back to `none` |

The Google adapter (`map-provider.ts`, `pin-picker.tsx`) is **not verified against the live service** (no key or billing account exists). Tested: the script URL, single-flight loader and retry, mapping Google address components onto catalogue keys. Variables are documented in `frontend/.env.example`; none is set anywhere.

## 6. Google Maps budget (owner action, before enabling)

Pricing changed in March 2025: free usage is per SKU per month (Essentials SKUs 10,000 calls). Before setting the key:

1. Create a Google Cloud project with a billing account; set a **budget with alerts** (for example 50 / 90 / 100 percent of the chosen monthly cap).
2. Enable only **Maps JavaScript API** and **Places API**; set a **per-day quota cap** on each so a bug or abuse cannot exceed the budget.
3. Create a **browser key** restricted to the site's HTTP referrers (production and Acceptance domains) and to those two APIs; never a server key.
4. The app limits spend by design: the script loads only when the address form opens; autocomplete needs 3+ characters, is debounced 400 ms and returns at most 5 predictions; catalogue search and manual entry cost nothing; no geocoding or directions call exists.
5. Then set `NEXT_PUBLIC_MAPS_PROVIDER=google` and the key in the deployment (owner action; this PR sets nothing).

## 6b. Fields and location (owner decisions, 2026-11-24)

Fields in order: governorate, area, street, building, floor, apartment number, landmark. Governorate and area are ALWAYS required (the delivery fee and estimate come from those keys; coordinates cannot give them without reverse geocoding, which needs a map provider). Without coordinates all seven are required. "Use my current location" fills latitude/longitude from the browser (permission prompt explained; denied, unavailable, timeout, unsupported and outside-Egypt each have a message and fall back to manual entry). **Assumption to confirm:** with coordinates, street, building, floor, apartment and landmark are optional. Coordinates are rounded to 6 decimals, owner-only under RLS, never logged, never in a URL or an event.

## 7. Owner decisions

NEW (made here, clearly provisional): (a) only the buyer's own verified account mobile counts as verified for checkout in this release; a different recipient number is stored but not ready. (b) Addresses page lives at `/settings/addresses`, gated by the Marketplace preview flag. Open: extend the authority with a new purpose to verify a third party's number (security review needed); Google billing account and cap.
