/**
 * Notification templates: the pure rules the admin form shares with the database.
 *
 * The database (admin_notification_template_set) is the authority: it refuses an undeclared variable and
 * over-long text whatever this file says. These helpers only let the form and the server action refuse the
 * same inputs early, with the same limits, so the message appears without a round trip.
 */

export const TITLE_MAX = 120;
export const BODY_MAX = 500;

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** The variables a text uses: the names inside {braces}, de-duplicated, sorted. */
export function templateVariables(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) if (match[1]) names.add(match[1]);
  return [...names].sort();
}

export type TemplateTexts = { titleAr: string; bodyAr: string; titleEn: string; bodyEn: string };

export type TemplateCheck = { ok: true } | { ok: false; code: "length" | "variable"; detail?: string[] };

/** Every text present and within its limit, and only declared variables used, in all four texts. */
export function validateTemplateTexts(texts: TemplateTexts, declared: readonly string[]): TemplateCheck {
  const entries: Array<[string, number]> = [
    [texts.titleAr, TITLE_MAX],
    [texts.titleEn, TITLE_MAX],
    [texts.bodyAr, BODY_MAX],
    [texts.bodyEn, BODY_MAX],
  ];
  for (const [text, max] of entries) {
    const length = text.trim().length;
    if (length < 1 || length > max) return { ok: false, code: "length" };
  }
  const allowed = new Set(declared);
  const undeclared = new Set<string>();
  for (const [text] of entries) for (const name of templateVariables(text)) if (!allowed.has(name)) undeclared.add(name);
  if (undeclared.size > 0) return { ok: false, code: "variable", detail: [...undeclared].sort() };
  return { ok: true };
}
