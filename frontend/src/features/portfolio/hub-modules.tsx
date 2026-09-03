import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { LayersIcon, ScrollIcon } from "@/components/ui/icons";
import { ChipList } from "@/features/home/parts";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { ProfessionalAssetSummary } from "@/server/queries/portfolio";
import { MediaFrame } from "./media-frame";

/**
 * The Portfolio and Certificates modules on the profile hub.
 *
 * COMPOSITION FROM `04-account-overview.jpeg`: a titled card with an icon, a line
 * of explanation, one number set large, a supporting line under it, and a single
 * "enter" action at the foot. That is the reference's module shape and these
 * adopt it — which is also why they sit in the same grid as the existing cards
 * rather than in a section of their own.
 *
 * WHAT THE REFERENCE HAS THAT THESE DO NOT: an illustration per card, and a row
 * of skill chips under the certificate count. There is no illustration pipeline
 * in this product, and the chips in the reference are a skills taxonomy that
 * `user_trades` already renders elsewhere on this page — repeating it here would
 * be the same claim twice. The portfolio card fills that visual weight with the
 * thing it actually has: a real photograph.
 *
 * SERVER COMPONENTS. Neither takes an action or holds state, so neither needs to
 * be a client component, and the preview below is a plain `<img>` pointed at the
 * public media route — which resolves only for a published item, so the hub
 * cannot leak a private photo even to its own owner's shoulder-surfer.
 */
export function PortfolioModule({
  summary,
  publicItemId,
  t,
}: {
  summary: ProfessionalAssetSummary;
  /** A PUBLISHED item id, or null. Only published items resolve through /p/media. */
  publicItemId: string | null;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-2">
        <LayersIcon size={18} className="shrink-0 text-fg-secondary" />
        <h3 className="text-title text-fg">{t("profile.portfolio.title")}</h3>
      </div>
      <p className="text-label text-fg-secondary">{t("profile.portfolio.body")}</p>

      {publicItemId ? (
        <MediaFrame className="aspect-[16/9]">
          {/* The media route streams bytes behind a short-lived signed URL;
              next/image would need a loader that caches it past the moment the
              item stops being published. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/p/media/${publicItemId}`}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </MediaFrame>
      ) : null}

      <div className="flex items-end gap-3">
        <span className="text-heading text-fg">{summary.portfolioTotal}</span>
        <span className="pb-1 text-label text-fg-secondary">
          {summary.portfolioTotal === 0
            ? t("profile.portfolio.none")
            : t("profile.portfolio.split", {
                published: summary.portfolioPublished,
                privateCount: summary.portfolioPrivate,
              })}
        </span>
      </div>

      {summary.portfolioUnfinished > 0 ? (
        <p className="text-label text-warning-fg">
          {t("profile.portfolio.unfinished", { n: summary.portfolioUnfinished })}
        </p>
      ) : null}

      <Link href="/home/profile/portfolio" className="mt-auto">
        <Button type="button" variant="outline">
          {t("profile.portfolio.manage")}
        </Button>
      </Link>
    </Card>
  );
}

/**
 * The certificates module.
 *
 * Says a count and, when it applies, how many have run out — nothing else. There
 * is no "verified" number to show because no such fact exists (S2), and inventing
 * a reassuring one here is precisely how a self-declared list starts reading as a
 * checked one.
 */
export function CertificatesModule({
  summary,
  t,
}: {
  summary: ProfessionalAssetSummary;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-2">
        <ScrollIcon size={18} className="shrink-0 text-fg-secondary" />
        <h3 className="text-title text-fg">{t("profile.certificates.title")}</h3>
      </div>
      <p className="text-label text-fg-secondary">{t("profile.certificates.body")}</p>

      <div className="flex items-end gap-3">
        <span className="text-heading text-fg">{summary.certificateTotal}</span>
        <span className="pb-1 text-label text-fg-secondary">
          {summary.certificateTotal === 0
            ? t("profile.certificates.none")
            : t("profile.certificates.held", { n: summary.certificateTotal })}
        </span>
      </div>

      {/* The person's own certificate names. Real data in the place the
          reference puts a label row — and the only thing there is to put there,
          since no verification state exists to show beside them (S2). */}
      {summary.certificateTitles.length > 0 ? (
        <ChipList items={summary.certificateTitles} empty="" />
      ) : null}

      {summary.certificatesExpired > 0 ? (
        <p className="text-label text-warning-fg">
          {t("profile.certificates.expired", { n: summary.certificatesExpired })}
        </p>
      ) : null}

      <p className="text-label text-fg-muted">{t("profile.certificates.privateNote")}</p>

      <Link href="/home/profile/certificates" className="mt-auto">
        <Button type="button" variant="outline">
          {t("profile.certificates.manage")}
        </Button>
      </Link>
    </Card>
  );
}
