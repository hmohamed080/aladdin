import type { ReactNode } from "react";
import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n/context";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * TEMPORARY craftsman (installer/technician) phone + password entry points —
 * docs/frontend/temporary-craftsman-auth.md. Isolated from `/auth/*` (which is
 * unchanged) and removable as one folder together with
 * `features/temporary-craftsman-auth`, `server/actions/temporary-craftsman-auth.ts`
 * and `lib/auth/craftsman-login-alias.ts`.
 *
 * Arabic RTL regardless of the visitor's language cookie (the approved
 * designs are Arabic), full screen, no navbar, no footer, not indexed.
 */
export default function TemporaryCraftsmanLayout({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="ar" dir="rtl">
      {children}
    </I18nProvider>
  );
}
