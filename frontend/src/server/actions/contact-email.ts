"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getContactEmailAdminClient } from "@/lib/supabase/admin-server";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { linkOrigin, sendTransactionalEmail } from "@/server/email/transactional";
import {
  CONTACT_EMAIL_CODES,
  confirmContactEmailLink,
  removeContactEmail,
  startContactEmail,
  type ContactEmailDeps,
  sha256Bytes,
  type ContactEmailResult,
} from "@/server/identity/contact-email";

/**
 * Contact-email Server Actions. The user id comes ONLY from the request's session; the response carries only a
 * translation key. See `server/identity/contact-email.ts` for the flow and `20261021090005` for the rules.
 */
export type ContactEmailState = { ok: boolean; code?: string; retryAfterSeconds?: number };


async function deps(): Promise<{ deps: ContactEmailDeps; userId: string | null }> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    userId: user?.id ?? null,
    deps: {
      user: supabase,
      service: getContactEmailAdminClient(),
      send: sendTransactionalEmail,
      randomBytes: () => globalThis.crypto.getRandomValues(new Uint8Array(32)),
      sha256: sha256Bytes,
    },
  };
}

function toState(result: ContactEmailResult): ContactEmailState {
  return result.ok ? { ok: true, code: result.code } : { ok: false, code: result.code, ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}) };
}

function revalidateSettings() {
  for (const path of ["/home/settings", "/settings/profile", "/showroom/settings", "/b2b/settings"]) revalidatePath(path);
}

export async function startContactEmailAction(_prev: ContactEmailState, fd: FormData): Promise<ContactEmailState> {
  try {
    const { deps: d, userId } = await deps();
    if (!userId) return { ok: false, code: CONTACT_EMAIL_CODES.sessionExpired };
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
    const result = await startContactEmail(d, {
      userId,
      email: fd.get("email"),
      password: fd.get("currentPassword"),
      origin: linkOrigin(host, proto),
      locale,
    });
    if (result.ok) revalidateSettings();
    return toState(result);
  } catch {
    console.error("contact email: start aborted unexpectedly");
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
}

export async function removeContactEmailAction(_prev: ContactEmailState, fd: FormData): Promise<ContactEmailState> {
  try {
    const { deps: d, userId } = await deps();
    if (!userId) return { ok: false, code: CONTACT_EMAIL_CODES.sessionExpired };
    const result = await removeContactEmail(d, { userId, password: fd.get("currentPassword"), verified: fd.get("verified") === "true" });
    if (result.ok) revalidateSettings();
    return toState(result);
  } catch {
    console.error("contact email: remove aborted unexpectedly");
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
}

/** The explicit confirmation from `/settings/contact-email/confirm` (a button press - opening the link never verifies). */
export async function confirmContactEmailAction(_prev: ContactEmailState, fd: FormData): Promise<ContactEmailState> {
  try {
    const { deps: d, userId } = await deps();
    if (!userId) return { ok: false, code: CONTACT_EMAIL_CODES.sessionExpired };
    const result = await confirmContactEmailLink(d, userId, fd.get("token"));
    if (result.ok) revalidateSettings();
    return toState(result);
  } catch {
    console.error("contact email: confirmation aborted unexpectedly");
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
}
