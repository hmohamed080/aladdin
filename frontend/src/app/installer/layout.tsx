import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/context";

/**
 * Installer/technician phone + password entry points — the approved,
 * role-specific exception to the passwordless model —
 * docs/frontend/installer-phone-auth.md. Separate from the shared `/auth/*`
 * email flow, which keeps serving every account type. Logic lives in
 * `features/installer-phone-auth`, `server/actions/installer-phone-auth.ts`
 * and `lib/auth/craftsman-login-alias.ts`; the old `/temporary/craftsman/*`
 * URLs are permanent redirects in `next.config.ts`.
 *
 * Arabic RTL regardless of the visitor's language cookie (the approved
 * designs are Arabic), full screen, no navbar, no footer.
 */
export default function InstallerAuthLayout({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="ar" dir="rtl">
      {children}
    </I18nProvider>
  );
}
