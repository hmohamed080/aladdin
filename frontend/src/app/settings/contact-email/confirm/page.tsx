import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getContactEmailAdminClient } from "@/lib/supabase/admin-server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { peekContactEmailLink, sha256Bytes } from "@/server/identity/contact-email";
import { ContactEmailConfirm } from "@/features/settings/contact-email-confirm";

export const dynamic = "force-dynamic";


/**
 * `/settings/contact-email/confirm?token=...` - the link in the contact-email message.
 *
 * Opening it NEVER verifies anything (mail scanners open links): the page only peeks (no database write) and shows a
 * Confirm button; the address is verified by the owner's explicit press, through `confirmContactEmailAction`. The owner
 * must be signed in as the account that asked for it - another account's session sees the link as invalid.
 */
export default async function ContactEmailConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/settings/contact-email/confirm?token=${token}`)}`);

  const peek = await peekContactEmailLink({ service: getContactEmailAdminClient(), sha256: sha256Bytes }, user.id, token);
  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-md" data-testid="contact-email-confirm">
      <h1 className="text-headline text-fg">{t("contactEmail.confirm.title")}</h1>
      <ContactEmailConfirm token={token} state={peek.state} maskedEmail={peek.maskedEmail} />
    </div>
  );
}
