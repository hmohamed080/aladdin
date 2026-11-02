import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { whatsappOtpNotificationRecord } from "@/lib/supabase/admin-server";
import { handleNotify } from "@/server/whatsapp-otp/notify";

export const dynamic = "force-dynamic";

/** Worker -> app alert callback. See server/whatsapp-otp/notify.ts: signed with its own secret, statistics only, idempotent. */
export async function POST(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = readPhoneVerificationEnv().notifySecret;
  } catch {
    secret = undefined;
  }
  return handleNotify(request, {
    secret,
    record: async (a) => {
      const r = await whatsappOtpNotificationRecord({ eventKey: a.eventKey, kind: a.kind, sourceEnv: a.sourceEnv, occurredAt: a.occurredAt, stats: a.stats });
      return { ok: r.data !== null };
    },
  });
}
