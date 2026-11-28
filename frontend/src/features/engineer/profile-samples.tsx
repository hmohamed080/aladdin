import "server-only";
import { ButtonLink } from "@/components/ui/controls";
import { StarIcon, BriefcaseIcon, BuildingIcon, PackageIcon, UsersIcon, ShieldIcon, PencilIcon } from "@/components/ui/icons";
import { SamplePhoto } from "./sample-content";
import type { Locale } from "@/lib/i18n/locales";

export function ProfileSampleCards({ locale, kind }: { locale: Locale; kind: "projects" | "showrooms" | "craftspeople" | "team" }) {
  const ar = locale === "ar";
  const people = kind === "craftspeople" || kind === "team";
  const titles = kind === "projects"
    ? (ar ? ["فيلا — التجمع الخامس", "مكتب إداري — العاصمة", "مطعم — الشيخ زايد"] : ["Villa — New Cairo", "Office — New Capital", "Restaurant — Sheikh Zayed"])
    : kind === "showrooms" ? ["Modern Art", "Best Trade", "Decor Hub"]
    : kind === "team" ? (ar ? ["م. سارة أحمد", "م. كريم شريف", "م. ندى يوسف"] : ["Sara Ahmed", "Karim Sherif", "Nada Youssef"])
    : (ar ? ["محمود حسن", "أحمد محمد", "محمد علي"] : ["Mahmoud Hassan", "Ahmed Mohamed", "Mohamed Ali"]);
  const roles = kind === "team" ? (ar ? ["مصممة داخلية", "مهندس معماري", "منسقة مشاريع"] : ["Interior designer", "Architect", "Project coordinator"])
    : (ar ? ["كهربائي", "نقاش", "تركيب بديل خشب"] : ["Electrician", "Painter", "Wall panel installer"]);
  const href = kind === "projects" ? "/home/profile/portfolio" : kind === "showrooms" ? "/home/engineer/showrooms" : kind === "team" ? "/home/engineer/teams" : "/home/engineer/professionals";
  return <div className="engineer-profile-cards">{titles.map((title, i) => <article key={title} className={`engineer-profile-card ${people ? "engineer-profile-person" : ""}`}>
    <SamplePhoto index={people ? (kind === "team" ? [1, 0, 1][i]! : [2, 3, 0][i]!) : [2, 0, 3][i]!} portrait={people} />
    <h3>{title}</h3>
    <p className="text-fg-secondary">{people ? roles[i] : kind === "projects" ? (ar ? "تصميم داخلي · تنفيذ" : "Interior design · Execution") : (ar ? "تشطيبات وديكور" : "Finishes & decor")}</p>
    {kind !== "team" && <div className="engineer-profile-rating"><StarIcon size={14} /><bdi>{(4.8 - i * .1).toFixed(1)} ({56 - i * 8})</bdi></div>}
    <ButtonLink href={href} variant="ghost" size="sm" className="w-full">{kind === "projects" ? (ar ? "إدارة مشاريعي" : "Manage projects") : kind === "showrooms" ? (ar ? "اكتشف المعارض" : "Explore showrooms") : kind === "team" ? (ar ? "إدارة الفريق" : "Manage team") : (ar ? "عرض المتخصصين" : "Explore professionals")}</ButtonLink>
  </article>)}</div>;
}

export function ProfileSampleServices({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const labels = ar ? ["التصميم المعماري", "التصميم الداخلي", "إدارة المشاريع", "الإشراف على التنفيذ", "التصميم ثلاثي الأبعاد", "استشارات فنية"] : ["Architecture", "Interior design", "Project management", "Site supervision", "3D design", "Technical consulting"];
  const icons = [BuildingIcon, PencilIcon, BriefcaseIcon, UsersIcon, PackageIcon, ShieldIcon];
  return <div className="engineer-profile-services">{labels.map((label, i) => { const Icon = icons[i]!; return <div key={label}><Icon size={26} /><span>{label}</span></div>; })}</div>;
}

export function ProfileSampleReview({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return <figure className="engineer-profile-review"><div className="flex items-center gap-3"><SamplePhoto portrait index={0} /><div><figcaption>{ar ? "أحمد السيد — تقييم توضيحي" : "Ahmed El Sayed — sample review"}</figcaption><div className="engineer-profile-rating" aria-label={ar ? "٥ من ٥" : "5 out of 5"}>{[0,1,2,3,4].map(i => <StarIcon key={i} size={16} />)}</div></div></div><blockquote>{ar ? "تعاون منظم واهتمام بالتفاصيل من أول التصميم لحد التنفيذ. المساحات طلعت عملية ومريحة، والنتيجة قريبة جدًا من التصور اللي اتفقنا عليه." : "Thoughtful design and attention to detail from the first sketch through execution. The spaces feel practical and comfortable, just as we imagined."}</blockquote></figure>;
}
