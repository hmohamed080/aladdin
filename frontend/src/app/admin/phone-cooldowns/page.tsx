import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/ui/format";
import { toE164 } from "@/lib/contact/phone";
import { requireAdminRoute } from "@/server/authorization/admin";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { Input, LabeledField, Button } from "@/components/ui/controls";
import { PhoneIcon } from "@/components/ui/icons";
import { PhoneCooldownOverride } from "@/features/admin-ops/phone-cooldown-override";

export const dynamic = "force-dynamic";

type Status = { phone: string; cooldown_until: string | null; reserved: boolean; overrides: { created_at: string; reason: string }[] };

/**
 * Support tool for the second-phone cooldown: look a number up, see whether it is in its 30-day cooldown, and lift
 * it with a mandatory reason. Only `phones.cooldown_override` reaches this page and the RPCs re-check it.
 */
export default async function PhoneCooldownsPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  await requireAdminRoute("/admin/phone-cooldowns");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const raw = ((await searchParams).phone ?? "").trim();
  const phone = raw ? toE164(raw) : null;

  let status: Status | null = null;
  let failed = false;
  if (phone) {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("admin_phone_cooldown_status", { p_phone: phone });
    if (error) failed = true;
    else status = data as Status;
  }

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-phone-cooldowns">
      <AdminHeader locale={locale} title={t("phoneCooldown.title")} subtitle={t("phoneCooldown.subtitle")} />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-sm">
          <LabeledField label={t("phoneCooldown.phoneLabel")} htmlFor="cooldown-phone" hint={t("phoneCooldown.phoneHint")}>
            <Input id="cooldown-phone" name="phone" dir="ltr" defaultValue={raw} placeholder="+201012345678" />
          </LabeledField>
          <Button type="submit" variant="outline">{t("phoneCooldown.lookUp")}</Button>
        </form>
      </Card>

      {raw && !phone ? <StatePanel title={t("phoneCooldown.errors.invalid")} /> : null}
      {failed ? <StatePanel tone="danger" title={t("states.genericRetry")} /> : null}
      {status ? (
        // Card renders no extra props, so the test hook sits on a wrapper.
        <div data-testid="phone-cooldown-status">
          <Card>
            <SectionTitle icon={<PhoneIcon size={18} />}>
              <span dir="ltr">{status.phone}</span>
            </SectionTitle>
            <div className="mt-md flex flex-col gap-sm">
              <p className="text-body text-fg">
                {status.cooldown_until
                  ? t("phoneCooldown.inCooldown", { date: formatDateTime(status.cooldown_until, locale) })
                  : status.reserved
                    ? t("phoneCooldown.reserved")
                    : t("phoneCooldown.free")}
              </p>
              {status.cooldown_until ? <PhoneCooldownOverride phone={status.phone} /> : null}
              {status.overrides.length > 0 ? (
                <div className="border-t pt-sm">
                  <p className="text-label font-medium text-fg-secondary">{t("phoneCooldown.history")}</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {status.overrides.map((o) => (
                      <li key={o.created_at} className="text-label text-fg-secondary">
                        {formatDateTime(o.created_at, locale)} · <span dir="auto">{o.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
