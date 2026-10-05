import { useSyncExternalStore } from "react";

const PHONE_QUERY = "(max-width: 767px)";

/**
 * True below the tablet breakpoint. The server snapshot and the first client
 * render both report `false`, so hydration never mismatches; the real value is
 * applied on the next commit. Use it where a screen needs a different
 * COMPOSITION on phones (not just different spacing), so a control is rendered
 * once in the layout that applies instead of twice with one hidden by CSS.
 */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
