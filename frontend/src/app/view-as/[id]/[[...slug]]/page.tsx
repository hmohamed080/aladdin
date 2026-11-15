import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireViewAs } from "@/server/view-as/guard";

export const dynamic = "force-dynamic";

/**
 * Phase 1 placeholder for every page of the exact view: the shell is real, the page bodies are extracted in Phase 2
 * (`AccountReader` per page). Re-establishes the gate itself: a layout alone is not enough on soft navigation.
 */
export default async function ViewAsPage({ params }: { params: Promise<{ id: string; slug?: string[] }> }) {
  const { id } = await params;
  await requireViewAs(id);
  const t = createTranslator(resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value));
  return <p className="text-body text-fg-muted">{t("admin.viewAs.exactPending")}</p>;
}
