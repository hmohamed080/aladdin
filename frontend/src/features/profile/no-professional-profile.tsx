"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { StatePanel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { UserIcon } from "@/components/ui/icons";

/**
 * What a consumer account sees at /home/profile.
 *
 * A professional profile is not something a consumer is missing — it is something
 * a consumer does not have, because they never claimed a trade. So the copy names
 * the account type rather than describing an absence, offers no "become a
 * professional" call to action (changing persona is the upgrade workflow's
 * business, not a link on a page they landed on by accident), and leads back home.
 *
 * Renders rather than redirects, for the reason `NoPersonalWorkspace` gives:
 * bouncing someone who typed a real URL teaches them nothing.
 */
export function NoProfessionalProfile() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-md py-xl" data-testid="no-professional-profile">
      <StatePanel
        icon={<UserIcon size={22} />}
        title={t("profile.notProfessional.title")}
        body={t("profile.notProfessional.body")}
      />
      <Link href="/home">
        <Button type="button" variant="outline">
          {t("profile.notProfessional.back")}
        </Button>
      </Link>
    </div>
  );
}
