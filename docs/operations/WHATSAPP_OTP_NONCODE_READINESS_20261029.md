# WhatsApp OTP — non-code readiness pack (safe alongside PR #116)

**Prepared:** 2026-10-29  
**Scope:** product UX, operational readiness, risk and test planning only. No code, database, account setting or Worker deployment changes.  
**GitHub dependencies:** #113 must stabilize first, then #116 is retargeted/tested before signup integration. #117 is a separate draft planning PR. #114 is the isolated delivery-disabled Preview transport PR.

## 2026-10-29 owner-provided Meta Manager visual checks (read-only)

The owner supplied screenshots from WhatsApp Manager. **Screenshot evidence only; no live Meta API verification or billing transaction evidence was performed here.** Do not put the full sender phone or payment instrument into a public PR.

- Sender (masked): Egyptian WhatsApp business number ending **5339**, status **Connected**, number quality **High**; display name shown as **Business Solution**, and a subsequent owner screenshot explicitly shows **Approved** (2026-10-29). Connected and name approval are separately confirmed by screenshots.
- Template `aladdin_otp`: **Authentication**, **Arabic**, status **Active – Quality pending** (approved/sendable; quality feedback pending); the visual preview shows Copy Code and 5-minute expiry. Recheck current status immediately before actual sends.
- Insights → Message pricing, filter **All phone numbers**, **All countries**, **23–29 October 2026**: **2 sent; 2 delivered; 2 paid**; breakdown **1 Utility / 1 Authentication**, no Marketing and no free messages. Approximate total charges **10.43 ARS**, approximately **5.22 ARS per category**. This is **ARS (Argentine peso), NOT USD** as displayed. Counts refer to this selected reporting period and may differ from other cards.
- **Historical test charges; detailed billing review deliberately deferred by owner:** the owner confirms the two delivered messages were early manual tests **before any WhatsApp OTP PR**. Insights remains an approximate usage report, not evidence of invoice due/paid. Do not attribute this activity to the deployed OTP Preview Worker. Do not spend time on invoice reconciliation now; check applicable pricing/spend controls before broad launch.
- **Worker sender linkage confirmed by owner (2026-10-29):** the Phone Number ID shown in Meta Developers / WhatsApp API Setup matches the configured Preview Worker value `1415528588305492`. This is an owner-reported dashboard comparison; no Meta API call was made, and it does **not** authorize live sending.
- This evidence does **not** authorize activating Worker delivery, Supabase SMS Hook, phone MFA add-on, or Production. PR #116 registration changes remain independently in progress.

## 1) Already established (do not repeat)

- Cloudflare Preview `aladdin-whatsapp-otp-preview` deployed with `WHATSAPP_DELIVERY_ENABLED=false`, signing binding tested with signed dummy HTTP request, no D1 replay entries after tests.
- Existing account primary verification field `profiles.phone_verified_at`; Installer Settings badge already reports verified/unverified.
- Existing secondary unverified phone reservations: 7 days + 7-day single renewal, global uniqueness, 30-day cooldown on expiry/cancellation, password reauth for changes.
- Meta Arabic Authentication / Copy Code template `aladdin_otp` was manually tested by owner in preparation; **template Active status and display name Approved confirmed from owner screenshots; exact real sender Phone Number ID still needs comparison to Worker config before a live send**.
- Owner **accepts Meta per-message OTP costs** but explicitly defers the Supabase Advanced Phone MFA recurring add-on.
- Existing alias-account identity must remain unchanged; no direct `signInWithOtp({phone})` conversion.

## 2) UX copy — product draft, not the Meta template

| Surface | Arabic UI | English UI |
| --- | --- | --- |
| Existing primary unverified badge | غير موثّق | Not verified |
| Existing primary verify CTA | تأكيد الرقم عبر واتساب | Verify via WhatsApp |
| Verified primary badge | رقم موثّق | Verified number |
| Signup verify title | أكّد رقم موبايلك | Verify your mobile number |
| Signup verify explanation | هنرسل رمز تأكيد على واتساب للرقم اللي أدخلته. مش هنفعّل حسابك بالكامل غير بعد التأكيد. | We'll send a code to WhatsApp on the number you entered. Full account access starts after verification. |
| Additional phone pending badge | محجوز — غير موثّق | Reserved — not verified |
| Additional phone optional hint | تقدر تحفظ الرقم وتأكد ملكيته في وقت لاحق قبل انتهاء فترة الحجز. الرقم مش هيُستخدم للدخول أو استعادة الحساب تلقائيًا. | You can save this number and verify it later before the reservation expires. It won't automatically become a sign-in or recovery method. |
| Verify-code hint | أدخل رمز التأكيد اللي وصلك على واتساب. | Enter the code you received on WhatsApp. |
| Code not received | لم يصلك الرمز؟ حاول مجددًا بعد انتهاء المهلة، أو راجع الرقم. | Didn't get the code? Try again after the cooldown or check the number. |
| Wrong/expired code | الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا. | This code is invalid or expired. Request another. |
| Verified success | تم تأكيد ملكية الرقم بنجاح. | Your number has been verified. |
| Missing WhatsApp | لازم الرقم يكون عليه واتساب لاستلام رمز التأكيد. | This number needs WhatsApp to receive the verification code. |
| Service temporarily down | تعذّر إرسال الرمز حاليًا. جرّب لاحقًا. | We couldn't send the code right now. Try again later. |
| Separate notifications consent | أوافق على استلام تحديثات Aladdin عبر واتساب (اختياري). | I agree to receive Aladdin updates on WhatsApp (optional). |

**UX decisions:** use the product's existing `OtpInput`, Arabic/English translations and light/dark tokens rather than new controls. Resend action must be disabled until server-enforced limit permits it; always reflect actual server expiration. Never reveal OTP, signing keys or internal synthetic email aliases in UI, URLs, analytics or logs. Meta's approved Authentication template copy is separately controlled in Meta; this table does **not** replace/change it.

## 3) Account-state acceptance examples

| Case | Before | Action | Expected |
| --- | --- | --- | --- |
| Legacy Installer account | Primary phone stored; `phone_verified_at IS NULL` | Opens settings | Badge and Verify action; still signs in using existing password; no spontaneous phone/Auth change |
| Legacy Showroom | Same | Opens settings | Same behavior, preserve organization and permissions |
| Newly registered phone-password user | Pending identity | Signup | Can request WhatsApp OTP but must not receive full account access before possession proof; preserve single `user.id` |
| New-user number mistyped | Pending verification | Edit phone | Stale challenge invalidated; no accidental duplicate identity |
| Existing additional contact | Active reservation | Save without OTP | Stays reserved and unverified with original 7+7 and 30-day constraints |
| Additional contact typo | Active reservation | Edit number | Requires applicable password receipt; original database uniqueness/cooldown rules unchanged |
| Additional contact verified | Owned active reservation | Verify exact number | **Proposed:** convert to durable verified *contact-only* claim before expiry, without granting sign-in/recovery/MFA permissions |
| Expired/cancelled reservation | Inactive | Enter code from an earlier attempt | Refuse and do not resurrect reservation |
| Main phone change | Verified old number | Change to new one | New number unverified until possession proof; preserve login recovery and alias journal, avoid lockout |
| Organization contact phone | Business contact, not account login | Update | Business-contact semantics only; do not treat as a verified personal credential |
| Number used for future MFA | Verified contact-only phone | Enable MFA | Separate deliberate enrollment and step-up; possession proof alone is insufficient |

**Open design decision** for A2: precise transactional move from *active unverified reservation* to *durable verified secondary contact*; the current V1 table only models `active/expired/cancelled/converted`. Preserve locking, uniqueness and cooldown; do not silently mark `converted` (currently primary promotion) or extend a temporary reservation forever.

**Open design decision** for B: signup identity/verification authority on alias accounts. Do not activate GoTrue phone signup until local test fixtures prove no user-ID duplication or authorization bypass.

## 4) First live Meta pilot prerequisites (none activate now)

- [x] Owner agrees in principle to paying Meta WhatsApp Authentication delivery fees.
- [x] Isolated Preview Worker with delivery OFF and valid signing binding; three unsigned and one signed fail-closed HTTP smoke tests succeeded.
- [x] Owner-provided Meta screenshots show real sender **Connected**, quality **High**, display name **Approved**; owner independently confirmed Phone Number ID `1415528588305492` exactly matches the configured Worker sender. Recheck current state before any live send; never disclose the access token.
- [x] Owner screenshot confirms `aladdin_otp` template **Active – Quality pending**, Authentication, Arabic and Copy Code. Recheck live status in the intended WABA before sending; do not edit the template.
- [ ] Ahead of live rollout, check Meta send limits/alert thresholds and actual Authentication message rate for intended destinations. Detailed reconciliation of the two historical test charges is intentionally postponed on owner request.
- [ ] Select **one owner-controlled WhatsApp-enabled test number**, separately entered as an environment secret/recipient allowlist; don't post it in public issues, PR comments or chat. Verify opt-in specifically for authentication messaging.
- [ ] Define a tiny pilot message budget, per-number and per-IP caps and alert threshold; default recommendation is a handful of owner test deliveries, not general signup traffic. Actual throttles require later code/security approval.
- [ ] Prepare a negative-test recipient with **no WhatsApp account** to confirm fail-safe messaging UX without resorting to a silent unverified registration activation.
- [ ] Confirm Supabase hosted Send SMS Hook actual payload (`user.phone` vs `new_phone`) and intended event types before hook enablement. Current Worker intentionally rejects `new_phone` until validated.
- [ ] Review data retention, logs, explicit notification/marketing consent language and no-secret-exposure practices. OTP consent != marketing/notifications consent.
- [ ] Conduct local end-to-end identity tests before any hosted hook or delivery toggle change. Owner must separately approve first paid Acceptance message and a later rollout.
- [ ] Keep Supabase Advanced Phone MFA **OFF**. TOTP enrollment may proceed independently using native no-add-on-cost MFA only after identity/readiness tests.

## 5) Cost model for approval, not a charge authorization

Budget by **delivered Authentication messages**, not by unique users: signups + resend attempts + primary proofs + secondary proofs + eventual MFA (if separately designed). Factor in destination country, template class, Meta business-home-country treatment and possible international Authentication rates. Meta rate card can change. Capture actual cost from Meta WhatsApp Manager and set a monitored budget before the first billable pilot. Owner approval to *incur per-message Meta costs* is **not** permission to activate the Worker, the Supabase Hook or Production.

Do not promise SMS fallback: user explicitly prefers WhatsApp-only phone ownership proof. Show a clear no-WhatsApp state and offer support / a non-phone registration method where product policy allows, without bypassing mandatory proof on phone signup.

## 6) Dependencies and release boundary

- **Safe now:** finalize UX, acceptance criteria, current WABA/template/billing screenshots (redacted), owner-approved pilot cap, legacy-account copy and scope decisions.
- **Requires stabilized #116:** changing phone-password signup server actions, register/continue flow, username leases and new-user access gate.
- **Requires tested code:** secure OTP issuance/verification, secondary verified record, transactional proof and idempotency, MFA enforcement.
- **Requires separately authorized hosted activation:** Meta live send; Supabase Send SMS Hook; allowlisted Acceptance real-number pilot.
- **Out of scope:** Supabase Advanced Phone MFA subscription, bulk messaging, broad WhatsApp rollout and any Production changes.

## References
- Aladdin PR #114: https://github.com/hmohamed080/aladdin/pull/114
- Aladdin PR #116: https://github.com/hmohamed080/aladdin/pull/116
- Aladdin PR #117: https://github.com/hmohamed080/aladdin/pull/117
- Meta WhatsApp Business Policy: https://business.whatsapp.com/policy/ (OTP permission is distinct from marketing/contact permissions)
- Meta WhatsApp Business Platform template collection: https://www.postman.com/meta/whatsapp-business-platform/folder/huymv7d/templates
- Meta WhatsApp Business Platform pricing: https://developers.facebook.com/docs/whatsapp/pricing/
