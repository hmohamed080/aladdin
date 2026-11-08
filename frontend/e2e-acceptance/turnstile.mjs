// Turnstile stand-in for the hosted Acceptance E2E.
//
// Hosted Supabase Auth CAPTCHA protection is ON for Acceptance (docs/frontend/auth-captcha.md). A dummy token only gets past it
// when the project's Turnstile secret is Cloudflare's always-pass TEST secret (1x...AA pair); against a real secret Cloudflare
// rejects it. So the stub is allowed ONLY when the preview's site key is the documented always-pass TEST site key. For any
// other key the run fails closed with an actionable message. CAPTCHA is never disabled or bypassed.

export const ALWAYS_PASS_SITE_KEY = "1x00000000000000000000AA";
const ALWAYS_BLOCK_SITE_KEY = "2x00000000000000000000AB";
const FORCE_INTERACTION_SITE_KEY = "3x00000000000000000000FF";

/** @returns {"always-pass-test" | "always-block-test" | "interactive-test" | "real" | "missing"} */
export function classifySiteKey(siteKey) {
  if (typeof siteKey !== "string" || !siteKey.trim()) return "missing";
  const key = siteKey.trim();
  if (key === ALWAYS_PASS_SITE_KEY) return "always-pass-test";
  if (key === ALWAYS_BLOCK_SITE_KEY) return "always-block-test";
  if (key === FORCE_INTERACTION_SITE_KEY) return "interactive-test";
  return "real";
}

/** Injected in place of Cloudflare's api.js. Records which key the page asked for; answers only for the always-pass key. */
export const TURNSTILE_STUB = `(function(){var PASS=${JSON.stringify(ALWAYS_PASS_SITE_KEY)};window.__e2eTurnstile={sitekey:null,answered:false};window.turnstile={render:function(el,o){window.__e2eTurnstile.sitekey=(o&&o.sitekey)||"";if(o&&o.sitekey===PASS){window.__e2eTurnstile.answered=true;setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0)}return "acceptance-e2e"},remove:function(){},reset:function(){}};})();`;

/** Returns an error message when the stub must not be trusted for the key the page used, else null. */
export function judgeStubbedWidget(state) {
  if (!state || state.sitekey === null || state.sitekey === undefined) {
    return "The sign-in page never rendered a Turnstile widget, so no CAPTCHA token could be produced.";
  }
  const kind = classifySiteKey(state.sitekey);
  if (kind === "always-pass-test") return null;
  const why = {
    missing: "the preview rendered the widget without a site key",
    "always-block-test": "the preview uses Cloudflare's always-BLOCK test site key",
    "interactive-test": "the preview uses Cloudflare's forced-interaction test site key",
    real: "the preview uses a real Turnstile site key",
  }[kind];
  return (
    `Acceptance CAPTCHA is ON and ${why}, so this suite cannot supply a token Supabase Auth would accept (the stub is only valid for ` +
    `Cloudflare's always-pass test site key). The suite will not weaken CAPTCHA. Owner action: see docs/operations/ACCEPTANCE_E2E_CAPTCHA.md.`
  );
}
