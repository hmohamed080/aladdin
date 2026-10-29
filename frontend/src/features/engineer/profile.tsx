import { loadMyServiceAreas } from "@/server/queries/service-areas";
import { GOVERNORATE_OPTIONS, CITIES_BY_GOVERNORATE } from "@/lib/installer/location-data";
import Image from "next/image";
import { ProfileTabs } from "./profile-tabs";
import { SamplePhoto, useLocalEngineerSamples as localEngineerSamples } from "./sample-content";
import { ProfileSampleCards, ProfileSampleServices, ProfileSampleReview } from "./profile-samples";
import "./profile.css";
import { Card, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import {
  UserIcon,
  MapPinIcon,
  ShieldIcon,
  StarIcon,
  BriefcaseIcon,
  UsersIcon,
  PencilIcon,
  BadgeCheckFilledIcon,
} from "@/components/ui/icons";
import { VerificationBadge } from "@/features/home/parts";
import { requireEngineer } from "@/server/queries/engineer";
import { loadMyIdentity } from "@/server/queries/profile-identity";
import {
  loadEngineerCollections,
  resolveCollectionEntries,
} from "@/server/queries/engineer-collections";
import { loadProfilePublication } from "@/server/queries/professional-profile";
import { listMyPortfolio } from "@/server/queries/portfolio";
import { listMyReviews } from "@/server/queries/reviews";
import { listMyNetworkOrganizations } from "@/server/queries/network";
import {
  listMyAssignments,
  countAssignmentsByStatus,
} from "@/server/queries/job-assignments";
import { createAssetReadUrl } from "@/server/actions/professional-assets";
import { summarizeReviews } from "@/lib/reviews/summary";
import { createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { EngineerSection, EngineerEmpty } from "./sections";
import { languageLabel } from "@/lib/i18n/language-label";
import { specializationLabel } from "@/lib/i18n/trade-label";
import {
  AvailabilityBadge,
  AvailabilityAge,
} from "@/features/profile/availability-status";

export async function EngineerProfile({ locale }: { locale: Locale }) {
  const { account, supabase } = await requireEngineer();
  const ar = locale === "ar";
  const samples = localEngineerSamples();
  const t = createTranslator(locale);
  const [identity, publication, portfolio, reviews, network, assignments, coverage] =
    await Promise.all([
      loadMyIdentity(),
      loadProfilePublication(),
      listMyPortfolio(),
      listMyReviews(),
      listMyNetworkOrganizations(supabase),
      listMyAssignments(supabase),
      loadMyServiceAreas(),
    ]);
  const photos = await Promise.all(
    portfolio.slice(0, 3).map(async (p) => {
      const result = p.pending
        ? null
        : await createAssetReadUrl("portfolio", p.objectKey);
      return { ...p, url: result?.ok ? result.url : null };
    }),
  );
  const summary = summarizeReviews(reviews);
  const teams = (await loadEngineerCollections()).filter(
    (collection) => collection.kind === "team",
  );
  const teammates = await resolveCollectionEntries(
    teams.flatMap((team) => team.entries),
  );
  const completed = countAssignmentsByStatus(assignments).completed;
  const p = account.professional;
  const governorateLabel = (key: string) => GOVERNORATE_OPTIONS.find(option => option.value === key)?.[locale] ?? key;
  const cityLabel = (CITIES_BY_GOVERNORATE[p.governorate ?? ""] ?? []).find(option => option.value === p.city)?.[locale] ?? p.city;
  const fields = [
    [ar ? "الأدوات" : "Tools", p.additionalServices.map(key => t(`onboarding.professional.serviceItems.${key}`)).join(" · ")],
    [ar ? "إتاحة العمل" : "Work availability", p.availability === "flexible" ? (ar ? "حسب الطلب" : "On demand") : p.availability ? t(`onboarding.professional.availabilities.${p.availability}`) : null],
    [
      ar ? "التخصص" : "Specialization",
      p.specialization ? specializationLabel(t, p.specialization) : null,
    ],
    [ar ? "سنوات الخبرة" : "Years of experience", p.yearsExperience],
    [
      ar ? "مناطق العمل" : "Service areas",
      [...new Set([p.governorate, ...coverage.others.map(area => area.governorateKey)].filter((key): key is string => Boolean(key)))]
        .map(governorateLabel)
        .join(" · "),
    ],
    [
      ar ? "اللغات" : "Languages",
      p.languages.map((language) => languageLabel(t, language)).join(" · "),
    ],
  ];
  return (
    <div className="engineer-profile flex flex-col gap-lg">
      <section className="overflow-hidden rounded-lg border bg-surface">
        <div className="engineer-profile-cover"><SamplePhoto index={2} /></div>
        <div className="engineer-profile-identity relative flex flex-wrap items-start justify-between gap-md p-lg">
          <div className="flex min-w-0 flex-wrap items-center gap-md">
            <div className="engineer-profile-avatar grid shrink-0 place-items-center overflow-hidden rounded-pill border-4 border-surface bg-surface-2">
              {identity?.avatarUrl ? (
                <Image
                  src={identity.avatarUrl}
                  alt={account.displayName}
                  width={96}
                  height={96}
                  unoptimized
                />
              ) : samples ? <SamplePhoto portrait index={0} /> : (
                <UserIcon size={40} />
              )}
            </div>
            <div>
              <h1 className="text-headline flex items-center gap-2">{account.displayName}{account.verification.state === "verified" && <span className="engineer-profile-verified" role="img" aria-label={ar ? "حساب موثّق" : "Verified account"}><BadgeCheckFilledIcon size={28} /></span>}</h1>
              <p className="mt-2 text-body-lg text-fg-secondary">
                {p.headline || (ar ? "مهندس" : "Engineer")}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {account.verification.state !== "verified" && <VerificationBadge state={account.verification.state} t={t} />}
                <AvailabilityBadge state={account.availability.state} t={t} />
                <AvailabilityAge
                  updatedAt={account.availability.updatedAt}
                  locale={locale}
                  t={t}
                />
                <span className="flex items-center gap-1 text-label">
                  <MapPinIcon size={15} />
                  {[cityLabel, p.governorate ? governorateLabel(p.governorate) : null].filter(Boolean).join(" · ") ||
                    (ar ? "لم يحدد الموقع" : "Location not set")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
              <ButtonLink href="/home/profile/complete">
              <PencilIcon size={16} />
              {ar ? "تعديل الملف الشخصي" : "Edit profile"}
            </ButtonLink>
            <ButtonLink href="/home/settings" variant="outline">
              {ar
                ? "إعدادات الحساب"
                : "Account settings"}
            </ButtonLink>
            {publication.listed && publication.profileId && (
              <ButtonLink
                href={`/p/${publication.profileId}`}
                variant="outline"
              >
                {ar
                  ? "عرض الملف العام ومشاركته"
                  : "Open public profile to share"}
              </ButtonLink>
            )}
          </div>
        </div>
      </section>
      <ProfileTabs locale={locale} panels={[
{ id: "overview", label: ar ? "نبذة عامة" : "Overview", content: (<div className="flex flex-col gap-lg">      <div className="engineer-profile-row grid items-start gap-lg desktop:grid-cols-2">
        <div id="about">
          <Card>
            <div className="mb-md flex items-center justify-between gap-3"><h2 className="text-title">{ar ? "نبذة عني" : "About me"}</h2><ButtonLink href="/home/profile/complete" variant="ghost" size="sm"><PencilIcon size={14} />{ar ? "تعديل" : "Edit"}</ButtonLink></div>
            <p className="whitespace-pre-wrap text-body-lg leading-relaxed text-fg-secondary">
              {p.bio ||
                (ar
                  ? "أضف نبذة عن خبراتك وأسلوب عملك."
                  : "Introduce your experience and approach to your work.")}
            </p>
            <dl className="mt-lg divide-y">
              {fields.map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-md py-4 text-body"
                >
                  <dt className="text-fg-secondary">{label}</dt>
                  <dd className="text-end">
                    {value === null || value === "" ? "—" : value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
        <div className="flex flex-col gap-lg">
          <Card>
            <div className="flex items-center gap-md">
              <ShieldIcon size={38} />
              <div>
                <h2 className="text-title">
                  {ar ? "حالة توثيق حسابك" : "Your verification status"}
                </h2>
                <div className="mt-3">
                  {account.verification.state === "verified" ? <span className="engineer-profile-verified"><BadgeCheckFilledIcon size={24} />{ar ? "حساب موثّق" : "Verified account"}</span> : <VerificationBadge state={account.verification.state} t={t} />}
                </div>
              </div>
            </div>
            {account.verification.reason && (
              <p className="mt-3 text-body">{account.verification.reason}</p>
            )}
          </Card>
          <Card>
            <h2 className="mb-md text-title">
              {ar ? "إحصائيات سريعة" : "At a glance"}
            </h2>
            <div className="grid grid-cols-2 gap-md">
              {[
                [
                  BriefcaseIcon,
                  completed,
                  ar ? "مشروع مكتمل" : "Completed assignments",
                ],
                [
                  UsersIcon,
                  network.length,
                  ar ? "جهات تعاملت معها" : "Organizations worked with",
                ],
                [
                  StarIcon,
                  summary.average ?? "—",
                  ar ? "متوسط التقييم" : "Average rating",
                ],
                [StarIcon, summary.total, ar ? "تقييمات" : "Reviews"],
              ].map(([Icon, value, label]) => {
                const I = Icon as typeof StarIcon;
                return (
                  <div
                    key={String(label)}
                    className="flex flex-col items-center gap-2 rounded-sm bg-surface-2 p-md"
                  >
                    <I size={22} />
                    <strong className="text-headline">{String(value)}</strong>
                    <span className="text-center text-label text-fg-secondary">
                      {String(label)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
        <EngineerSection
          title={ar ? "الخدمات التي أقدمها" : "Services I offer"}
          locale={locale}
        >
          {!p.services.length && samples ? <ProfileSampleServices locale={locale} /> : p.services.length ? (
            <div className="grid grid-cols-2 gap-md">
              {p.services.map((service) => (
                <Card key={service} pad="sm">
                  <BriefcaseIcon size={25} />
                  <p className="mt-3 text-body">
                    {t(`onboarding.professional.serviceItems.${service}`)}
                  </p>
                </Card>
              ))}
            </div>
          ) : (
            <EngineerEmpty
              locale={locale}
              href="/home/profile/complete"
              action={ar ? "إضافة خدمات" : "Add services"}
            />
          )}
        </EngineerSection>
</div>) },
{ id: "projects", label: ar ? "مشاريعي" : "Projects", content: (        <div id="projects">
          <EngineerSection
            title={
              ar
                ? `مشاريعي (${portfolio.length})`
                : `My projects (${portfolio.length})`
            }
            href="/home/profile/portfolio"
            locale={locale}
          >
            {!photos.length && samples ? <ProfileSampleCards locale={locale} kind="projects" /> : !photos.length ? (
              <EngineerEmpty
                locale={locale}
                href="/home/profile/portfolio"
                action={ar ? "إضافة مشروع" : "Add project"}
              />
            ) : (
              <div className="grid gap-md tablet:grid-cols-3">
                {photos.map((photo) => (
                  <Card key={photo.id} pad="sm">
                    {photo.url ? (
                      <Image
                        src={photo.url}
                        alt={photo.title}
                        width={360}
                        height={240}
                        unoptimized
                        className="aspect-video w-full rounded-sm object-cover"
                      />
                    ) : (
                      <BriefcaseIcon size={40} />
                    )}
                    <h3 className="mt-3 text-body font-medium">
                      {photo.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-label text-fg-secondary">
                      {photo.description}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </EngineerSection>
        </div>
) },
{ id: "network", label: ar ? "المعارض" : "Showrooms", content: (        <div id="network">
          <EngineerSection
            title={
              ar
                ? "المعارض والجهات التي تعاملت معها"
                : "Organizations I have worked with"
            }
            href="/home/network"
            locale={locale}
          >
            {!network.length && samples ? <ProfileSampleCards locale={locale} kind="showrooms" /> : !network.length ? (
              <EngineerEmpty locale={locale} />
            ) : (
              network.slice(0, 6).map((org) => (
                <Card key={org.orgId} pad="sm" className="mb-3">
                  <h3 className="text-title">{org.orgName}</h3>
                  <Badge>
                    {org.completedCount}{" "}
                    {ar ? "أعمال مكتملة" : "completed assignments"}
                  </Badge>
                </Card>
              ))
            )}
          </EngineerSection>
        </div>
) },
{ id: "craftspeople", label: ar ? "الصنايعية" : "Craftspeople", content: (        <div id="craftspeople"><EngineerSection title={ar ? "الصنايعية الذين أتعامل معهم" : "Craftspeople I work with"} href="/home/engineer/professionals" locale={locale}>
          {samples ? <ProfileSampleCards locale={locale} kind="craftspeople" /> : <EngineerEmpty locale={locale} href="/home/engineer/teams" action={ar ? "إضافة متخصصين لفريق" : "Add specialists to a team"} />}
        </EngineerSection></div>
) },
{ id: "teams", label: ar ? "الفرق" : "Teams", content: (      <div id="teams">
        <EngineerSection
          title={ar ? "فرق العمل والمتخصصون" : "Teams and collaborators"}
          href="/home/engineer/teams"
          locale={locale}
        >
          {!teams.length && samples ? <ProfileSampleCards locale={locale} kind="team" /> : !teams.length ? (
            <EngineerEmpty
              locale={locale}
              title={
                ar ? "اجمع شركاء مشروعك" : "Bring your collaborators together"
              }
              description={
                ar
                  ? "أنشئ قائمة فريق وأضف إليها المتخصصين المناسبين لكل مشروع."
                  : "Create a team list and add the professionals you want to work with on each project."
              }
              href="/home/engineer/teams"
              action={ar ? "تكوين فريق" : "Build a team"}
            />
          ) : (
            <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3">
              {teams.map((team) => (
                <Card key={team.id}>
                  <h3 className="text-title">{team.name}</h3>
                  <p className="mt-2 text-label text-fg-secondary">
                    {ar
                      ? `${team.entries.length} متخصصين في القائمة`
                      : `${team.entries.length} professionals in this list`}
                  </p>
                  <ul className="mt-md space-y-2">
                    {team.entries.slice(0, 4).map((entry) => {
                      const person = teammates.find(
                        (item) =>
                          item.id === entry.id && item.type === entry.type,
                      );
                      return person?.title ? (
                        <li key={entry.id}>
                          <ButtonLink
                            href={person.href}
                            variant="ghost"
                            size="sm"
                          >
                            {person.title}
                          </ButtonLink>
                        </li>
                      ) : null;
                    })}
                  </ul>
                  <ButtonLink
                    href="/home/engineer/teams"
                    variant="outline"
                    className="mt-md"
                  >
                    {ar ? "إدارة الفريق" : "Manage team"}
                  </ButtonLink>
                </Card>
              ))}
            </div>
          )}
        </EngineerSection>
      </div>
) },
{ id: "reviews", label: ar ? "التقييمات" : "Reviews", content: (        <div id="reviews">
          <EngineerSection
            title={
              ar
                ? `آراء العملاء (${summary.total})`
                : `Client reviews (${summary.total})`
            }
            href="/home/reviews"
            locale={locale}
          >
            {!reviews.length && samples ? <ProfileSampleReview locale={locale} /> : !reviews.length ? (
              <EngineerEmpty locale={locale} />
            ) : (
              reviews.slice(0, 3).map((r) => (
                <Card key={r.id} className="mb-3">
                  <div className="flex justify-between gap-md">
                    <h3 className="text-body font-medium">{r.orgName}</h3>
                    <span className="text-label">{r.rating}/5</span>
                  </div>
                  <blockquote className="mt-3 text-body text-fg-secondary">
                    {r.comment}
                  </blockquote>
                  <p className="mt-3 text-label text-fg-secondary">
                    {r.jobTitle}
                  </p>
                </Card>
              ))
            )}
          </EngineerSection>
        </div>
) }
      ]} />
    </div>
  );
}

