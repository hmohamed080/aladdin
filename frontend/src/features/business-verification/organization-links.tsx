import { Field } from "@/components/ui/primitives";
import type { TranslateFn } from "@/lib/i18n/translate";
import { normalizeSocialLink, type SocialPlatform } from "@/lib/onboarding/social-links";

export type OrganizationLinkValues = {
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  websiteUrl: string | null;
};

const PLATFORMS: readonly { platform: SocialPlatform; key: keyof OrganizationLinkValues; label: string }[] = [
  { platform: "facebook", key: "facebookUrl", label: "Facebook" },
  { platform: "instagram", key: "instagramUrl", label: "Instagram" },
  { platform: "tiktok", key: "tiktokUrl", label: "TikTok" },
  { platform: "website", key: "websiteUrl", label: "Web" },
];

/**
 * Links the business typed in; the reviewer sees them as unverified business info.
 * Only a stored value that still passes the shared validator and is https becomes an
 * anchor; anything else renders as inert text. Admin-only, never logged.
 */
export function OrganizationLinks({ links, t }: { links: OrganizationLinkValues; t: TranslateFn }) {
  const present = PLATFORMS.flatMap((p) => {
    const url = links[p.key];
    return url ? [{ ...p, url }] : [];
  });
  if (present.length === 0) return null;
  return (
    <Field label={t("businessVerification.admin.links")}>
      <ul className="flex flex-col gap-1">
        {present.map(({ platform, label, url }) => {
          const safe = normalizeSocialLink(platform, url).ok && url.startsWith("https://");
          return (
            <li key={platform} className="flex flex-wrap items-center gap-2">
              <span className="text-label text-fg-secondary">{label}</span>
              {safe ? (
                <a href={url} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="break-all text-accent hover:underline">{url}</a>
              ) : (
                <span dir="ltr" className="break-all text-fg">{url}</span>
              )}
              <span className="text-label text-fg-muted">{t("businessVerification.admin.linksUnverified")}</span>
            </li>
          );
        })}
      </ul>
    </Field>
  );
}
