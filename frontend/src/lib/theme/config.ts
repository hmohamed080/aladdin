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
