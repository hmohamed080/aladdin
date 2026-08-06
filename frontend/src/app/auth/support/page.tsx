import { readPublicEnv } from "@/lib/env";
import { SupportPanel } from "@/features/auth/support-panel";

export const dynamic = "force-dynamic";

export default function SupportPage() {
  // The approved support contact is optional configuration; when unset the panel
  // shows a safe unavailable state rather than a fabricated address.
  const { NEXT_PUBLIC_SUPPORT_CONTACT } = readPublicEnv();
  return <SupportPanel contact={NEXT_PUBLIC_SUPPORT_CONTACT ?? null} />;
}
