# Dropdowns, selects and menus — one system

**Rule (website-wide):** every dropdown, select or menu surface that WE control follows the Aladdin design system
and is built through ONE shared abstraction. No page positions its own floating surface, and no page leaves a
native `<select>` in front of the person just because one browser happens to theme it.

Native browser **date / time / range** pickers are the one deliberate exception (see §4): we do not rebuild system
calendars.

## 1. The shared pieces

| Piece | File | Owns |
|---|---|---|
| `FloatingMenu` | `frontend/src/components/ui/floating-menu.tsx` | The surface: portal into `#overlay-root`, `position: fixed`, Floating UI (`offset`, `flip`, `shift`, `size`, `autoUpdate`, 12px viewport padding), RTL-aware `-start`/`-end`, carries the `.installer-surface` theme scope and `dir` across the portal, and the behaviour every menu shares: Escape / outside press / Tab dismissal, focus return, Arrow / Home / End, type-ahead. `z-popover` (600) is above `z-modal` (500), so a list opened inside a dialog is never hidden by it. |
| `ListboxSelect` | `frontend/src/components/ui/listbox.tsx` | A single-choice control: a `<button aria-haspopup="listbox">` that opens a `role="listbox"` on `FloatingMenu`. Optional groups, three looks (`default` filter/toolbar, `field` = identical to `Input`, `compact`), a muted "Choose…" prompt, an invalid state. |
| `Select` | `frontend/src/components/ui/controls.tsx` | The **drop-in** for markup written `<Select><option/></Select>` (59 call sites). Same props, same children, same `onChange(event)`, drawn as a `ListboxSelect`. |
| `CountryPicker` | `frontend/src/components/ui/country-picker.tsx` | The searchable list for phone country codes (`PhoneField`). |
| `fieldBase` | `frontend/src/components/ui/field-style.ts` | The one string `Input`, `Textarea` and `Select` share, so a field, a textarea and a select line up exactly. |

### How `Select` keeps every existing call site working

What the person sees and operates is the button + listbox. What the **form** sees is still a real native
`<select>`, kept in the tree as the *form-value carrier* (`data-ui-select-native`): it owns `name`, `id`, `value` /
`defaultValue`, `required`, `disabled`, `form`, the `ref` and the change event. Choosing an option sets its value and
dispatches a genuine bubbling `change` event, so React delivers it to the caller's `onChange(event)` exactly as before.

* It is visually hidden with `opacity-0` + `pointer-events-none` (**not** `display:none`), so a `required` field still
  validates, has a box for the browser's validation bubble, and is "visible" to automation.
* It is `aria-hidden` and `tabindex="-1"`: the button is the single accessible, focusable control. Focus sent to the
  carrier (a `<label for>` click, a failed `reportValidity()`) is forwarded to the button.
* It stays **the labelled control**: `<label htmlFor>`, `aria-label` and `aria-labelledby` resolve to it exactly once.
  The button repeats that name as visually hidden text ("City: Giza"), the way a native select announces its label and
  value, so there is no duplicate label for assistive tech, tests or automation.
* Uncontrolled selects follow the browser when their options change or the form resets; controlled selects show only
  what the parent says.
* A disabled option that is the current value (a "Choose…" prompt) does not strand the keyboard: focus lands on the
  first enabled option.
* Inside a `ConfirmDialog` the focus trap ignores the aria-hidden carrier; the visible button is the focusable control.

### Testing and automation

* Unit tests: query the control by its label (`getByLabelText`). That is the native carrier, so `.value`, `.options`
  and `fireEvent.change` work. To read the options a person can pick, open the list
  (`fireEvent.click(getByRole("button", { name: /^City/ }))`) or read the carrier's options with `{ hidden: true }`.
* Playwright: `page.getByLabel("City").selectOption("giza")` keeps working (the carrier is "visible" to it), and
  `page.getByRole("button", { name: /^City/ })` opens the list for UI-level tests.

## 2. Behaviour contract (every dropdown)

Rounded Aladdin surface · portal positioning, never clipped · RTL and LTR · Arabic and English · light and dark ·
keyboard (Enter / Space / ArrowDown open, ArrowUp / ArrowDown / Home / End move, type-ahead, Enter chooses, Escape
closes and returns focus, Tab leaves) · `role="listbox"` / `menu` with `aria-selected` · usable on a 390px phone ·
no hydration mismatch (the accessible name is computed after mount; the server render and the first client render are
identical).

## 3. Route-by-route audit of the former native selects

Before: **59** `<Select>` call sites in **31** components, every one rendering a **native browser `<select>`** (its
picker un-themeable in Firefox and Safari, themed in Chromium only behind `appearance: base-select`).
After: **0** native pickers in front of the person; **59/59** are the shared `Select`. The `base-select` stylesheet
workaround is deleted from `globals.css`, and a guard test fails if any other `<select>` or `<datalist>` element
appears in the product.

| Route / component | Fields | Old control | New shared control | Migrated? | Exception / reason |
|---|---|---|---|---|---|
| every /b2b workspace page (topbar branch switcher)<br>`components/layout/context-switchers.tsx` | branch (nav.branch) (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/catalog`, `/b2b/institutions`, `/b2b/products`, `/b2b/reports`, `/b2b/suppliers`, `/b2b/technicians`<br>`components/ui/filter-bar.tsx` | filter (generic: one per configured filter) (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/home/showroom/refer`<br>`features/accounts/showroom-referral-form.tsx` | `governorate`, `city` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/home/showroom`<br>`features/accounts/showroom-search.tsx` | `branchId` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/auth/finish-registration`<br>`features/auth-password-preview/finish-registration-screen.tsx` | `accountType` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/auth/sign-up`<br>`features/auth-password-preview/sign-up-form.tsx` | `accountType` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| (component currently unreferenced by any route)<br>`features/commerce/catalog-filters.tsx` | category (commerce.fields.category) (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/products/[id]/edit`, `/b2b/products/new`<br>`features/commerce/product-form.tsx` | `category`, `unit` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/rfqs/[rfqId]`<br>`features/commerce/rfq-detail.tsx` | `productId` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/business/new`, `/onboarding/business`<br>`features/onboarding/business-flow.tsx` | `bgov`, `bcity` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/onboarding/consumer`<br>`features/onboarding/consumer-flow.tsx` | `gov`, `city` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/onboarding/professional`<br>`features/onboarding/professional-flow.tsx` | `gov`, `travel` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/onboarding/profile`<br>`features/onboarding/profile-step.tsx` | `locale` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/settings`<br>`features/organization/branch-identity-dialog.tsx` | `timezone` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/organization`<br>`features/organization/join-requests.tsx` | `branchId` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/settings`<br>`features/organization/organization-identity-dialog.tsx` | `timezone` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/organization`<br>`features/organization/people-manager.tsx` | `branchId`, `role`, `branchId` (3) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/home/profile/edit`<br>`features/profile/professional-profile-editor.tsx` | `gov`, `travel` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/customers/[id]/edit`<br>`features/sales/customer-edit-form.tsx` | `preferredLanguage`, `source` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/customers`<br>`features/sales/customer-filters.tsx` | `status`, `branch` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/customers/new`<br>`features/sales/customer-form.tsx` | `customerType`, `branchId`, `preferredLanguage`, `source`, `assignedMembershipId`, `assignedMembershipId` (6) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/customers/[id]/edit`<br>`features/sales/customer-ownership-form.tsx` | `branchId`, `assigneeMembershipId` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/follow-ups/[id]/edit`<br>`features/sales/follow-up-edit-form.tsx` | `priority` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/customers/[id]`, `/b2b/leads/[id]`<br>`features/sales/follow-up-inline.tsx` | `priority`, `assigneeMembershipId` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/leads/[id]`<br>`features/sales/lead-actions.tsx` | `stage`, `assigneeMembershipId` (2) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/customers/[id]`, `/b2b/leads/[id]`<br>`features/sales/lead-activity-form.tsx` | `activityType` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/leads/[id]/edit`<br>`features/sales/lead-edit-form.tsx` | `priority` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/leads/new`<br>`features/sales/lead-form.tsx` | `customerId`, `branchId`, `priority`, `source`, `assignedMembershipId`, `assignedMembershipId` (6) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/leads/[id]/edit`<br>`features/sales/lead-source-branch-form.tsx` | `source`, `branchId`, `assigneeMembershipId` (3) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/leads`<br>`features/sales/leads-view.tsx` | `status`, `stage`, `priority`, `branch` (4) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| `/b2b/follow-ups/[id]/edit`<br>`features/sales/reassign-follow-up-form.tsx` | `assigneeMembershipId` (1) | native `<select>` | shared `Select` → `ListboxSelect` + `FloatingMenu` | **Yes** | — |
| **Total** | **59 call sites in 31 components** | | | **59/59** | |

Menus and listboxes migrated earlier in Batch 1B (all on `FloatingMenu`): the Jobs board sort, filters and listboxes;
My Work menus (filter, sort, row ⋯); Reviews and Network filters; the Points-history filter; the topbar account menu,
profile menu, workspace switcher and workplace switcher; the board, stage, period and dashboard-period selects; the
profile-completion pickers; the showroom referral select; the phone `CountryPicker`; the job form, service-area and
trade pickers.

## 4. Legitimate native-control exceptions

| Control | Where | Why it stays |
|---|---|---|
| `<input type="date">`, `datetime-local` | availability windows, certificates, job form, order / RFQ / quotation dates, follow-ups, date-range filter, dashboard period | System calendars. We do not rebuild date pickers. |
| `<input type="range">` | lifecycle progress, avatar crop, opportunity filters, image crop | System slider. |
| `<input type="file">` | uploads | System file chooser. |
| `<details>` / `<summary>` | completed follow-ups, join-request history, supply-board lead rows, follow-up form, landing FAQ | In-flow disclosure: it expands the page and floats over nothing, so there is nothing to clip. |
| Installer / workspace **sidebar mode menu** | `installer-sidebar.tsx`, `sidebar-shell.tsx` | Opens on hover / focus timers (not a click menu). It is already a `position: fixed` portal on `document.body` using `menuSurfaceClass`, so it cannot be clipped. |

## 5. Known limits

* Without JavaScript the visible control cannot be operated (the carrier is hidden). Like every other owned menu in the
  product, a `Select` requires client JavaScript; the app does not work without hydration anyway.
* A menu (`role="menu"`) opened with the pointer leaves focus on its trigger; Arrow keys act once focus is in the menu
  (listboxes focus the chosen option on open). This is the existing `FloatingMenu` behaviour and is unchanged.
* jsdom resets a form from the `selected` attribute, while React's `defaultValue` sets a property that real browsers
  reflect, so `form.reset()` restoration is verified in the real-browser pass, not in jsdom.
