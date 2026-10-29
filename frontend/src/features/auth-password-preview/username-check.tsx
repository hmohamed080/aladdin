"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { checkUsername, type UsernameCheck } from "@/server/actions/sign-up";

export type UsernameCheckState = UsernameCheck | { status: "idle" | "checking" };

const DEBOUNCE_MS = 400;

/**
 * Checks the username while the person types (Instagram style): the shape is
 * judged at once in the browser; a well-formed name is asked of the server
 * after a short pause, and only the answer for the latest text is kept.
 */
export function useUsernameCheck(username: string): UsernameCheckState {
  const [state, setState] = useState<UsernameCheckState>({ status: "idle" });
  const name = username.trim();

  useEffect(() => {
    if (!name) return setState({ status: "idle" });
    if (!isUsernameWellFormed(name)) return setState({ status: "invalid" });
    setState({ status: "checking" });
    let current = true;
    const timer = setTimeout(() => {
      checkUsername(name)
        .then((result) => current && setState(result))
        .catch(() => current && setState({ status: "unknown" }));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [name]);

  return state;
}

export function UsernameStatus({ id, check, onPick }: { id: string; check: UsernameCheckState; onPick: (name: string) => void }) {
  const { t } = useI18n();
  const line = (() => {
    switch (check.status) {
      case "checking":
        return <span className="text-fg-muted">{t("authPasswordPreview.signUp.usernameChecking")}</span>;
      case "available":
        return <span className="text-success">✓ {t("authPasswordPreview.signUp.usernameAvailable")}</span>;
      case "invalid":
        return <span className="text-danger">{t("authPasswordPreview.signUp.usernameRules")}</span>;
      case "taken":
        return (
          <span className="text-danger">
            {t("authPasswordPreview.signUp.usernameTaken")}
            {"suggestion" in check && check.suggestion ? (
              <>
                {" "}
                <button type="button" className="font-semibold text-accent underline" dir="ltr" onClick={() => onPick(check.suggestion!)}>
                  {t("authPasswordPreview.signUp.usernameTry", { name: check.suggestion })}
                </button>
              </>
            ) : null}
          </span>
        );
      default:
        return null;
    }
  })();
  return (
    <p id={id} aria-live="polite" className="text-label">
      {line}
    </p>
  );
}
