/** Theme cookie name + resolver (light default; dark adds the `.dark` class). */
export const THEME_COOKIE = "aladdin-theme";

export function resolveTheme(cookieValue: string | undefined): "light" | "dark" {
  return cookieValue === "dark" ? "dark" : "light";
}
