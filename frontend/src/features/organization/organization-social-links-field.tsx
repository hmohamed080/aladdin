"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { displayLink, SocialLinksCard } from "@/features/onboarding/social-links-card";
import { normalizeSocialLink, normalizeSocialLinks, SOCIAL_PLATFORMS, type SocialLinks, type SocialPlatform } from "@/lib/onboarding/social-links";
import { saveSocialLinksAction } from "@/server/actions/organization-profile";

const toValues = (links: SocialLinks) =>
  Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, links[p] ?? ""])) as Record<SocialPlatform, string>;

/**
 * The showroom's business links (docs/frontend/showroom-social-links-onboarding.md). A manager (org.manage) edits
 * them here; everyone else sees them read-only. The links are shown to the review team and are not verified. A
 * showroom cannot clear its last link (the RPC refuses), so Save stays off when every link is blank.
 */
export function OrganizationSocialLinksField({ orgId, links, canManage }: { orgId: string; links: SocialLinks; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [saved, setSaved] = useState<SocialLinks>(links);
  const [values, setValues] = useState<Record<SocialPlatform, string>>(() => toValues(links));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const checked = normalizeSocialLinks(values);
  const anyLink = checked.ok && SOCIAL_PLATFORMS.some((p) => checked.links[p] !== null);
  const changed = checked.ok && SOCIAL_PLATFORMS.some((p) => checked.links[p] !== saved[p]);
  const allBlank = checked.ok && !anyLink;
  const hasSaved = SOCIAL_PLATFORMS.some((p) => saved[p] !== null);
  const hasProp = SOCIAL_PLATFORMS.some((p) => links[p] !== null);

  const onSave = async () => {
    setNotice(null);
    setError(null);
    setBusy(true);
    let result: Awaited<ReturnType<typeof saveSocialLinksAction>>;
    try {
      result = await saveSocialLinksAction(orgId, values);
    } catch {
      result = { ok: false, code: "failed" };
    } finally {
      setBusy(false);
    }
    if (!result.ok) {
      setError(t(`showroomSettings.links.error.${result.code}`));
      return;
    }
    setSaved(result.links);
    setValues(toValues(result.links));
    setNotice(t("showroomSettings.links.saved"));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-sm" data-testid="organization-social-links-field">
      <p className="text-label font-medium text-fg-secondary">{t("showroomSettings.links.label")}</p>
      {canManage ? (
        <>
          <SocialLinksCard
            values={values}
            onChange={(p, v) => {
              setValues((prev) => ({ ...prev, [p]: v }));
              setNotice(null);
              setError(null);
            }}
            showErrors={allBlank && changed}
            idPrefix="settings-links"
          />
          {!hasSaved && !changed ? <p className="text-label text-fg-muted" data-testid="organization-social-links-empty">{t("showroomSettings.links.empty")}</p> : null}
          {error ? <InlineError>{error}</InlineError> : null}
          {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
          <div className="flex items-center gap-sm">
            <Button type="button" size="sm" onClick={onSave} disabled={busy || !checked.ok || !anyLink || !changed} data-testid="organization-social-links-save">
              {busy ? t("showroomSettings.links.saving") : t("showroomSettings.links.save")}
            </Button>
            <p className="text-label text-fg-muted">{t("showroomSettings.links.hint")}</p>
          </div>
        </>
      ) : hasProp ? (
        <ul className="flex flex-col gap-1" data-testid="organization-social-links-readonly">
          {SOCIAL_PLATFORMS.map((p) => {
            const url = links[p];
            if (!url) return null;
            // Only a stored https link becomes an anchor; anything else is shown as inert text.
            const safe = url.startsWith("https://") && normalizeSocialLink(p, url).ok;
            return (
              <li key={p} className="flex flex-wrap items-baseline gap-2 text-body">
                <span className="text-fg-secondary">{t(`onboarding.business.links.platform.${p}`)}</span>
                {safe ? (
                  <a href={url} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="break-words text-fg underline">
                    {displayLink(url)}
                  </a>
                ) : (
                  <bdi dir="ltr" className="break-words text-fg">{url}</bdi>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body text-fg-muted" data-testid="organization-social-links-readonly-empty">—</p>
      )}
      {canManage || hasProp ? <p className="text-label text-fg-muted">{t("showroomSettings.links.unverifiedNote")}</p> : null}
    </div>
  );
}
