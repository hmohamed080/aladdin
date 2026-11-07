import { readPublicEnv } from "@/lib/env";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { whatsappOtpDeliveryAuthorized, whatsappOtpDeliveryReconcile } from "@/lib/supabase/admin-server";
import { handleAttest } from "@/server/whatsapp-otp/attest";
import { expectedSourceEnvFor } from "@/server/whatsapp-otp/notify";

export const dynamic = "force-dynamic";

/** Worker -> app periodic reconciliation. See server/whatsapp-otp/attest.ts: signed with the notify secret, answers a signed authorized state. */
export async function POST(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = readPhoneVerificationEnv().notifySecret;
  } catch {
    secret = undefined;
  }
  let appEnv: string | undefined;
  try {
    appEnv = readPublicEnv().NEXT_PUBLIC_APP_ENV;
  } catch {
    appEnv = undefined;
  }
  return handleAttest(request, {
    secret,
    expectedSourceEnv: expectedSourceEnvFor(appEnv),
    reconcile: async (rows, drift) => {
      const r = await whatsappOtpDeliveryReconcile(rows, drift);
      return r.data !== null;
    },
    authorized: async () => {
      const r = await whatsappOtpDeliveryAuthorized();
      const d = r.data;
      return d && typeof d.enabled === "boolean" && Number.isSafeInteger(d.version) && d.version >= 0 ? { enabled: d.enabled, version: d.version } : null;
    },
  });
}
