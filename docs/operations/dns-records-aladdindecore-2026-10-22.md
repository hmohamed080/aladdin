# DNS records for aladdindecore.com: export of 2026-10-22

**Purpose.** A complete, read-only export of the Vercel DNS zone for `aladdindecore.com`. It is the input to stage 9 and stage 10 of the [Cloudflare cutover plan](cloudflare-frontend-cutover-plan.md) (DNS to Cloudflare with no traffic change). **Nothing was changed.** No record, nameserver or setting was edited in Vercel, Cloudflare or at the registrar.

**Source.** Vercel API `GET /v5/domains/aladdindecore.com/records` and `GET /v5/domains/aladdindecore.com`, team `aladdin8` (`team_vgK7KkDN2acni3UoIU05NAj3`), read on 2026-10-22. The API returned **11 records**, on one page (`pagination.next = null`).

## Zone facts

| Fact | Value |
|---|---|
| Nameservers (current and intended) | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` |
| Zone hosted by Vercel | yes (`zone: true`, `serviceType: zeit.world`) |
| Bought through Vercel | **no** (`boughtAt: null`, `renew: false`). The registrar is elsewhere and was not identified: Vercel does not report it, and this session cannot reach RDAP or WHOIS. The nameserver change in stage 10 happens **at that registrar**. |
| Nameservers last verified by Vercel | 2026-10-22 |
| Vercel CDN on the apex | `cdnEnabled: true` |

## Records

TTL is in seconds. "System" records are created and managed by Vercel and "may change without notice". On Cloudflare they become ordinary records that we own.

| # | Name | Type | Value | Priority | TTL | Created by | On Cloudflare |
|---|---|---|---|---|---|---|---|
| 1 | `@` | ALIAS | `cc39f6c51d632b81.vercel-dns-017.com` | | 60 | Vercel (system) | `CNAME @` (flattened at the apex), **DNS only** |
| 2 | `*` | ALIAS | `cname.vercel-dns-017.com.` | | 60 | Vercel (system) | `CNAME *`, **DNS only** |
| 3 | `@` | CAA | `0 issue "letsencrypt.org"` | | 60 | Vercel (system) | keep |
| 4 | `@` | CAA | `0 issue "sectigo.com"` | | 60 | Vercel (system) | keep |
| 5 | `@` | CAA | `0 issue "pki.goog"` | | 60 | Vercel (system) | keep, and add `0 issue "ssl.com"` (see flag 4) |
| 6 | `@` | TXT | `zoho-verification=zb07162153.zmverify.zoho.com` | | 60 | owner | keep (TXT is never proxied) |
| 7 | `@` | MX | `mx.zoho.com.` | 10 | 3600 | owner (Zoho preset) | keep, **DNS only** (MX cannot be proxied) |
| 8 | `@` | MX | `mx2.zoho.com.` | 20 | 3600 | owner (Zoho preset) | keep, **DNS only** |
| 9 | `@` | MX | `mx3.zoho.com.` | 50 | 3600 | owner (Zoho preset) | keep, **DNS only** |
| 10 | `@` | TXT | `v=spf1 include:zohomail.com ~all` | | 60 | owner | keep exactly |
| 11 | `zmail._domainkey` | TXT | `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDL2qUNcu28JcKcOjSxk90Tx3KTNViF6tIZ00e5W1QRDyAXAVnjNahie0rHaqYCg8Ulq3Llgpeo3B4f7IXBmbPjkjW9XAPMp4f14u556NR3dyf0MCgAcAf+OSTs6BQ1PltepaggSs8Cm4RbA2pH1KLhVe/QXTLVPyQ19Pt2gcQtcQIDAQAB` | | 60 | owner | keep exactly, byte for byte |

**Not present** (asked for, or expected, but the zone does not have them):

- **No DMARC record** (`_dmarc.aladdindecore.com`). Only SPF and DKIM exist. See flag 6.
- **No explicit `www` record.** `www.aladdindecore.com` resolves through the wildcard (record 2).
- **No records for another mail sender** (Resend, Supabase custom SMTP, Google). Only Zoho is set up for mail.
- No AAAA, SRV, NS-delegation or `backend`/`media`/`next` subdomain records yet. The [cutover plan](cloudflare-frontend-cutover-plan.md) adds `next`, `backend` and `media` later, each with its own approval.

## BIND zone snippet (ready to import, every record DNS only)

Import it in Cloudflare at **dash.cloudflare.com → aladdindecore.com → DNS → Records → Import and Export → Import DNS records**. **Clear the "Proxy imported DNS records" box.** If it is left on, Cloudflare proxies the apex and the wildcard as they are imported (flag 1). After the import, check that every `CNAME` shows the grey cloud ("DNS only").

The two Vercel `ALIAS` records are written as `CNAME`, because `ALIAS` is not a standard record type. Cloudflare accepts a `CNAME` at the apex and flattens it. If an importer refuses it, use `@ 60 IN A 76.76.21.21` instead: this is Vercel's documented apex address for external DNS.

```
$ORIGIN aladdindecore.com.
$TTL 3600
; Exported from Vercel DNS (team aladdin8) on 2026-10-22. 11 records.
; Import with "Proxy imported DNS records" OFF. All records stay DNS only until stage 12.

; Web: still Vercel. Was ALIAS (Vercel system records).
@                 60    IN  CNAME  cc39f6c51d632b81.vercel-dns-017.com.
*                 60    IN  CNAME  cname.vercel-dns-017.com.

; Certificate authorities. The first three were Vercel system records.
@                 60    IN  CAA    0 issue "letsencrypt.org"
@                 60    IN  CAA    0 issue "sectigo.com"
@                 60    IN  CAA    0 issue "pki.goog"
; Added for Cloudflare certificates (flag 4). Remove this line for an exact copy.
@                 60    IN  CAA    0 issue "ssl.com"

; Mail: Zoho. MX and TXT records cannot be proxied.
@               3600    IN  MX     10 mx.zoho.com.
@               3600    IN  MX     20 mx2.zoho.com.
@               3600    IN  MX     50 mx3.zoho.com.
@                 60    IN  TXT    "v=spf1 include:zohomail.com ~all"
@                 60    IN  TXT    "zoho-verification=zb07162153.zmverify.zoho.com"
zmail._domainkey  60    IN  TXT    "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDL2qUNcu28JcKcOjSxk90Tx3KTNViF6tIZ00e5W1QRDyAXAVnjNahie0rHaqYCg8Ulq3Llgpeo3B4f7IXBmbPjkjW9XAPMp4f14u556NR3dyf0MCgAcAf+OSTs6BQ1PltepaggSs8Cm4RbA2pH1KLhVe/QXTLVPyQ19Pt2gcQtcQIDAQAB"
```

The DKIM value is 234 characters, under the 255-character limit for one TXT string, so it needs no splitting.

## What Cloudflare proxying would break (flags)

1. **The apex and the wildcard must stay DNS only until stage 12.** If they are proxied (orange cloud) while they still point at Vercel, Cloudflare's edge sits in front of Vercel's. Vercel then can't renew its certificates through its HTTP challenge, its edge sees Cloudflare instead of the visitor, and there are two layers of caching and TLS. The import tool proxies `A`, `AAAA` and `CNAME` records by default when its "Proxy imported DNS records" box is on: clear it.
2. **The wildcard sends every subdomain to Vercel.** `www`, every typo and every future subdomain resolve to Vercel today. On Cloudflare the wildcard stays DNS only. A specific record (`next`, `backend`, `media`) overrides it, so new subdomains must be explicit records. A proxied wildcard would put every unknown subdomain behind the Worker routes.
3. **Mail must stay DNS only.** MX records can't be proxied and point at `zoho.com` hosts, which is correct. If a mail host record is ever added under this domain (for example an `A` or `CNAME` for `mail`, `smtp`, `imap` or `autodiscover`), it must be DNS only, because Cloudflare's proxy only carries HTTP(S) and mail would stop. SPF (record 10), the Zoho verification (record 6) and DKIM (record 11) are TXT records, which are never proxied. They must be copied exactly: one changed character in the DKIM key fails every signed message.
4. **CAA must allow Cloudflare's certificate authorities, not only Vercel's.** The zone lists Let's Encrypt, Sectigo and Google Trust Services (`pki.goog`). Cloudflare's Universal SSL and Workers Custom Domains issue from Let's Encrypt, Google Trust Services or SSL.com. With CAA present and `ssl.com` missing, issuance through SSL.com would fail. Cloudflare says it adds the CAA records it needs when Universal SSL is on; adding `ssl.com` explicitly removes the doubt. It is the only intentional difference from the Vercel export.
5. **Vercel's system records are Vercel's to change.** Records 1 to 5 "may change without notice" while the zone is on Vercel. Re-export right before stage 10 and compare. After the move, the targets `cc39f6c51d632b81.vercel-dns-017.com` and `cname.vercel-dns-017.com` are ours to keep current. Vercel's generic targets (`76.76.21.21` for the apex, `cname.vercel-dns.com` for subdomains) are the fallback.
6. **There is no DMARC record.** This is a gap today, not something the move breaks. Receivers apply no policy to forged mail from `@aladdindecore.com`. Adding `_dmarc TXT "v=DMARC1; p=none; rua=mailto:<owner mailbox>"` is a separate owner decision. It is not part of this move, and the export does not add it.
7. **DNSSEC.** Vercel DNS does not sign the zone, so there is probably no DS record at the registrar. Confirm this at the registrar before stage 10. A stale DS record pointing at the old zone makes the whole domain fail to resolve on validating resolvers.
8. **TTLs are short (60 s) except MX (3600 s).** This helps: once the nameservers move, individual records can be changed fast. The nameserver change itself follows the `.com` delegation TTL (48 h), not these values.

## Related

- [Cloudflare cutover plan](cloudflare-frontend-cutover-plan.md): stages 9, 10 and 12.
- [Credentials checklist](cloudflare-credentials-checklist.md): the token for the DNS stage (Zone DNS Edit, issued only at that stage).
- [ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md): why the zone has to move.
