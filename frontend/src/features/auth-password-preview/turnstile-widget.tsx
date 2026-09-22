"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark";
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

// Cloudflare's own published, publicly documented TEST site keys — both
// always pass, pairing with the equally-published always-pass TEST secret
// key configured in `supabase/config.toml`'s `[auth.captcha]` (local only).
// Never real keys, never used as a fallback anywhere hosted — see
// docs/frontend/auth-password-preview.md §CAPTCHA.
//   - VISIBLE:   renders a small interactive checkbox widget.
//   - INVISIBLE: Cloudflare's "non-interactive" mode — solves silently, no
//     visible challenge UI. Used ONLY on Sign In (see that section's doc
//     comment for why Sign In needs a token at all despite staying
//     frictionless).
const TEST_SITE_KEY_VISIBLE = "1x00000000000000000000AA";
const TEST_SITE_KEY_INVISIBLE = "1x00000000000000000000BB";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptLoadPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/**
 * Cloudflare Turnstile, wired to Supabase's native `captchaToken` verification
 * (GoTrue verifies server-side against the SECRET configured in
 * `[auth.captcha]` — this component never sees or needs that secret).
 *
 * `variant="visible"` (default): a small interactive checkbox widget, used on
 * Create Account and Forgot Password request — the two abuse-sensitive
 * public endpoints this preview touches.
 *
 * `variant="invisible"`: Cloudflare's non-interactive mode, used ONLY on Sign
 * In. **Found empirically, not a design choice**: Supabase's `[auth.captcha]`
 * is a single project-wide GoTrue toggle with no per-endpoint scoping —
 * enabling it to protect signup/recovery ALSO makes GoTrue's own
 * `grant_type=password` endpoint reject `signInWithPassword` outright with
 * `captcha_failed` if no token is attached at all (confirmed directly against
 * local GoTrue). There is no way to keep Sign In "unprotected" at the
 * Supabase-config level while protecting the other two. The invisible variant
 * is how Sign In keeps its promised zero added friction (no visible
 * challenge, no extra click) while still satisfying GoTrue's mandatory,
 * all-or-nothing requirement — see
 * docs/frontend/auth-password-preview.md §CAPTCHA for the full writeup.
 *
 * Either way, renders a hidden `name="captchaToken"` input the surrounding
 * form submits normally. A Turnstile token is single-use: if the server
 * action rejects the submission for an UNRELATED reason (weak password,
 * invalid email, ...), the already-spent token would make the NEXT submit
 * fail Supabase's captcha check even though the user did nothing wrong. The
 * parent form is expected to change `resetKey` (e.g. to the server action's
 * own result object) after any submission, which remounts this component and
 * requests a fresh token.
 */
export function TurnstileWidget({ resetKey, variant = "visible" }: { resetKey?: unknown; variant?: "visible" | "invisible" }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const inputId = useId();

  // A REAL Cloudflare site key's widget mode (managed/non-interactive/
  // invisible) is fixed on Cloudflare's dashboard when the key is created —
  // not selectable per-call — so staging/production need TWO real site keys,
  // one created in each mode, if Sign In's invisible check is promoted
  // alongside Create Account / Forgot Password's visible one.
  const testKey = variant === "invisible" ? TEST_SITE_KEY_INVISIBLE : TEST_SITE_KEY_VISIBLE;
  const realKey =
    variant === "invisible"
      ? process.env.NEXT_PUBLIC_TURNSTILE_INVISIBLE_SITE_KEY
      : process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const siteKey = realKey || testKey;

  useEffect(() => {
    let cancelled = false;
    setToken("");
    setFailed(false);

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (t) => !cancelled && setToken(t),
          "expired-callback": () => !cancelled && setToken(""),
          "error-callback": () => !cancelled && setFailed(true),
        });
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
    // `resetKey` deliberately re-runs this whole effect: the caller changes it
    // after every submission so a spent (single-use) Turnstile token is never
    // reused across an unrelated validation failure.
  }, [siteKey, resetKey]);

  return (
    <div>
      <div ref={containerRef} />
      <input type="hidden" name="captchaToken" value={token} />
      {failed ? (
        <p role="alert" className="text-label text-danger">
          {t("authPasswordPreview.error.captchaUnavailable")}
        </p>
      ) : null}
      <label htmlFor={inputId} className="sr-only">
        {t("authPasswordPreview.captchaLabel")}
      </label>
    </div>
  );
}
