# Professional Asset Storage — Security Contract

**Status:** **Implemented** · Installer Pilot Increment 10 · `feature/installer-pilot`
**Migration:** `supabase/migrations/20260906090001_professional_asset_storage.sql`
**Tests:** `supabase/tests/47_professional_asset_storage_test.sql` (67) ·
`supabase/tests/professional_asset_storage_api_test.mjs` (43)

This is the storage foundation [`installer-jobs.md` §14.3](installer-jobs.md) required before any
Portfolio or Certificate UI (**D5**). It stores bytes and answers one question:

> May **this** person put **this** object here, read it back, and remove it?

**Increment 11 answers the other question** — what an object *means*: which photo is the cover, which
certificate is which, what appears on a public profile. None of that exists yet, deliberately (§16).

It is **narrower than "media storage"**. Chat attachments and job-progress photos have different
relationship semantics — a chat attachment is readable by a conversation, not by an owner — and
designing their authorization here would mean guessing at it. They may reuse the primitives later;
they are not covered by anything below.

---

## 1. Buckets

| Bucket | Public | Size limit | Content types |
|---|---|---|---|
| `professional-portfolio` | **No** | **5 MiB** (5 242 880) | `image/jpeg`, `image/png`, `image/webp` |
| `professional-certificates` | **No** | **10 MiB** (10 485 760) | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` |

Both are created by migration and reconfigured on every replay (`on conflict do update`), so a bucket
flipped public by hand is flipped back by the next deploy. **No console step is required or
permitted** — deployment never depends on undocumented dashboard state.

### 1.1 Why two buckets rather than one with a namespace folder

Supabase enforces `allowed_mime_types` and `file_size_limit` **per bucket, in the Storage service**,
before Postgres is consulted. That enforcement point is unreachable from RLS: a policy on
`storage.objects` sees `metadata` as `NULL` at INSERT time, because the Storage service creates the
row first and fills in mimetype and size after the bytes land.

So in a single shared bucket, "certificates may be PDFs and portfolio may not" could only be stated by
the application — a rule a caller can skip. Two buckets put it where the caller cannot reach it.

The second reason is isolation. Each bucket has its **own three policies, written out separately**
rather than one policy matching `bucket_id in (...)`. Widening portfolio reads therefore requires a
second edit, in a diff that names certificates out loud.

### 1.2 The excluded formats, and why

* **SVG** — an image to a person, a scriptable document to a browser. Nothing in this repository
  sanitizes one, so it is refused until something does. A private bucket is not a defence: signed URLs
  serve real bytes to a real browser.
* **Video** — no transcoding, no player, no pipeline. Storing it would store something nothing can
  play.
* **HTML, executables, arbitrary binary** — never on either list.

### 1.3 Size rationale

5 MiB is one 12 MP phone photo with room to spare, and not an unprocessed burst or a raw export.
10 MiB covers a scan of a multi-page certificate, which is the large end of that namespace. Both are
well under the stack-wide `file_size_limit = "50MiB"` in `supabase/config.toml`, which is an outer
bound rather than a policy.

---

## 2. The object path contract

```
<owner-user-id>/<object-id>.<ext>
```

* `<owner-user-id>` — the owner's `auth.uid()`, **exactly**. Not a prefix, not a lookalike.
* `<object-id>` — a server-generated v4 UUID, fresh for every ticket.
* `<ext>` — `jpg` · `png` · `webp` · `pdf`, derived from the **validated content type**.

Enforced by `app.is_professional_asset_key(name, owner)`, which every one of the six policies calls:

```sql
split_part(p_name, '/', 1) = p_owner::text
and p_name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-…-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
```

The regex constrains the **shape**; the equality constrains the **value**. Only together do they mean
"yours".

### 2.1 The filename is deliberately absent

The original sketch was `<user-id>/<namespace>/<object-id>/<filename>`. Both middle pieces are gone:

* **the namespace**, because the bucket already is one, and two sources of truth for the same fact
  need their own consistency rule to stay honest;
* **the filename**, because a name that only ever gets displayed has no business being load-bearing in
  a security check.

What remains contains **no caller-controlled bytes at all**. That is what turns §15's attack list from
things to sanitize into things that cannot be expressed:

| Attack | Outcome | Why |
|---|---|---|
| another user's UUID | refused | first segment must *equal* `auth.uid()` |
| `../`, `..`, `%2e%2e` | refused | neither segment's charset contains `.` or `/`; the pattern is anchored, so there is exactly one separator |
| empty object name | refused | matches nothing |
| extra path segment | refused | anchored pattern permits one separator |
| display filename | refused | no segment accepts arbitrary text |
| `.svg`, `.jpg.html` | refused | closed extension list, anchored |
| uppercase hex | refused | keys cannot differ by case alone on a folding backend |
| owner-id prefix (`<uid>9/…`) | refused | equality, not `like`/`starts with` |
| trailing newline | refused | `$` matches end of string, not end of line |

The display name a person chose belongs to **Increment 11 metadata**, where being wrong is cosmetic.

---

## 3. Ownership

**User-level, always.** The first path segment is `auth.uid()` and nothing else participates:

* not organization membership,
* not showroom affiliation,
* not Sales affiliation,
* not a current or former employer.

An independent Installer owns the same files before, during and after every organization relationship,
and no relationship transfers, grants or revokes access. `47_…_test.sql` asserts this from the other
direction: an identity that holds a membership reads **zero** objects.

`storage.objects.owner` is **not** the authority. It is provider-managed and set differently by
different upload paths; the key is the contract, and all six policies derive ownership from it.

---

## 4. The professional persona gate

Creating a new professional asset requires `app.can_create_professional_asset()` — an argument-free
`security definer` wrapper over the internal `app.is_professional_persona(auth.uid())`.

**The wrapper exists so the predicate did not have to be widened.**
`app.is_professional_persona(uuid)` answers about *any* user id, so granting it to `authenticated`
would hand every signed-in account a persona oracle to walk over arbitrary ids. The wrapper reads
`auth.uid()` itself, so the only question it can answer is *"may I"* — which the caller already knows.
`app.is_professional_persona` stays revoked from every client role, and a test asserts that.

**Possession is not identity.** Holding a stored object never makes anyone a professional. A consumer
given an object directly (bypassing the policies) is still refused the next upload, and
`app.is_professional_persona` still returns false. Asserted, because the inference is tempting later.

---

## 5. Downgrade behaviour

Copied from `trg_stamp_availability` on purpose — same asymmetry, same reason.

| Operation | Consults the persona gate? |
|---|---|
| **INSERT** | **Yes** — no new professional uploads |
| **SELECT** | No — they keep reading their files |
| **DELETE** | No — they can always remove them |

A person who stops being a professional keeps every file they uploaded and keeps the ability to delete
it. **Personal data is never held hostage to a persona value.** Availability's rule was "claiming needs
the persona, withdrawing never does"; this is the same sentence about files.

Structurally asserted as well as observed: no SELECT or DELETE policy mentions
`can_create_professional_asset`, so there is no expression that *could* refuse them.

---

## 6. Upload authority

```
browser  →  createAssetUploadTicket(namespace, {type, size})       [server action]
         →  server derives <owner>/<uuid>.<ext> from auth.getUser()
         →  supabase.storage.createSignedUploadUrl(path)           [caller's own identity]
         →  Storage evaluates the INSERT policy, then signs
         →  browser uploads with the token
```

**Two enforcement points, one of which the browser cannot reach.**

1. **The signed upload token** binds bucket, key and `upsert: false` *inside the signature*. The
   browser holds an authorization to write exactly one object and cannot repoint it.
2. **RLS**, which is what actually decides. Minting the token is itself an authorized write — verified
   over HTTP: a consumer, a cross-user path and an anonymous caller are all refused
   `AccessDenied` **at the mint**, by the policy, with no persona check anywhere in the TypeScript.

**Service-role is never used.** Every call runs as the caller's own identity, so a bug in the server
seam widens nothing. The seam exists for a server-derived path, one place to change, and readable
errors — not for authority.

---

## 7. Read authority and signed URLs

`createAssetReadUrl(namespace, path)` is the single canonical reader (§11). It:

* re-derives the owner from the session and refuses any path that is not theirs, **before** asking
  Storage;
* takes a **namespace from a closed set of two**, never a bucket — so no caller can name
  `professional-certificates` while a portfolio surface believes it asked for a photo;
* mints a URL that lives **300 seconds**, per render, never stored;
* returns no credential of any kind.

There is no permanent public URL, and `GET /object/public/<bucket>/<key>` serves nothing from either
bucket.

**A refused read is indistinguishable from a key that never existed.** The SELECT policy hides the row
so completely that Storage answers `NoSuchKey` rather than "denied" — so no caller can learn whether
someone else's object exists by asking for it.

> **Known and accepted:** the *delete* path does distinguish them — `AccessDenied` for an existing
> object that is not yours, `NoSuchKey` for one that does not exist. Reaching that distinction requires
> already knowing a full random object id, so it discloses nothing the caller did not have. Recorded
> rather than glossed over, and asserted so a change in the behaviour is visible.

---

## 8. Delete authority

`deleteProfessionalAsset(namespace, path)` — one object, named in full, belonging to the caller.
**No folder form and no wildcard**, because the argument that enables a bulk delete is the same one
that enables someone else's.

**Idempotent by design:** `NoSuchKey` is folded into success. The caller asked for the object to be
gone and it is gone. This matters for Increment 11 specifically — cleaning up a metadata row and its
object is two steps, and a retry after a partial failure must converge rather than jam on the half
that already succeeded.

> **`storage.objects` refuses ALL direct SQL deletion**, for every role including superuser, via the
> `protect_objects_delete` trigger (Supabase's guard against orphaned bytes). The DELETE policies
> therefore govern exactly one path — the Storage API — which is why deletion is proved in the HTTP
> harness rather than in pgTAP.

---

## 9. Overwrite and replacement

**There is no UPDATE policy on `storage.objects`.** That absence *is* the rule:

* `upsert: true` is refused with `AccessDenied` — it asked for permission to replace a row and there
  was none to give;
* a second write to an existing key is `KeyAlreadyExists`;
* the signed upload token carries `upsert: false` inside its own signature.

Object keys are immutable. A replacement in Increment 11 is **a new object → a deliberate metadata
switch → cleanup of the old object**, never bytes changing underneath an identity something else
already points at.

---

## 10. What the Storage API test proves that SQL cannot

`professional_asset_storage_api_test.mjs` drives the real HTTP API with real bearer tokens, because
MIME and size are enforced in a different process from RLS. It also corrected two things that
introspection alone would have got wrong:

1. **Every refusal is HTTP 400.** The semantic code is in the body
   (`{"statusCode":"403","code":"AccessDenied"}`), so the HTTP status is identical for a policy denial,
   a rejected type, an oversized body and a duplicate key. A first draft asserting 403/415/413/409
   "failed" eleven times against a system refusing every attempt correctly.
2. **Direct SQL deletion is impossible**, so a pgTAP delete test would have passed for the wrong
   reason.

---

## 11. No metadata table (§16)

None was necessary, and none was created:

| What a registry would carry | Where it already lives |
|---|---|
| ownership | the object key, enforced by policy |
| namespace / type | the bucket |
| stable lookup | the key, which is immutable |
| lifecycle | Increment 11's concern, keyed by the same path |

A registry would duplicate all four and then need its own consistency rules to keep the duplicate
honest. Nothing here carries a title, caption, project, issuer, issue date, verification state,
visibility or sort order — **those are Increment 11 product metadata**, and a test asserts this module
exports only three helpers so one cannot arrive here first.

---

## 12. The Increment 11 seam

Preserved, not implemented.

A public portfolio record will become: **a product visibility decision → a server-authorized,
short-lived representation of one named object**. Nothing here pre-authorizes it — there is no broad
public SELECT on `storage.objects`, no policy admitting `anon`, and no bucket is public.

### 12.1 Decisions closed at Increment 10 approval (2026-09-06)

Four product decisions were taken when this foundation was approved. They are **closed**, and
Increment 11 implements rather than revisits them.

| | Decision |
|---|---|
| **S1** | **Portfolio items are private by default.** An item becomes public **only** through explicit visibility state on its Increment 11 metadata row. **The bucket stays private either way** — publication is a product fact recorded in Postgres, never a change to a bucket, a policy or an object. "Public" therefore means *a server will mint a representation for a viewer*, and never *anyone who guesses the URL can fetch it*. |
| **S2** | **Certificates are owner-private, self-declared evidence** for the Pilot. No verification authority is invented — no verified flag, no reviewer role, no platform attestation, and **no public read path of any kind**. A certificate is something a person holds, not something the platform vouches for. If verification is ever wanted, it arrives as its own decision with a named holder. |
| **S3** | **Metadata is the product authority; the object is a payload.** Increment 11 must **not** pretend Postgres and Storage are one transaction — they are two systems and no transaction spans them. Deletion converges: the metadata row is authoritative, object removal is idempotent (§8), and a retry after a partial failure completes rather than jamming. An object with no metadata row is garbage to be collected, not a record. |
| **S4** | **Public portfolio in the Pilot is JPEG/PNG/WebP only** — exactly the `professional-portfolio` list in §1, which is why that list needs no change. **Deeper byte-level and malware scanning is deferred as a separate server-hardening concern**, not a prerequisite for Increment 11. The signature check in `lib/storage/professional-assets.ts` remains what §1.2 and §10 already describe it as: a correctness net running in the caller's process, never a boundary. |

**What S1 and S2 together mean for the policies below: nothing changes.** Both are satisfied by the
foundation exactly as built — which was the point of refusing to widen anything here. The public read
path S1 describes is a *new server helper over an existing private bucket*, and S2's certificate rule
is the absence that already exists.

### 12.2 Still open for Increment 11

* the metadata tables themselves — portfolio items and certificates, each pointing at a
  `(bucket, path)` this contract already guarantees is stable and immutable;
* the shape of the server-authorized public representation under S1: how long it lives, whether it is
  minted per viewer or per render, and what a non-owner viewer's request looks like;
* the garbage-collection story S3 implies — when an object with no metadata row is swept, and by what;
* ordering and retry semantics at the call sites, given that the delete helper is already idempotent.

---

## 13. Files

| File | Role |
|---|---|
| `supabase/migrations/20260906090001_professional_asset_storage.sql` | buckets, two `app` helpers, six policies |
| `frontend/src/lib/storage/professional-assets.ts` | pure contract: namespaces, policy, key building, validation, signatures |
| `frontend/src/server/actions/professional-assets.ts` | the three helpers — ticket, read URL, delete |
| `frontend/src/server/actions/error-mapping.ts` | `mapAssetError` |
| `supabase/tests/47_professional_asset_storage_test.sql` | policies, key contract, absences, downgrade |
| `supabase/tests/professional_asset_storage_api_test.mjs` | MIME, size, overwrite, signed URLs, delete |
