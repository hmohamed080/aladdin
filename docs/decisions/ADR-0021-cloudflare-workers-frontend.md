# ADR-0021 — Next.js frontend on Cloudflare Workers (OpenNext), Vercel kept as rollback

**Status:** Proposed · 2026-10-20 · owner decision to migrate the frontend host ("migrate Aladdin's entire Next.js frontend hosting from Vercel to Cloudflare Workers, while keeping the existing Supabase, R2, Redis and FastAPI architecture"). **Needs owner approval** for every hosted step: the workers.dev preview, Workers Paid, the DNS move and the traffic switch ([cutover plan](../operations/cloudflare-frontend-cutover-plan.md)).

**Refines:** [ADR-0009](ADR-0009-vercel-services-deployment.md) (Vercel Services hosts both services). After cutover the **frontend** runs on Workers; **FastAPI stays on Vercel** as a separate service until its own migration is decided. [ADR-0001](ADR-0001-approved-architecture.md) is unchanged: still Next.js App Router built by `next build`, not Vite.

## Decision

1. **Adapter: OpenNext (`@opennextjs/cloudflare` 1.20.13)**, which runs the output of the real `next build` in the Workers runtime. Not vinext.
2. **Next.js 15.5.22 → 16.4.2** (owner decision, 2026-10-21). Next.js 15's two-year support window ended on 2026-10-21, and OpenNext refuses an unsupported version without an override flag. The owner chose the upgrade over the flag. See "Next.js 16 upgrade" below.
3. **Middleware runs on the Edge runtime on Workers** and stays on the Node runtime on Vercel. `pnpm cf:build` switches the one `runtime` line for the Workers build and restores it.
4. **One Worker entry (`frontend/cloudflare/worker.ts`)** wraps the OpenNext handler. It does what the Vercel platform did:
   - forwards `/api/backend/*` to `BACKEND_ORIGIN` (FastAPI), same path and headers, so browsers stay same-origin;
   - caches optimized `/_next/image` responses;
   - adds HSTS.
5. **Runtime-specific seams, chosen at build time, Node behaviour unchanged:**
   - images: sharp on Node, the Cloudflare Images binding on Workers;
   - Redis: TCP on Node, Upstash REST on Workers. TCP is refused on Workers, because a socket cannot be reused across requests there.
6. **Vercel stays deployable and untouched** until final acceptance. Both builds run in CI.

## Next.js 16 upgrade (2026-10-21)

What changed, for both hosts:
- **Bundler:** `next build` defaults to Turbopack in 16. The build stays on webpack (`next build --webpack`), because the Workers build swaps the image engine with a webpack plugin in `next.config.ts`. Moving to Turbopack is a separate change.
- **Middleware:** 16 deprecates `middleware.ts` in favour of `proxy.ts`, which is Node-only. The Workers build needs Edge middleware, so the file keeps its name; the build prints a deprecation warning only.
- **ESLint:** `eslint-config-next` 16 is a native flat config, so `FlatCompat` (`@eslint/eslintrc`) is gone. It also turns on the React Compiler rules of `eslint-plugin-react-hooks` 7. Code written before the upgrade breaks 44 of them, so they warn until a cleanup PR fixes them.
- **TypeScript:** `next build` set `jsx: "react-jsx"` and added `.next/dev/types` to `tsconfig.json`; `next-env.d.ts` now imports the route types.
- **No source changes were needed** for async request APIs, images, caching or routing: typecheck is clean and the 4,065 unit tests pass unchanged. React stays 19.2.8.

## Why OpenNext and not vinext

Both were tried on this app.

**OpenNext:**
- builds the real `next build` output;
- every route served in workerd after the fixes below;
- the existing E2E suites ran against it (results in the PR).

Cloudflare's docs list "Node.js in Middleware" as not supported by OpenNext. We therefore use Edge middleware, which this middleware already supports: it uses only WebCrypto, fetch and cookies.

**vinext 1.2.1** ran the app well in a time-boxed trial:
- sign-in through a Server Action worked;
- a 123-route sweep returned no 500s;
- fonts, i18n and images worked.

It was rejected for production because:
- it is beta and reimplements Next.js on Vite, so it replaces the compiler and runtime (against ADR-0001);
- its README targets Next.js 16;
- it bumped React to 19.3.1;
- it does not apply App Router strict mode;
- its init tooling generated a broken `sharp` alias.

Cloudflare now recommends vinext for *new* apps. We revisit it when it leaves beta.

## Incompatibilities found and how they are handled

| Area | On Workers | Handling |
|---|---|---|
| `sharp` (upload verification, WebP variants) | Native module, cannot load. A top-level import made 38 of 163 routes return 500 | Image engine seam. Workers verify with a structure check, then the free `info()`, then a full decode through the Images binding. Variants come from the binding. See [runtime notes](../architecture/cloudflare-workers-runtime-notes.md). |
| Node.js middleware | Experimental in OpenNext, unsupported by Cloudflare | Edge middleware for the Workers build only |
| `@redis/client` over TCP | Works within one request. A socket reused by a later request fails ("Cannot perform I/O on behalf of a different request") | Upstash REST transport ([ADR-0019](ADR-0019-redis-cache-and-rate-limits.md) Workers revision) |
| `vercel.json` rewrite of `/api/backend` | No equivalent | Worker entry proxy to `BACKEND_ORIGIN` |
| Platform HSTS, image cache, static cache headers | Not added by Workers | Worker entry and `_headers` |
| Fetch de-duplication within one render | Not applied to supabase-js on the Workers build | Explicit `cache()` loaders in the app (this also helps Node) |
| AWS S3 SDK and presigner, R2 multipart, pdf-lib, `node:crypto`, `Buffer` | Work under `nodejs_compat` | None |

## Consequences and costs

- **Workers Paid ($5/month) is required.** CPU per request is about the same as Node: 15–77 ms per page, Server Action, sign-in and session refresh. The Free plan allows 10 ms. Paid includes 30 M CPU-ms and 10 M requests a month, about 600 k signed-in page views; extra usage is cheap ($0.02 per M CPU-ms, $0.30 per M requests). See the [performance report](../operations/performance-cloudflare-2026-10-20.md).
- **Bundle:** 31 MiB uncompressed, under the 64 MiB limit on every plan.
- **Memory:** one isolate held about 96 MB after GC of the 128 MB limit under local load. Confirm on the preview.
- **Images:** the Free plan has 5,000 unique transformations a month. That covers `next/image` for the app's static files plus about 1,600 R2 photo uploads (3 each). When it runs out, new uploads fail clearly (error 9422) and nothing is charged. Images Paid costs $0.50 per 1,000 after that.
- **Supabase stays on Free.** Query counts per page are equal or lower than on Node.
- **Vercel:** stays on its current plan for FastAPI and as the rollback until acceptance.
- **DNS** must move to Cloudflare before a Worker can serve `aladdindecore.com`. This also unblocks `media.aladdindecore.com`.

## Not decided here

- The cutover itself.
- When to retire the Vercel frontend.
- The FastAPI migration (not before R2 is stable).
- Cloudflare Stream (still a future provider, ADR-0020).
