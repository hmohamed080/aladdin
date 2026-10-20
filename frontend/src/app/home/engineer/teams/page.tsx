import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import {
  loadEngineerCollections,
  resolveCollectionEntries,
} from "@/server/queries/engineer-collections";
import { listProfessionals } from "@/server/queries/directory";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import {
  CollectionButton,
  TeamEditor,
  DeleteTeam,
} from "@/features/engineer/collection-controls";
export default async function TeamsPage() {
  const { supabase } = await requireEngineer();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const ar = locale === "ar";
  const [collections, professionals] = await Promise.all([
    loadEngineerCollections(),
    listProfessionals(supabase, {
      personas: ["engineer", "installer_technician"],
    }),
  ]);
  const teams = collections.filter((c) => c.kind === "team");
  const entries = await resolveCollectionEntries(
    teams.flatMap((c) => c.entries),
  );
  const profiles = professionals.flatMap((p) =>
    p.id ? [{ id: p.id, name: p.display_name ?? "" }] : [],
  );
  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-headline">{ar ? "فرق العمل" : "My teams"}</h1>
      <p className="text-body text-fg-secondary">
        {ar
          ? "نظّم المتخصصين الذين ترغب في التعاون معهم. هذه قوائمك الخاصة، ولا تعني انضمامهم أو منح صلاحيات لحسابك."
          : "Organize the professionals you want to collaborate with. These are your private rosters; adding someone does not enroll them or grant access to your account."}
      </p>
      <Card>
        <TeamEditor />
      </Card>
      <div className="grid gap-lg tablet:grid-cols-2">
        {teams.map((team) => (
          <Card key={team.id} className="flex flex-col gap-md">
            <h2 className="text-title">{team.name}</h2>
            <DeleteTeam teamId={team.id} />
            {team.entries.map((e) => {
              const entry = entries.find(
                (x) => x.type === e.type && x.id === e.id,
              );
              return (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 border-b pb-3"
                >
                  {entry?.title ? (
                    <ButtonLink href={entry.href} variant="ghost">
                      {entry.title}
                    </ButtonLink>
                  ) : (
                    <span>{ar ? "ملف غير متاح" : "Unavailable profile"}</span>
                  )}
                  <CollectionButton
                    entityId={e.id}
                    entityType={e.type}
                    collectionId={team.id}
                  />
                </div>
              );
            })}
            <TeamEditor
              teamId={team.id}
              profiles={profiles.filter(
                (p) => !team.entries.some((e) => e.id === p.id),
              )}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
