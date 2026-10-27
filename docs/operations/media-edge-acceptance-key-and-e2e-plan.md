# Media edge (Acceptance): signing key and E2E plan

Status 2026-10-26: **prepared, not executed.** Acceptance only (Cloudflare account
`a4c2b7ac45e58a81691b9165492ce6a2`, Supabase `nxossqhdfltcqdwvbewi`, bucket
`aladdin-r2-acceptance-20261011-private`). Nothing here touches Production, DNS,
Production R2 or `aladdindecore.com`. Running the key script and enabling
`MEDIA_EDGE_DELIVERY_ENABLED` each need a separate owner GO.

## 1. What the key script does

`scripts/hosted-db/media-edge-ticket-key.mjs` (Node 20+, no `pnpm install`) generates one
256-bit key in memory and installs it as:

| Worker | Secret | Value | Read by |
|---|---|---|---|
| `aladdin-media-edge-preview` | `TICKET_KEYS` | `{"<kid>":"<base64url 32 bytes>"}` | `edge/media-worker/src/ticket.ts` `parseTicketKeys` |
| `aladdin-frontend-preview` | `MEDIA_EDGE_TICKET_SECRET` | the same base64url string | `frontend/src/lib/env/storage.ts`, `edge-ticket.ts` |
| `aladdin-frontend-preview` | `MEDIA_EDGE_TICKET_KID` | `k` + UTC `yyyymmddhhmm` (13 chars, not secret) | same |

Modes: no argument = **checks only**; `--apply` installs a new key; `--verify` lists secret
names; `--remove` deletes the three secrets. The two Worker names, the account id, the
bucket and the Hyperdrive id are constants in the file; any extra argument is refused.

Before any write it fails closed unless **all** of these hold:

- the token is `active`, has an expiry, and expires within 24 hours;
- the token sees exactly one account, and it is `a4c2b7ac…6a2`;
- the token is **refused** when it lists R2 buckets and Hyperdrive configs (it should hold
  only *Workers Scripts: Edit*);
- both Workers exist;
- `aladdin-media-edge-preview` binds `MEDIA_BUCKET` to the Acceptance private bucket and
  `HYPERDRIVE` to `163eb6ad3a4c4b89840b28983999b995`;
- `aladdin-frontend-preview` has `NEXT_PUBLIC_SUPABASE_URL = https://nxossqhdfltcqdwvbewi.supabase.co`
  and `R2_PRIVATE_BUCKET` = the Acceptance bucket, does not have
  `MEDIA_EDGE_DELIVERY_ENABLED=true`, and has no plain variable named like the two secrets;
- no binding on either Worker mentions the Production project ref or `aladdindecore.com`;
- the owner types `install` (or `remove`).

Install order is media Worker first, then the frontend secret, then the frontend key id.
After writing it lists the secret names again (the API never returns values).

## 2. Security review

| Concern | How it is handled | Residual risk |
|---|---|---|
| Key on screen, in logs, on disk | Never printed. Errors pass through a redactor that replaces the token, the key and the JSON with `<hidden>` (tested with an API error that echoes the value). Nothing is written to disk. | Node strings cannot be zeroed; the key stays in process memory until exit (seconds). The random `Buffer` is zeroed after encoding. |
| Key on a command line | Not used: the key goes only into the JSON body of HTTPS PUTs. No `wrangler secret put` (which would also be fine for stdin, but needs wrangler login state). | None. |
| Token exposure | Read from `CF_MEDIA_KEY_TOKEN` (entered with `read -rs`: no echo, no history), deleted from the process environment at start, never printed, never in source or GitHub Actions. | The variable lives in the owner's shell until `unset`; the instructions end with `unset` and deleting the token. |
| Token scope and life | Checked from outside: expiry ≤ 24 h, exactly the Aladdin account, R2 and Hyperdrive refused. | Cloudflare does not let a token list its own permissions without extra rights, so "Workers Scripts: Edit only" is inferred from the two refusals, not proven. |
| Wrong target | Names fixed in code; settings of both Workers checked against Acceptance resources; Production markers refuse the run. | A future Worker renamed to one of these names would still have to pass the binding checks. |
| Transport | Refuses `NODE_TLS_REJECT_UNAUTHORIZED=0` and any `NODE_OPTIONS`; warns on `NODE_EXTRA_CA_CERTS`; test API only on loopback http. | A compromised local machine is out of scope. |
| Partial failure | Stops at the first failed PUT and says exactly which secrets already changed. A rerun installs a fresh key on all three. | Between a partial run and the rerun the two sides disagree; private edge media answers 404 (fail closed), and delivery is off anyway. |
| Key strength / format | 32 bytes from `crypto.randomBytes`; base64url; kid matches `^[a-z0-9]{1,16}$`. A ticket minted the app's way with these values verifies in the Worker's own `verifyTicket`; a tampered, expired or other-key ticket does not. | None found. |

## 3. Does this create Worker versions or affect running previews?

Yes, it creates versions. Per Cloudflare's docs, changing a secret through the API (or
`wrangler secret put`) **creates a new Worker version with the same code and deploys it to
100% immediately**:

- `--apply` creates **3 versions**: 1 on `aladdin-media-edge-preview`, 2 on `aladdin-frontend-preview`.
- `--remove` creates 3 more. `--check` and `--verify` create none.
- Requests already running finish on the old version; new requests use the new one within
  seconds. Isolates restart, so in-memory caches reset.
- **No visible change while edge delivery is off:** the app reads the ticket secrets only
  when `MEDIA_EDGE_DELIVERY_ENABLED=true` (`edgeConfig()`), and the media Worker keeps
  answering 404 to anything without a valid ticket. Page rendering, sign-in and the
  application media proxy are untouched.
- Later code deploys (the GitHub workflows) **keep** existing secrets. A deploy would fail
  only if someone added a plain var with the same name, which the script also refuses.
- If either Worker is mid-way through a gradual deployment, Cloudflare refuses the secret
  change; the script stops and reports it.
- Older version preview URLs keep their old (empty) secrets.

## 4. Exact execution (for later, after GO)

Windows Git Bash, repository root, on a checkout that contains this commit:

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom:
   permission **Account › Workers Scripts › Edit**, account resource **only** the Aladdin
   account, TTL ending **today**. No other permissions.
2. Run the checks (changes nothing):
   ```bash
   unset NODE_OPTIONS NODE_TLS_REJECT_UNAUTHORIZED
   read -rsp 'Cloudflare API token: ' CF_MEDIA_KEY_TOKEN; echo; export CF_MEDIA_KEY_TOKEN
   node scripts/hosted-db/media-edge-ticket-key.mjs
   ```
   Expected: "Token: active…", "Targets: …Acceptance resources only…", three lines
   `… MISSING`, then "Checks passed. Nothing was changed."
3. Install:
   ```bash
   node scripts/hosted-db/media-edge-ticket-key.mjs --apply
   ```
   Type `install`. Expected: three `set …` lines, three `… installed` lines, and
   "Done. Key id k2026… is installed on both Workers. Edge delivery is still OFF."
4. Clean up: `unset CF_MEDIA_KEY_TOKEN; clear`, then delete the token in the dashboard.
5. Paste the output (it holds no secrets) or just the key id in the thread.

## 5. Recovery and rotation

- **A run stopped half-way:** rerun `--apply` (fresh key on all three). If the token
  expired, make a new one.
- **Key suspected exposed, delivery off:** rerun `--apply`. Done.
- **Key suspected exposed, delivery on:** rerun `--apply` immediately. Tickets already handed
  out (≤ 120 s) and requests in the seconds between the PUTs answer 404, so some images
  reload on the next render. No data changes.
- **Planned rotation:** same as above, preferably with delivery off. The script cannot keep
  the old key alongside the new one, because secret values cannot be read back.
  Zero-gap rotation (the README's `k1`+`k2` step) would need the old key re-entered or a
  second key slot, which is a later change if Production needs it.
- **Remove everything:** turn `MEDIA_EDGE_DELIVERY_ENABLED` off first (otherwise the
  frontend's config check fails when it is on but the key is missing), then `--remove`.
  The media Worker then answers 404 to everything private.
- **Back to the application proxy:** `MEDIA_EDGE_DELIVERY_ENABLED=false` on the frontend
  preview (§6 R).

## 6. Acceptance E2E plan (before enabling edge delivery)

### Fixtures that exist now (read-only check, 2026-10-26)

| What | Acceptance state |
|---|---|
| `media_storage_locations` provider `r2` | 9 rows: 3 avatar + 6 portfolio, **all** with `verified_at` and `sha256`, none cleaned, all owned by one user, created 2026-10-25 |
| `portfolio_items` | 6, all `ready`, all on R2 |
| Auth users | 2 test users: one owns all 9 objects (A), one owns none (B) |
| Auth sessions | 0 (tests sign in fresh) |
| Organizations | 1 |
| Videos | 0 (video routes are off on the preview) |
| `media_edge_authorize` | present |

So the read-only cases can use the existing objects. **Destructive cases (delete,
unpublish) must not use them:** user A uploads fresh fixtures through the preview app
first (the normal upload path writes R2 + a verified receipt), and the tests use and
remove those. No SQL seeding of the hosted project. The objects themselves are not
listed here (no R2 read rights in this session); case 0 below proves they are present.

### Switch-on (separate GO)

Frontend preview vars: `MEDIA_EDGE_ORIGIN=https://aladdin-media-edge-preview.bstalent9.workers.dev`,
`MEDIA_EDGE_DELIVERY_ENABLED=true`, `MEDIA_EDGE_PUBLIC_ENABLED=false` (private first),
then a frontend preview redeploy.

### Cases

Each case records status code, `cache-control`, `content-type`, and body SHA-256.

| # | Case | Steps | Expected |
|---|---|---|---|
| 0 | Baseline (delivery **off**) | A opens profile and portfolio | Images load from the app proxy; SHA-256 of each body equals its `media_storage_locations.sha256` |
| 1 | Valid ticket | Delivery on; A opens the same pages | `<img>` URLs point at the media Worker with `?t=`; 200; correct `content-type`; body SHA-256 equals the verified receipt; `cache-control: private, no-store, max-age=0` |
| 2 | Variants | Request `thumb`, `card`, `full` where generated | 200 with the variant's own receipt, or the uniform 404 if that variant has no verified row |
| 3 | Invalid ticket | Garbage `t`, missing `t`, unknown kid, wrong segment count | Uniform 404 (same body, headers, CSP) |
| 4 | Tampered ticket | Change one payload char, MAC char, or swap `k`/`ns`/`var`/`sub` and keep the MAC | Uniform 404 |
| 5 | Expired ticket | Reuse a URL after 130 s; ticket with `exp` > now + 125 s | Uniform 404 |
| 6 | Unauthorized user | Anonymous request to A's private URL path without a ticket | Uniform 404 |
| 7 | Cross-account | B signs in; replays A's ticket; and B's own ticket with A's object key spliced in | 404 both (MAC fails, or `media_edge_authorize` denies) |
| 8 | Sign-out | A copies a fresh URL, signs out, requests it within 120 s | 404 (session gone in `auth.sessions`) |
| 9 | Session revocation | A signs in on two browsers, revokes the other session (or admin revokes); replay that session's URL | 404 |
| 10 | Image deletion | A uploads fixture F, copies its edge URL, deletes F; request within 120 s | 404 on the next request (authorization fails at once; R2 cleanup follows the normal purge path) |
| 11 | Unpublishing | A uploads portfolio fixture P, publishes, unpublishes (or changes audience); replay | 404 for anyone not now authorized |
| 12 | Database errors fail closed | Temporarily point the media Worker at a Hyperdrive id that cannot connect (preview only, revert after) **or** run the Worker unit test for the DB-error path | 404 (never 200, never 5xx with details); no bytes served |
| 13 | No unauthorized caching | For every 200 and 404: `cache-control: private, no-store, max-age=0`; no `Age`/`CF-Cache-Status: HIT` on a second request by B; Worker code path for the Cache API is a no-op on workers.dev | As stated |
| 14 | R2 integrity | For every 200 in cases 1–2: body SHA-256 = receipt `sha256`, `content-length` = `size_bytes`; an R2 object without a verified receipt (fresh upload interrupted before verification) is 404 | As stated |
| 15 | Headers | All responses carry the sandbox CSP and `x-content-type-options: nosniff` | As stated |
| R | Rollback to app proxy | Set `MEDIA_EDGE_DELIVERY_ENABLED=false`, redeploy frontend preview, reload pages | `<img>` URLs are app-proxy URLs again; case 0 passes; old edge URLs expire within 120 s |

Pass criteria: every case as expected, the media Worker logs show no 5xx, and rollback R
passes. Then delivery goes back off until the owner decides otherwise.
