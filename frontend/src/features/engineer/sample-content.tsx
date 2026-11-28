import "server-only";
import { readPublicEnv } from "@/lib/env";
import { ButtonLink } from "@/components/ui/controls";
import { MapPinIcon, StarIcon } from "@/components/ui/icons";
import { EngineerSection } from "./sections";
import { SampleFavorite } from "./sample-favorite";
import type { Locale } from "@/lib/i18n/locales";

/** Owner-requested visual fixtures are impossible on a hosted database. */
export function useLocalEngineerSamples() {
  const env = readPublicEnv();
  return (
    env.NEXT_PUBLIC_APP_ENV === "local" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
    )
  );
}

export function SamplePhoto({
  index,
  portrait = false,
  className = "",
}: {
  index: number;
  portrait?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={portrait ? "صورة شخصية توضيحية" : "تصميم معماري توضيحي"}
      className={`engineer-sample-photo ${portrait ? "engineer-sample-portrait" : ""} ${className}`}
      style={{
        backgroundImage: `url(/assets/engineer/${portrait ? "portraits" : "interiors"}.webp)`,
        backgroundPosition: `${index % 2 ? "100%" : "0%"} ${index > 1 ? "100%" : "0%"}`,
      }}
    />
  );
}

export function SampleShowrooms({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const names = ["Modern Art", "Best Trade", "Decor Hub", "Elite Finish"];
  const places = ar
    ? [
        "مدينة نصر، القاهرة",
        "التجمع الخامس، القاهرة",
        "مصر الجديدة، القاهرة",
        "الشيخ زايد، الجيزة",
      ]
    : [
        "Nasr City, Cairo",
        "New Cairo",
        "Heliopolis, Cairo",
        "Sheikh Zayed, Giza",
      ];
  return (
    <div className="engineer-photo-grid">
      {names.map((name, i) => (
        <article className="engineer-discovery-card" key={name}>
          <div className="relative">
            <SamplePhoto index={i} />
            <SampleFavorite label={ar ? `حفظ ${name}` : `Save ${name}`} />
          </div>
          <div className="engineer-card-copy">
            <div className="flex items-center justify-between gap-2">
              <h3 dir="ltr">{name}</h3>
              <span className="engineer-showroom-monogram">
                {name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")}
              </span>
            </div>
            <div className="engineer-card-meta">
              <StarIcon size={14} />
              <bdi>
                {(4.8 - i * 0.1).toFixed(1)} ({120 - i * 19})
              </bdi>
            </div>
            <div className="engineer-card-meta">
              <MapPinIcon size={14} />
              {places[i]}
            </div>
            <div className="engineer-card-tags">
              {(ar
                ? ["ديكورات", "إضاءة", "تشطيبات"]
                : ["Decor", "Lighting", "Finishes"]
              ).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <ButtonLink
              href="/home/engineer/requests/new"
              variant="accent"
              size="sm"
              className="w-full"
            >
              {ar ? "طلب عرض سعر" : "Request a quote"}
            </ButtonLink>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SampleProjects({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const titles = ar
    ? [
        "شقة سكنية — التجمع الخامس",
        "فيلا — الشيخ زايد",
        "مكتب إداري — القاهرة الجديدة",
        "مطعم — الساحل الشمالي",
      ]
    : [
        "Apartment — New Cairo",
        "Villa — Sheikh Zayed",
        "Office — New Cairo",
        "Restaurant — North Coast",
      ];
  const authors = ar
    ? ["م. سارة محمود", "م. أحمد خالد", "م. كريم طارق", "Studio Design"]
    : ["Sara Mahmoud", "Ahmed Khaled", "Karim Tarek", "Studio Design"];
  return (
    <div className="engineer-photo-grid">
      {titles.map((title, i) => (
        <article className="engineer-discovery-card" key={title}>
          <div className="relative">
            <SamplePhoto index={[1, 2, 0, 3][i]!} />
            <SampleFavorite label={ar ? `حفظ ${title}` : `Save ${title}`} />
          </div>
          <div className="engineer-card-copy">
            <div className="flex items-center gap-2">
              <SamplePhoto portrait index={i} />
              <div>
                <h3>{title}</h3>
                <p className="engineer-card-meta">{authors[i]}</p>
              </div>
            </div>
            <div className="engineer-card-meta">
              <MapPinIcon size={14} />
              {ar ? "القاهرة، مصر" : "Cairo, Egypt"}
            </div>
            <div className="engineer-card-tags">
              {(ar
                ? ["تصميم داخلي", "تشطيبات", "ديكور"]
                : ["Interior", "Finishes", "Decor"]
              ).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SampleProfessionals({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <EngineerSection
      title={
        ar ? "المهندسون والصنايعية المميزون" : "Engineers and craftspeople"
      }
      href="/home/engineer/professionals"
      locale={locale}
    >
      <div className="engineer-people-grid">
        {(ar
          ? ["م. ياسر علي", "م. نورهان سمير", "محمد إسلام", "محمود فتحي"]
          : ["Yasser Ali", "Nourhan Samir", "Mohamed Islam", "Mahmoud Fathy"]
        ).map((name, i) => (
          <div className="engineer-person" key={name}>
            <div className="flex items-center gap-2">
              <SamplePhoto portrait index={i} />
              <div>
                <h3>{name}</h3>
                <p>
                  {ar
                    ? [
                        "مهندس معماري",
                        "مصممة داخلية",
                        "صنايعي تشطيبات",
                        "كهربائي",
                      ][i]
                    : [
                        "Architect",
                        "Interior designer",
                        "Finishing specialist",
                        "Electrician",
                      ][i]}
                </p>
              </div>
            </div>
            <ButtonLink
              href="/home/engineer/professionals"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
            >
              {ar ? "عرض المتخصصين" : "Explore professionals"}
            </ButtonLink>
          </div>
        ))}
      </div>
    </EngineerSection>
  );
}
