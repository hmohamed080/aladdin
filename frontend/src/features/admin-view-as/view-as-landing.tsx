"use client";

import { useI18n } from "@/lib/i18n/context";
import { ACCOUNT_VIEWS, type ViewAsKind } from "@/lib/admin/view-as/registry";
import { StatePanel } from "@/components/ui/primitives";

/** Foundation stage: the registered sections appear here as they ship; until then the shell says so plainly. */
export function ViewAsLanding({ kind }: { kind: ViewAsKind }) {
  const { t } = useI18n();
  const sections = ACCOUNT_VIEWS[kind].sections;
  if (sections.length === 0) return <StatePanel title={t("admin.viewAs.sectionsPending")} />;
  return null;
}
