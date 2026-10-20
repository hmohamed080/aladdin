export const ENGINEER_LINKS = [
  { id: "home", href: "/home", ar: "الرئيسية", en: "Overview" },
  {
    id: "requests",
    href: "/home/engineer/requests",
    ar: "طلبات عروض الأسعار",
    en: "Quotation requests",
  },
  {
    id: "showrooms",
    href: "/home/engineer/showrooms",
    ar: "اكتشف المعارض",
    en: "Showrooms",
  },
  {
    id: "projects",
    href: "/home/profile/portfolio",
    ar: "مشاريعي",
    en: "My projects",
  },
  {
    id: "professionals",
    href: "/home/engineer/professionals",
    ar: "المهندسون والصنايعية",
    en: "Professionals",
  },
  {
    id: "products",
    href: "/home/engineer/products",
    ar: "المنتجات",
    en: "Products",
  },
  {
    id: "teams",
    href: "/home/engineer/teams",
    ar: "فرق العمل",
    en: "My teams",
  },
  {
    id: "saved",
    href: "/home/engineer/saved",
    ar: "المفضلة",
    en: "Saved ideas",
  },
  {
    id: "profile",
    href: "/home/profile",
    ar: "الملف الشخصي",
    en: "My profile",
  },
] as const;

export function isEngineer(
  account: { variant: string; accountType: string } | null,
): boolean {
  return (
    account?.variant === "professional" && account.accountType === "engineer"
  );
}
