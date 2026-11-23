// Cloudflare Access service-token support for the hosted Acceptance E2E (plain ESM so the workflow preflight can run it
// with node and Playwright/vitest can import it; types are in access.d.mts).
//
// The preview Worker sits behind Cloudflare Access. The service token is attached ONLY to requests whose origin is exactly
// the Acceptance preview origin. It is never set as a global header, never sent to any other host (Supabase, Turnstile,
// the Access login page, a Production host), and never forwarded on a redirect (maxRedirects 0 / redirect "manual").
// Everything fails closed: a missing credential, or an Access login redirect instead of the app, is an error.

import { pathToFileURL } from "node:url";

export const ACCEPTANCE_PREVIEW_ORIGIN = "https://aladdin-frontend-preview.bstalent9.workers.dev";
export const ID_ENV = "ACCEPTANCE_E2E_ACCESS_CLIENT_ID";
export const SECRET_ENV = "ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET";

/** Reads both credentials; throws (never echoing a value) if either is missing or blank. */
export function readAccessCredentials(env) {
  const id = (env[ID_ENV] ?? "").trim();
  const secret = (env[SECRET_ENV] ?? "").trim();
  const missing = [];
  if (!id) missing.push(ID_ENV);
  if (!secret) missing.push(SECRET_ENV);
  if (missing.length) {
    throw new Error(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing from the GitHub acceptance-e2e Environment: the Acceptance preview is behind Cloudflare Access.`);
  }
  return { id, secret };
}

/** An error message safe for logs and the uploaded artifact: first line only (Playwright's call log lists request headers), credential values removed. */
export function scrubError(error, creds) {
  let text = String((error && error.message) ?? error).split("\n")[0] ?? "";
  for (const v of [creds.id, creds.secret]) if (v) text = text.split(v).join("[redacted]");
  return text.slice(0, 300);
}

/** True only for the exact Acceptance preview origin (scheme, host and port). `origin` is overridable for the local browser test only. */
export function isPreviewOrigin(url, origin = ACCEPTANCE_PREVIEW_ORIGIN) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** The Access headers for `url`: both headers on the exact preview origin, and an EMPTY object for any other URL. */
export function accessHeadersFor(url, creds, origin = ACCEPTANCE_PREVIEW_ORIGIN) {
  return isPreviewOrigin(url, origin) ? { "CF-Access-Client-Id": creds.id, "CF-Access-Client-Secret": creds.secret } : {};
}

/**
 * Browser routing for a Playwright context. Verified in real Chromium: `route.continue({headers})` makes the overridden
 * headers FOLLOW a redirect to another origin, so it must not be used. Instead the in-scope request is performed with
 * `route.fetch({maxRedirects: 0})` and the answer (a 3xx included) is handed back with `route.fulfill`: the browser then
 * follows the redirect itself as a NEW request, which is routed again and receives the token only if it is, once more, the
 * exact preview origin. A redirect (or any request) to a Cloudflare Access login host is aborted and reported.
 */
export async function installAccessRouting(context, creds, { origin = ACCEPTANCE_PREVIEW_ORIGIN, onViolation = () => {} } = {}) {
  // ORDER MATTERS: Playwright runs the most recently registered matching route first. The credential route is registered
  // FIRST and the Access-login blocker LAST, so the blocker wins for every request that is an Access login, including the
  // same-origin /cdn-cgi/access/* paths that the preview-origin route also matches. A login endpoint must never get the token.
  await context.route((url) => isPreviewOrigin(url.href, origin), async (route) => {
    const url = route.request().url();
    if (isAccessLogin(url)) {
      // Defence in depth: unreachable while the blocker below is registered after this route.
      onViolation(`Cloudflare Access login request (${new URL(url).host}${new URL(url).pathname.split("/").slice(0, 3).join("/")})`);
      return route.abort();
    }
    // route.fetch's error text embeds a call log that lists the request headers, i.e. BOTH Access credentials (reproduced in
    // real Chromium). Never let it escape: record a scrubbed first line and fail the request instead.
    let response;
    try {
      response = await route.fetch({ headers: { ...route.request().headers(), ...accessHeadersFor(url, creds, origin) }, maxRedirects: 0 });
    } catch (e) {
      onViolation(`Access-routed request failed (${new URL(url).host}): ${scrubError(e, creds)}`);
      return route.abort();
    }
    const location = response.headers()["location"];
    if (response.status() >= 300 && response.status() < 400 && location && isAccessLogin(new URL(location, url).href)) {
      onViolation(`Cloudflare Access login redirect (${new URL(location, url).host})`);
      return route.abort();
    }
    return route.fulfill({ response });
  });
  await context.route((url) => isAccessLogin(url.href), (route) => {
    const u = new URL(route.request().url());
    onViolation(`Cloudflare Access login ${u.host === new URL(origin).host ? "request" : "redirect"} (${u.host})`);
    return route.abort();
  });
}

/**
 * True when a request/redirect target is a Cloudflare Access login page rather than the app: either a cloudflareaccess.com
 * host, or the same-origin /cdn-cgi/access/ path Access uses for a workers.dev application (seen on the hosted preview as
 * /cdn-cgi/access/login/<host>, which a host-only check missed).
 */
export function isAccessLogin(url) {
  try {
    const u = new URL(url);
    return /(^|\.)cloudflareaccess\.com$/i.test(u.hostname) || /^\/cdn-cgi\/access\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Judges the preflight response of GET <preview>/api/backend/health (fetched with redirect "manual").
 * Returns a list of problems; empty means: HTTP 200, JSON, backend service, env staging.
 */
export function judgePreflight({ status, location, contentType, body }) {
  const problems = [];
  if (status >= 300 && status < 400) {
    problems.push(!location || isAccessLogin(new URL(location, ACCEPTANCE_PREVIEW_ORIGIN).href)
      ? `Cloudflare Access answered ${status} with a login redirect: the service token is missing, wrong, expired or not authorised for the preview application.`
      : `the preview answered an unexpected redirect (${status}); expected HTTP 200.`);
    return problems;
  }
  if (status !== 200) problems.push(`the preview answered HTTP ${status}; expected 200.`);
  if (!/json/i.test(contentType ?? "")) problems.push("the preview did not answer JSON (an Access page or a wrong origin?).");
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    problems.push("the preview health body is not JSON.");
  }
  if (parsed && !(parsed.status === "ok" && parsed.service === "backend" && parsed.env === "staging")) {
    problems.push("the preview backend is not the Acceptance (staging) service.");
  }
  return problems;
}

/** Runs the preflight against the preview with the given credentials. `fetchImpl` is injectable for tests. */
export async function preflight(env, fetchImpl = fetch) {
  const creds = readAccessCredentials(env);
  const url = `${ACCEPTANCE_PREVIEW_ORIGIN}/api/backend/health`;
  const res = await fetchImpl(url, { redirect: "manual", headers: accessHeadersFor(url, creds) });
  const text = await res.text();
  return judgePreflight({ status: res.status, location: res.headers.get("location"), contentType: res.headers.get("content-type"), body: text });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preflight(process.env).then(
    (problems) => {
      for (const p of problems) console.error(`::error::${p}`);
      if (problems.length) process.exit(1);
      console.log("Preview answered through Cloudflare Access: backend ok, env staging.");
    },
    (e) => {
      console.error(`::error::${e.message}`);
      process.exit(1);
    },
  );
}
