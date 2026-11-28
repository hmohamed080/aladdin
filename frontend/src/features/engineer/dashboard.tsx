import Image from "next/image";
import {
  useLocalEngineerSamples,
  SamplePhoto,
  SampleShowrooms,
  SampleProjects,
  SampleProfessionals,
} from "./sample-content";
import { ButtonLink } from "@/components/ui/controls";
import { Card, Badge } from "@/components/ui/primitives";
import {
  StorefrontIcon,
  FileTextIcon,
  UsersIcon,
  BriefcaseIcon,
  HeartIcon,
  UserIcon,
  ArrowUpRightIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { VerificationBadge } from "@/features/home/parts";
import { createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { EngineerDashboardData } from "@/server/queries/engineer";
import type { ProfileCompletion } from "@/server/queries/profile-identity";
import {
  EngineerSection,
  ShowroomCards,
  ProfessionalCards,
  InspirationCards,
} from "./sections";
import { requestStatusLabel } from "./status";

export function EngineerDashboard({
  data,
  locale,
  completion,
}: {
  data: EngineerDashboardData;
  locale: Locale;
  completion?: ProfileCompletion | null;
}) {
  const ar = locale === "ar";
  const samples = useLocalEngineerSamples();
  const t = createTranslator(locale);
  const progress = completion;
  const actions = [
    {
      label: ar ? "اكتشف المعارض" : "Explore showrooms",
      href: "/home/engineer/showrooms",
      Icon: StorefrontIcon,
    },
    {
      label: ar ? "مشاريع ملهمة" : "Inspiring projects",
      href: "/home/engineer/inspiration",
      Icon: BriefcaseIcon,
    },
    {
      label: ar ? "طلب عرض سعر" : "Request a quote",
      href: "/home/engineer/requests/new",
      Icon: FileTextIcon,
    },
    {
      label: ar ? "المهندسون والصنايعية" : "Professionals",
      href: "/home/engineer/professionals",
      Icon: UsersIcon,
    },
    {
      label: ar ? "أفكاري المحفوظة" : "Saved ideas",
      href: "/home/engineer/saved",
      Icon: HeartIcon,
    },
  ];
  return (
    <div className="engineer-home flex flex-col gap-lg">
      {progress && progress.percent < 100 && (
        <section
          aria-labelledby="complete-profile-heading"
          className="engineer-completion flex flex-wrap items-center gap-md rounded-md border border-strong bg-surface p-md"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-accent-solid text-on-accent">
            <ShieldIcon size={24} />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <h2
              id="complete-profile-heading"
              className="text-body font-semibold"
            >
              {ar
                ? "أكمل ملفك ليتعرف العملاء على خبراتك"
                : "Complete your profile so clients can get to know you"}
            </h2>
            <p className="mt-1 text-label text-fg-secondary">
              {ar
                ? "أضف خدماتك وأعمالك السابقة لتقديم صورة أوضح عنك."
                : "Add your services and previous work to tell your professional story."}
            </p>
            <div
              role="progressbar"
              aria-label={ar ? "اكتمال الملف" : "Profile completeness"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              className="mt-3 flex max-w-lg gap-1"
            >
              {Array.from({ length: 10 }, (_, index) => (
                <span
                  key={index}
                  className={`h-1 flex-1 rounded-pill ${index < Math.floor(progress.percent / 10) ? "bg-accent-solid" : "bg-surface-2"}`}
                />
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-label tabular-nums text-fg-secondary">
              <bdi dir="ltr">
                {progress.percent}%
              </bdi>{" "}
              {ar ? "مكتمل" : "complete"}
            </span>
            <ButtonLink href="/home/profile/complete" variant="accent">
              {ar ? "أكمل ملفك الشخصي الآن" : "Complete your profile now"}
              <ArrowUpRightIcon size={16} />
            </ButtonLink>
          </div>
        </section>
      )}
      <section className="engineer-hero relative isolate overflow-hidden rounded-lg">
        <Image
          src="/assets/engineer/hero-living-room.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 75vw, 100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-shell/30" />
        <div className="engineer-hero-layout relative grid items-center gap-lg p-lg desktop:grid-cols-2 desktop:p-xl">
          <div className="max-w-xl py-lg">
            <h1 className="text-headline">
              {ar
                ? "كل ما تحتاجه لمشاريعك، في مكان واحد"
                : "Everything your projects need, in one place"}
            </h1>
            <p className="mt-md text-body-lg leading-relaxed">
              {ar
                ? "اكتشف المعارض، تواصل مع مهندسين وصنايعية، واستلهم من أعمال المجتمع. ابدأ مشروعك القادم باختيارات تناسب رؤيتك."
                : "Discover showrooms, connect with professionals, and find inspiration in the community. Start your next project with choices that fit your vision."}
            </p>
            <ButtonLink
              href="/home/engineer/requests/new"
              variant="accent"
              className="mt-lg"
            >
              {ar ? "ابدأ طلب عرض سعر" : "Start a quotation request"}
              <ArrowUpRightIcon size={18} />
            </ButtonLink>
          </div>
          <Card className="engineer-identity-card relative mt-lg w-full max-w-lg justify-self-end text-fg">
            <div className="-mt-xl mb-md grid h-24 w-24 place-items-center overflow-hidden rounded-pill border-4 border-surface bg-surface-2">
              {samples ? (
                <SamplePhoto portrait index={0} />
              ) : data.identity?.avatarUrl ? (
                <Image
                  src={data.identity.avatarUrl}
                  alt={data.account.displayName}
                  width={96}
                  height={96}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserIcon size={42} />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div className="min-w-0">
                <h2 className="text-title">
                  <bdi>{data.account.displayName}</bdi>
                </h2>
                <div className="mt-1 text-body text-fg-secondary">
                  {data.account.professional.headline ||
                    (ar ? "مهندس" : "Engineer")}
                </div>
              </div>
              <ButtonLink href="/home/profile/edit" variant="outline" size="sm">
                {ar ? "تعديل الملف الشخصي" : "Edit profile"}
              </ButtonLink>
            </div>
            <div className="mt-md">
              <VerificationBadge
                state={data.account.verification.state}
                t={t}
              />
            </div>
            <div className="mt-md grid grid-cols-3 gap-2 border-t pt-md text-center">
              <div>
                <strong className="text-title tabular-nums">
                  {progress ? `${progress.percent}%` : "—"}
                </strong>
                <div className="mt-1 text-label text-fg-secondary">
                  {ar ? "اكتمال الملف" : "Profile complete"}
                </div>
              </div>
              <div>
                <strong className="text-title tabular-nums">
                  {data.portfolio.length}
                </strong>
                <div className="mt-1 text-label text-fg-secondary">
                  {ar ? "مشاريع معروضة" : "Featured projects"}
                </div>
              </div>
              <div>
                <strong className="text-title tabular-nums">
                  {data.requests.length}
                </strong>
                <div className="mt-1 text-label text-fg-secondary">
                  {ar ? "طلبات حديثة" : "Recent requests"}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>
      <nav
        aria-label={ar ? "ابدأ من هنا" : "Quick actions"}
        className="engineer-quick-actions grid grid-cols-2 gap-3 tablet:grid-cols-3 desktop:grid-cols-5"
      >
        {actions.map(({ label, href, Icon }) => (
          <ButtonLink
            key={href}
            href={href}
            variant="ghost"
            className="flex-col gap-3 border bg-surface py-md text-center text-fg hover:border-strong"
          >
            <span className="text-accent-solid">
              <Icon size={30} />
            </span>
            {label}
          </ButtonLink>
        ))}
      </nav>
      <EngineerSection
        title={ar ? "معارض مقترحة لك" : "Discover showrooms"}
        href="/home/engineer/showrooms"
        locale={locale}
      >
        {samples ? (
          <SampleShowrooms locale={locale} />
        ) : (
          <ShowroomCards rows={data.showrooms} locale={locale} />
        )}
      </EngineerSection>
      <EngineerSection
        title={
          ar
            ? "مشاريع ملهمة من مهندسين مثلك"
            : "Inspiration from fellow professionals"
        }
        href="/home/engineer/inspiration"
        locale={locale}
      >
        {samples ? (
          <SampleProjects locale={locale} />
        ) : (
          <InspirationCards locale={locale} limit={4} />
        )}
      </EngineerSection>
      <div className="grid items-start gap-lg desktop:grid-cols-3">
        <div className="desktop:col-span-2">
          {samples ? (
            <SampleProfessionals locale={locale} />
          ) : (
            <EngineerSection
              title={ar ? "المهندسون والصنايعية" : "Engineers and craftspeople"}
              href="/home/engineer/professionals"
              locale={locale}
            >
              <ProfessionalCards
                rows={data.professionals.slice(0, 4)}
                locale={locale}
              />
            </EngineerSection>
          )}
        </div>
        <Card className="engineer-quote-promo flex flex-col gap-md">
          <FileTextIcon size={32} />
          <h2 className="text-title">
            {ar ? "اطلب عرض سعر لمشروعك" : "Get quotes for your project"}
          </h2>
          <p className="text-body text-fg-secondary">
            {ar
              ? "أرسل تفاصيل مشروعك وقارن عروض المعارض المناسبة لاحتياجاتك."
              : "Share your requirements and compare responses from suitable showrooms."}
          </p>
          <ButtonLink href="/home/engineer/requests/new" variant="accent">
            {ar ? "طلب عرض سعر" : "Request a quote"}
          </ButtonLink>
        </Card>
      </div>
      {data.requests.length > 0 && (
        <EngineerSection
          title={ar ? "متابعة طلباتك" : "Your recent requests"}
          href="/home/engineer/requests"
          locale={locale}
        >
          <Card pad="sm">
            <ul className="divide-y">
              {data.requests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-md py-3"
                >
                  <h3 className="text-body font-medium">{request.title}</h3>
                  <Badge>{requestStatusLabel(request.status, locale)}</Badge>
                  <ButtonLink
                    href={`/home/engineer/requests/${request.id}`}
                    variant="ghost"
                    size="sm"
                  >
                    {ar ? "عرض الطلب" : "Open request"}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </Card>
        </EngineerSection>
      )}
    </div>
  );
}
