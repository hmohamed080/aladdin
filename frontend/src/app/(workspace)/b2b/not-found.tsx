import Link from "next/link";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/translate";

/**
 * Route-level not-found for the B2B workspace (triggered by `notFound()`).
 * Localized (Arabic-first), with a clear way back. Distinct from the in-page
 * not-found panel a detail screen shows when a record is missing or out of
 * scope — this catches unmatched B2B routes.
 */
export default async function B2BNotFound() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-md py-16 text-center">
      <h1 className="text-headline text-fg">{m.states.notFoundTitle}</h1>
      <p className="text-body text-fg-secondary">{m.states.notFoundBody}</p>
      <div>
        <Link
          href="/b2b"
          className="inline-flex min-h-9 items-center rounded-sm bg-primary px-md py-1.5 text-label font-medium text-primary-foreground hover:opacity-90"
        >
          {m.nav.home}
        </Link>
      </div>
    </div>
  );
}
