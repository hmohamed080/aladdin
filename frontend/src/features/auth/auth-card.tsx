import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { AuthStageHeader, AuthStageLinks } from "@/features/entry-auth/auth-stage";

/**
 * The shared header + body + links block for every account-access surface (Sign In,
 * Sign Up, Recovery, Verify). It renders inside the `AuthStage` composition that
 * `app/auth/layout.tsx` provides, so every flow reads like the showroom pages: the
 * 2026 logo, an optional account badge, a large title, then the form.
 */
export function AuthCard({
  title,
  subtitle,
  badge,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  /** e.g. the account type chosen on the landing page. */
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col">
      <AuthStageHeader appName={t("common.appName")} badge={badge} title={title} description={subtitle} />
      {children}
      {footer ? <AuthStageLinks>{footer}</AuthStageLinks> : null}
    </div>
  );
}
