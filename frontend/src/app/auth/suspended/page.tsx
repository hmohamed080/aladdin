import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AuthCard } from "@/features/auth/auth-card";
import { Button } from "@/components/ui/controls";
import { signOut } from "@/server/actions/auth";

export const dynamic = "force-dynamic";

/**
 * Where a suspended account lands (PD-010, Admin Core 1B-B). The database
 * refuses every other request this account makes, so the page reads only the
 * account's own status — the one request still answered. The Admin reason is
 * internal and is never shown here. The middleware sends active accounts away.
 */
export default async function AccountSuspendedPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const store = await cookies();
  const m = getMessages(resolveLocale(store.get(LOCALE_COOKIE)?.value));
  const t = m.auth.suspended;

  return (
    <AuthCard
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <Link href="/auth/support" className="text-fg-muted hover:text-fg hover:underline">
          {t.contactSupport}
        </Link>
      }
    >
      <div className="flex flex-col gap-md">
        <p className="text-body text-fg-secondary">{t.body}</p>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            {m.common.signOut}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
