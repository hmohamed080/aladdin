export const ALWAYS_PASS_SITE_KEY: string;
export const TURNSTILE_STUB: string;
export function classifySiteKey(siteKey: unknown): "always-pass-test" | "always-block-test" | "interactive-test" | "real" | "missing";
export function judgeStubbedWidget(state: { sitekey: string | null | undefined } | null | undefined): string | null;
