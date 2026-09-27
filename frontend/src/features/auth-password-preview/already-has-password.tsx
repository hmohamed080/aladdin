"use client";

import { useI18n } from "@/lib/i18n/context";
import { AuthCard } from "@/features/auth/auth-card";

/** Migration page's "nothing to do" state — a Client Component for the same reason `RecoverySuccess` is (see its doc comment). */
export function AlreadyHasPassword() {
  const { t } = useI18n();
  return (
    <AuthCard title={t("authPasswordPreview.migration.title")} subtitle={t("authPasswordPreview.migration.alreadySet")}>
      <></>
    </AuthCard>
  );
}
