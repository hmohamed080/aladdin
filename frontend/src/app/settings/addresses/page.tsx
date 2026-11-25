import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AddressesView } from "@/features/marketplace-addresses/addresses-view";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { readMapsConfig } from "@/lib/env/maps";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { loadBuyerAddresses } from "@/server/queries/marketplace-addresses";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";

export const dynamic = "force-dynamic";
export const metadata = { title: "My addresses | Aladdin", robots: { index: false, follow: false } };

/**
 * `/settings/addresses` — the buyer's saved delivery addresses (Marketplace PR 10). Person-level like the rest of `/settings`: no
 * workspace, no organization. It follows the Marketplace release flag (closed Marketplace = no page) and offers no way to order:
 * saving an address is the only thing it does, and checkout stays behind the ordering flag.
 */
export default async function AddressesSettingsPage() {
  if (!isMarketplacePreviewEnabled()) notFound();
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));
  const data = await loadBuyerAddresses();

  return (
    <div className="flex flex-col gap-lg" data-testid="addresses-settings">
      <div className="flex flex-col gap-1">
        <Link href="/settings/profile" className="text-label font-medium text-accent hover:underline">
          {t("buyerAddresses.page.back")}
        </Link>
        <h1 className="text-headline text-fg">{t("buyerAddresses.page.title")}</h1>
        <p className="text-body text-fg-secondary">{t("buyerAddresses.page.subtitle")}</p>
      </div>
      {data ? (
        <AddressesView addresses={data.addresses} accountPhone={data.accountPhone} mapsConfig={readMapsConfig()} />
      ) : (
        <p className="text-body text-fg-secondary" role="alert">{t("buyerAddresses.page.unavailable")}</p>
      )}
    </div>
  );
}
