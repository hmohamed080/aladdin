import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { AuthStageCard, AuthStageHeader, AuthStageLinks } from "@/features/entry-auth/auth-stage";

/**
 * The shared header + body + links block for every account-access surface (Sign In,
 * Sign Up, Recovery, Verify). It renders inside the `AuthStage` composition that
 * `app/auth/layout.tsx` provides: the 2026 logo, an optional account badge, the title
 * and the form in one bordered card, then the links in a second box (Instagram style).
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
    <>
      <AuthStageCard>
        <AuthStageHeader appName={t("common.appName")} badge={badge} title={title} description={subtitle} />
        {children}
      </AuthStageCard>
      {footer ? <AuthStageLinks>{footer}</AuthStageLinks> : null}
    </>
  );
}
