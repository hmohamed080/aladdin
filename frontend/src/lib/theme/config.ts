/**
 * Theme preference — ONE implementation, shared by the profile menu, the
 * settings page, the auth/onboarding switch and server rendering.
 *
 * THREE VALUES, NOT TWO
 * `light` and `dark` are explicit choices the user made. `system` defers to the
 * OS, and is the DEFAULT: a workspace that opens in blazing light on a machine
 * set to dark at 11pm is a preference the product invented on the user's behalf.
 *
 * WHY THE COOKIE HOLDS THE PREFERENCE AND NOT THE RESOLVED THEME
 * The server cannot know the OS setting — it is not sent with the request. So
 * `system` renders WITHOUT the `dark` class and a tiny pre-paint script in the
 * document head applies it from `matchMedia` before the first frame (see
 * app/layout.tsx). Storing a resolved value instead would freeze the user's
 * choice at whatever their OS happened to be the day they last toggled it.
 */
export const THEME_COOKIE = "aladdin-theme";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(value: string | undefined): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function resolveThemePreference(cookieValue: string | undefined): ThemePreference {
  return isThemePreference(cookieValue) ? cookieValue : "system";
}

/**
 * What the SERVER should render. `system` resolves to light here because that is
 * the only value it can render without guessing; the pre-paint script corrects
 * it before anything is shown when the OS says otherwise.
 */
export function resolveTheme(cookieValue: string | undefined): Theme {
  return cookieValue === "dark" ? "dark" : "light";
}

/**
 * ---------------------------------------------------------------------------
 * Client helpers. ONE implementation of "make the document reflect a choice".
 * ---------------------------------------------------------------------------
 *
 * There are now two controls that change the theme — the quick Light/Dark
 * switch in the header and the full System/Light/Dark group in the profile menu
 * — and they must not each own a copy of this. They are two doors into one
 * preference: the cookie is the store, `<html>` is the rendering of it, and the
 * functions below are the only place that maps between them. Neither control
 * holds theme state of its own beyond what it reads back from here.
 *
 * The mirror onto `<html>` is not an optimisation. `setTheme` revalidates the
 * layout, but React does not re-render the ROOT element's class from a server
 * revalidation, so without this the cookie would flip and the page in front of
 * the user would stay in the old theme until a hard reload.
 */

/** Apply a preference to the live document and report what it resolved to. */
export function applyThemePreference(next: ThemePreference): Theme {
  const root = document.documentElement;
  root.setAttribute("data-theme-pref", next);
  const dark =
    next === "dark" ||
    (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

/**
 * The stored preference, read from the DOM rather than from a prop. After
 * hydration this attribute is the truth: the pre-paint script may have resolved
 * `system` since the server rendered, and a stale prop would show the wrong
 * control as selected.
 */
export function readThemePreference(): ThemePreference | null {
  const attr = document.documentElement.getAttribute("data-theme-pref") ?? undefined;
  return isThemePreference(attr) ? attr : null;
}

/**
 * What the user is ACTUALLY looking at, which is not the same question as what
 * they chose: under `system` the preference is neither light nor dark while the
 * screen is definitely one of them. The quick switch needs this one, because it
 * has to show which of two states is current.
 */
export function readActiveTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The pre-paint script. Inlined in <head> so it runs BEFORE first paint — a
 * `useEffect` here would show a light flash on every navigation for every
 * dark-mode user, which is the single most visible bug a theme system can have.
 *
 * Deliberately tiny and defensive: it must never throw (a thrown error in a
 * blocking head script would leave the document unstyled), and it does exactly
 * one thing — decide whether `.dark` belongs on <html> right now.
 */
export const THEME_BOOTSTRAP = `(function(){try{
var p=document.documentElement.getAttribute('data-theme-pref');
var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark',d);
}catch(e){}})();`;
