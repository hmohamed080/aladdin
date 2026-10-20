import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireEngineer } from "@/server/queries/engineer";
import {
  listOrganizations,
  listProfessionals,
} from "@/server/queries/directory";
import { listCatalog } from "@/server/queries/commerce";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { Input, Button } from "@/components/ui/controls";
import {
  ShowroomCards,
  ProfessionalCards,
  ProductCards,
  InspirationCards,
} from "@/features/engineer/sections";
import { isUuid } from "@/features/purchase-requests/model";
export const dynamic = "force-dynamic";
export default async function EngineerDirectory({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ q?: string; supplier?: string }>;
}) {
  const { supabase } = await requireEngineer();
  const { section } = await params;
  const { q, supplier } = await searchParams;
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const ar = locale === "ar";
  if (
    !["showrooms", "products", "professionals", "inspiration"].includes(section)
  )
    notFound();
  const title =
    section === "inspiration"
      ? ar
        ? "مشاريع ملهمة"
        : "Project inspiration"
      : section === "showrooms"
        ? ar
          ? "اكتشف المعارض"
          : "Explore showrooms"
        : section === "products"
          ? ar
            ? "منتجات لمشاريعك"
            : "Materials for your projects"
          : ar
            ? "المهندسون والصنايعية"
            : "Engineers & craftspeople";
  const content =
    section === "inspiration" ? (
      <InspirationCards locale={locale} search={q} />
    ) : section === "showrooms" ? (
      <ShowroomCards
        rows={await listOrganizations(supabase, {
          types: ["showroom_dealer"],
          search: q,
        })}
        locale={locale}
      />
    ) : section === "products" ? (
      <ProductCards
        rows={await listCatalog(supabase, null, {
          search: q,
          supplierOrgId: supplier && isUuid(supplier) ? supplier : undefined,
        })}
        locale={locale}
      />
    ) : (
      <ProfessionalCards
        rows={await listProfessionals(supabase, {
          personas: ["engineer", "installer_technician"],
          search: q,
        })}
        locale={locale}
      />
    );
  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-headline">{title}</h1>
      <form className="flex gap-3">
        <label className="flex-1">
          <span className="sr-only">{ar ? "بحث" : "Search"}</span>
          <Input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder={ar ? "ابحث بالاسم…" : "Search by name…"}
          />
        </label>
        {supplier && <input type="hidden" name="supplier" value={supplier} />}
        <Button type="submit">{ar ? "بحث" : "Search"}</Button>
      </form>
      {content}
    </div>
  );
}
