import { requestStatusLabel } from "./status";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/controls";
import { Card, Badge } from "@/components/ui/primitives";
import {
  StorefrontIcon,
  FileTextIcon,
  UsersIcon,
  BriefcaseIcon,
  PlusIcon,
  ArrowUpRightIcon,
} from "@/components/ui/icons";
import { VerificationBadge } from "@/features/home/parts";
import { createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { EngineerDashboardData } from "@/server/queries/engineer";
import {
  EngineerSection,
  EngineerEmpty,
  ShowroomCards,
  ProfessionalCards,
  ProductCards,
  InspirationCards,
} from "./sections";

export function EngineerDashboard({
  data,
  locale,
}: {
  data: EngineerDashboardData;
  locale: Locale;
}) {
  const ar = locale === "ar";
  const t = createTranslator(locale);
  const actions = [
    {
      label: ar ? "اكتشف المعارض" : "Explore showrooms",
      sub: ar ? "شركاء لمشروعك القادم" : "Partners for your next project",
      href: "/home/engineer/showrooms",
      Icon: StorefrontIcon,
    },
    {
      label: ar ? "اطلب عرض سعر" : "Request a quote",
      sub: ar ? "كل احتياجاتك في طلب واحد" : "Your materials in one request",
      href: "/home/engineer/requests/new",
      Icon: FileTextIcon,
    },
    {
      label: ar ? "ابحث عن متخصص" : "Find a professional",
      sub: ar ? "خبرات تكمل رؤيتك" : "Expertise that complements yours",
      href: "/home/engineer/professionals",
      Icon: UsersIcon,
    },
    {
      label: ar ? "كوّن فريق عمل" : "Build your team",
      sub: ar ? "نظّم شبكة شركائك" : "Organize your collaborators",
      href: "/home/engineer/teams",
      Icon: BriefcaseIcon,
    },
  ];
  return (
    <div className="flex flex-col gap-xl">
      <section className="engineer-hero relative isolate overflow-hidden rounded-lg">
        <Image
          src="/assets/showroom-auth/showroom-interior-2026.png"
          alt=""
          fill
          className="object-cover opacity-30"
          priority
          sizes="100vw"
        />
        <div className="relative flex min-h-64 flex-col justify-center gap-md p-lg tablet:p-xl">
          <h1 className="max-w-2xl text-headline">
            {ar ? "مرحباً، " : "Welcome, "}
            <bdi>{data.account.displayName}</bdi>
          </h1>
          <p className="max-w-xl text-body-lg">
            {ar
              ? "كل ما تحتاجه لتحويل رؤيتك الهندسية إلى واقع. اكتشف، تواصل، وابدأ مشروعك القادم."
              : "Everything you need to bring your architectural vision to life. Discover, connect, and start your next project."}
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/home/engineer/requests/new" variant="accent">
              <PlusIcon size={18} />
              {ar ? "طلب عرض سعر جديد" : "New quotation request"}
            </ButtonLink>
            <ButtonLink href="/home/profile" variant="accent">
              {ar ? "ملفي الشخصي" : "My profile"}
              <ArrowUpRightIcon size={17} />
            </ButtonLink>
          </div>
        </div>
      </section>
      <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
        {actions.map(({ label, sub, href, Icon }) => (
          <Card key={href} pad="sm" className="flex flex-col gap-3">
            <span className="text-accent">
              <Icon size={28} />
            </span>
            <ButtonLink
              href={href}
              variant="ghost"
              className="justify-start px-0"
            >
              {label}
              <ArrowUpRightIcon size={16} />
            </ButtonLink>
            <p className="text-label text-fg-secondary">{sub}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-xl desktop:grid-cols-3">
        <div className="desktop:col-span-2">
          <EngineerSection
            title={ar ? "طلبات عروض الأسعار" : "Quotation requests"}
            href="/home/engineer/requests"
            locale={locale}
          >
            {!data.requests.length ? (
              <EngineerEmpty
                locale={locale}
                href="/home/engineer/requests/new"
                action={ar ? "ابدأ طلبك الأول" : "Create your first request"}
              />
            ) : (
              <Card pad="sm">
                <ul className="divide-y">
                  {data.requests.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-md py-4"
                    >
                      <div>
                        <h3 className="text-body font-medium">{r.title}</h3>
                        <p className="mt-1 text-label text-fg-secondary">
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                          }).format(new Date(r.created_at))}
                        </p>
                      </div>
                      <Badge>{requestStatusLabel(r.status, locale)}</Badge>
                      <ButtonLink
                        href={`/home/engineer/requests/${r.id}`}
                        variant="outline"
                        size="sm"
                      >
                        {ar ? "عرض الطلب" : "Open"}
                      </ButtonLink>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </EngineerSection>
        </div>
        <Card className="flex flex-col gap-md">
          <h2 className="text-title">
            {ar ? "أكمل ملفك الشخصي" : "Make your profile stand out"}
          </h2>
          <strong className="text-headline">
            {data.account.completeness.percent}%
          </strong>
          <progress
            value={data.account.completeness.percent}
            max={100}
            className="h-2 w-full accent-current"
            aria-label={ar ? "اكتمال الملف" : "Profile completeness"}
          />
          <p className="text-body text-fg-secondary">
            {ar
              ? "أضف خبراتك وخدماتك لمساعدة العملاء في التعرف عليك."
              : "Add your experience and services to help clients get to know you."}
          </p>
          <VerificationBadge state={data.account.verification.state} t={t} />
          <ButtonLink href="/home/profile/edit">
            {ar ? "إكمال الملف الشخصي" : "Complete profile"}
          </ButtonLink>
        </Card>
      </div>
      <EngineerSection
        title={ar ? "معارض لمشروعك القادم" : "Showrooms for your next project"}
        href="/home/engineer/showrooms"
        locale={locale}
      >
        <ShowroomCards rows={data.showrooms} locale={locale} />
      </EngineerSection>
      <div className="grid gap-xl desktop:grid-cols-2">
        <div className="desktop:col-span-2">
          <EngineerSection
            title={
              ar ? "مشاريع ملهمة من المجتمع" : "Inspiration from the community"
            }
            href="/home/engineer/inspiration"
            locale={locale}
          >
            <InspirationCards locale={locale} limit={4} />
          </EngineerSection>
        </div>
        <EngineerSection
          title={ar ? "مشاريعي" : "My projects"}
          href="/home/profile/portfolio"
          locale={locale}
        >
          {!data.portfolio.length ? (
            <EngineerEmpty
              locale={locale}
              title={ar ? "ابدأ معرض أعمالك" : "Start your portfolio"}
              description={
                ar
                  ? "أضف صور مشروعك وتفاصيله ليكتشف العملاء أسلوبك وخبرتك."
                  : "Add project photos and details so clients can discover your approach and experience."
              }
              href="/home/profile/portfolio"
              action={ar ? "إضافة مشروع" : "Add a project"}
            />
          ) : (
            <div className="grid gap-md tablet:grid-cols-2">
              {data.portfolio.map((p) => (
                <Card key={p.id} pad="sm">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={p.title}
                      width={400}
                      height={260}
                      unoptimized
                      className="aspect-video w-full rounded-sm object-cover"
                    />
                  ) : (
                    <BriefcaseIcon size={32} />
                  )}
                  <h3 className="my-3 text-title">{p.title}</h3>
                  <p className="line-clamp-2 text-body text-fg-secondary">
                    {p.description}
                  </p>
                  <ButtonLink href="/home/profile/portfolio" variant="ghost">
                    {ar ? "إدارة المشروع" : "Manage project"}
                  </ButtonLink>
                </Card>
              ))}
            </div>
          )}
        </EngineerSection>
        <EngineerSection
          title={ar ? "مهندسون وصنايعية" : "Professionals & craftspeople"}
          href="/home/engineer/professionals"
          locale={locale}
        >
          <ProfessionalCards rows={data.professionals} locale={locale} />
        </EngineerSection>
      </div>
      <EngineerSection
        title={ar ? "منتجات لمشاريعك" : "Materials for your projects"}
        href="/home/engineer/products"
        locale={locale}
      >
        <ProductCards rows={data.products} locale={locale} />
      </EngineerSection>
      <EngineerSection
        title={
          ar
            ? "محتوى يساعدك على الاختيار"
            : "A little guidance for your next decision"
        }
        locale={locale}
      >
        <div className="grid gap-md desktop:grid-cols-3">
          {(ar
            ? [
                "قارن عروض الأسعار على نفس المواصفات والوحدات، ثم راجع شروط التوريد والضمان قبل القرار.",
                "حدد الكميات ومكان الاستخدام لكل خامة. الصور المرجعية تساعد المعرض على فهم طلبك.",
                "اعرض صور أعمالك الفعلية، وحدد خدماتك ومناطق عملك بوضوح في الملف الشخصي.",
              ]
            : [
                "Compare quotes against identical specifications and units, then review delivery and warranty terms.",
                "Specify quantities and intended use for every material. Reference photos help showrooms understand the request.",
                "Show your actual work and clearly describe your services and service areas in your profile.",
              ]
          ).map((text) => (
            <Card key={text}>
              <p className="text-body-lg">{text}</p>
            </Card>
          ))}
        </div>
      </EngineerSection>
      <Card className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h2 className="text-title">
            {ar ? "لديك مشروع جديد؟" : "Something new on the drawing board?"}
          </h2>
          <p className="mt-2 text-body text-fg-secondary">
            {ar
              ? "اجمع احتياجات مشروعك وقارن العروض في مكان واحد."
              : "Bring your material requirements and supplier responses together."}
          </p>
        </div>
        <ButtonLink href="/home/engineer/requests/new">
          {ar ? "اطلب عرض سعر" : "Request a quote"}
        </ButtonLink>
      </Card>
    </div>
  );
}
