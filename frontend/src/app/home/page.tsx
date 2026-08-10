import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveActiveLanding } from "@/server/queries/landing";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { Card, StatePanel } from "@/components/ui/primitives";
import { HomeIcon, SearchIcon, ActivityIcon, UsersIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Consumer / individual home. A signed-in caller with no organization (typically
 * an End Consumer) lands here. If the caller in fact belongs to a workspace or is
 * platform staff, they are corrected to their real destination — landing is always
 * derived, never assumed.
 */
export default async function ConsumerHomePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const landing = await resolveActiveLanding(supabase);
  if (landing !== "/home") redirect(landing);

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const name = profile?.display_name?.trim() || m.consumerHome.friend;

  const cards: { Icon: typeof HomeIcon; title: string; body: string }[] = [
    { Icon: ActivityIcon, title: m.consumerHome.projects.title, body: m.consumerHome.projects.body },
    { Icon: SearchIcon, title: m.consumerHome.discover.title, body: m.consumerHome.discover.body },
    { Icon: UsersIcon, title: m.consumerHome.advice.title, body: m.consumerHome.advice.body },
  ];

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-1">
        <p className="text-label text-fg-muted">{m.consumerHome.eyebrow}</p>
        <h1 className="text-title text-fg">{m.consumerHome.greeting.replace("{name}", name)}</h1>
        <p className="max-w-prose text-body text-fg-secondary">{m.consumerHome.subtitle}</p>
      </header>

      <section className="grid gap-md tablet:grid-cols-3">
        {cards.map(({ Icon, title, body }) => (
          <Card key={title} className="flex flex-col gap-sm">
            <span className="flex size-9 items-center justify-center rounded-md bg-surface-2 text-accent">
              <Icon size={20} />
            </span>
            <h2 className="text-body font-semibold text-fg">{title}</h2>
            <p className="text-label text-fg-secondary">{body}</p>
            <span className="mt-auto pt-sm text-label font-medium text-fg-muted">
              {m.consumerHome.comingSoon}
            </span>
          </Card>
        ))}
      </section>

      <StatePanel title={m.consumerHome.pilot.title} body={m.consumerHome.pilot.body} />
    </div>
  );
}
