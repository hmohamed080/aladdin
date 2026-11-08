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

/** True only for the exact Acceptance preview origin (scheme, host and port). */
export function isPreviewOrigin(url) {
  try {
    return new URL(url).origin === ACCEPTANCE_PREVIEW_ORIGIN;
  } catch {
    return false;
  }
}

/** The Access headers for `url`: both headers on the exact preview origin, and an EMPTY object for any other URL. */
export function accessHeadersFor(url, creds) {
  return isPreviewOrigin(url) ? { "CF-Access-Client-Id": creds.id, "CF-Access-Client-Secret": creds.secret } : {};
}

/** True when a request/redirect target is a Cloudflare Access login page rather than the app. */
export function isAccessLogin(url) {
  try {
    return /(^|\.)cloudflareaccess\.com$/i.test(new URL(url).hostname);
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
    problems.push(isAccessLogin(location ?? "") || !location
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
