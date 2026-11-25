# Marketplace — returns & exchanges policy options (2026-11-21)

Status: **decision paper for the owner. Nothing implemented.** Not legal advice: the legal frame below must be checked against the official text of Law 181/2018 and its executive regulation by a lawyer before it goes into the Terms.

## 1. Legal frame (to verify)

Sources consulted (secondary): Law 181 of 2018 on Consumer Protection (full Arabic text on WIPO Lex and lawyeregypt.net).
- General rule reported by the press: the consumer may exchange or return a product and recover its price within **14 days** of receipt, without giving a reason, subject to exceptions.
- Reported exceptions: goods that cannot be returned to their original state because of their nature or packaging; perishable goods; some intangible items.
- Defective goods: reported as **30 days** from receipt (Art. 21 per secondary sources).
- Not confirmed from the search: the exact wording of Art. 39 and how the 14 days apply specifically to distance contracts (Chapter on distance contracts, Art. 36 onward).
- Platform angle to ask the lawyer: who is the "supplier" (the showroom) versus Aladdin as an intermediary, and what the platform may promise on the seller's behalf.

## 2. What is special about Aladdin's goods

Finishing, construction and décor materials: marble and wood alternatives, doors, skirting, cornices, flooring (SPC/HDF/vinyl), curtains, wallpaper. Consequences:
- Items **cut to size or custom-made** (curtains, doors made to opening size) cannot be resold → usually not returnable unless defective.
- **Batch/shade differences** (wallpaper, flooring, tiles): an opened or partly installed lot is hard to return.
- Bulky, heavy goods: return shipping is expensive and damage-prone.
- **Damage on arrival** is the most common real dispute (breakage, scratches).

## 3. Policy dimensions and options

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Return window | a) fixed 14 days for all · b) 14 days, 30 for defects (matches the law as reported) · c) seller-defined per product | b), with the seller allowed to offer MORE but never less |
| 2 | Eligible reasons | a) any reason · b) defect / wrong item / not as described / damaged in transit only | a) within 14 days for ordinary goods (legal baseline), b) for the exceptions below |
| 3 | Non-returnable categories | seller flags a product «مصنوع حسب الطلب / يُقص بالمقاس» and «غير قابل للإرجاع إلا مع العيب»; shown on the product page and checkout | Yes, per-product flag, mandatory disclosure before payment |
| 4 | Condition | unused, original packaging, all parts | Required for non-defective returns |
| 5 | Evidence | photos/video of defect or damage uploaded by the buyer within N days of delivery | Required for damage/defect claims; N = 48 h for visible transit damage |
| 6 | Return shipping cost | a) buyer pays · b) seller pays · c) seller pays if defect/wrong item, buyer pays if change of mind | c) |
| 7 | Remedy | refund · exchange (same/other variant) · partial refund | Buyer chooses refund or exchange; seller can propose partial refund |
| 8 | Refund method | to original method; for COD and InstaPay, refund by InstaPay transfer from the seller to the buyer's InstaPay address | **Owner decision:** refund goes back through the SAME method the buyer paid with (not hard-wired to InstaPay, since more payment methods will be added); marked done by the seller, confirmed by the buyer |
| 9 | Refund deadline | N days after the seller receives the item | 7 days |
| 10 | Who decides | seller approves/rejects within N hours; buyer can escalate | **Owner decision:** seller 72 h; NO auto-approval — on silence the case moves to the admin returns queue and the admin reminds the seller or decides with them; escalation also on complaint (admins holding a dedicated permission) |

## 4. Proposed flow

1. Buyer opens a delivered order within the window → «طلب إرجاع/استبدال» → reason (preset list) + note + photos if needed.
2. Seller approves / rejects (reason from presets) / proposes partial refund within 72 h (reminder at 24 h and 48 h; at 72 h the case moves to the admin returns queue, who reminds the seller or decides with them).
3. If approved: return shipment (buyer ships or seller collects) → seller marks «تم استلام المرتجع» → refund (or exchange order created).
4. Stock: a returned sellable unit goes back to stock only when the seller marks it sellable.
5. Dispute: buyer or seller opens a complaint → admin with the returns-review permission decides; full timeline is kept.
6. Statuses: requested → approved/rejected → in transit → received → refunded/exchanged → closed; every step notifies the other side (in-app).

## 5. Impact on the build

- New tables: return requests, return items, return events/timeline, return evidence (images, R2 only), per-product returnability flags; refund record per order.
- New seller and buyer screens, notifications (templates AR+EN under the same template system as Part 1), admin permission + dispute queue.
- Orders gain «return window ends at» computed from the delivery date.
- Terms of Use / return-policy page text (lawyer).

## 6. Questions for the owner

1. Window: 14 days general and 30 days for defects — accept?
2. Per-product «non-returnable (made to measure)» flag with mandatory disclosure — accept?
3. Return shipping: seller pays for defect/wrong item, buyer pays for change of mind — accept?
4. Refund by InstaPay transfer from the seller, confirmed by the buyer — accept? (Aladdin holds no money.)
5. Seller response time 72 h with auto-approval on silence — accept?
6. Should Aladdin itself guarantee anything (e.g. buyer protection) or only provide the workflow and the dispute record?
7. Lawyer review of the Terms before launch.

## 7. Owner decisions (2026-11-21)

- Section 3 table ACCEPTED as recommended (14 d general / 30 d defects, seller may offer more; per-product non-returnable flag with disclosure; condition; evidence 48 h; return shipping by cause; refund or exchange; 7-day refund deadline), with two changes below.
- Refund method: back through the same method the buyer paid with (payment methods will grow later); seller executes, buyer confirms.
- Seller response 72 h; on silence NO auto-approval: the case goes to the admin returns queue, the admin reminds the seller or decides with them.
- Aladdin guarantee: none — only the workflow and the dispute record.
- Open: lawyer review of the Terms before launch (Q7) not answered yet.
