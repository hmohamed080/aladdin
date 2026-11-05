"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { CheckIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { normalizeSocialLink, socialLinksError, SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/onboarding/social-links";

/** The shortest honest rendering of a canonical link: host and path, without `https://` or `www.`. */
export function displayLink(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/^www\./, "");
}

/**
 * The showroom links card (docs/frontend/showroom-social-links-onboarding.md, "The screen").
 *
 * Controlled: the values live with the caller (they are saved with the draft). The card owns only which inputs are
 * open, and even that is overridden where hiding would hide a problem:
 *   * a NON-EMPTY INVALID value is always open — its toggle is ignored — so an error can never be collapsed away;
 *   * after a failed Next (`showErrors`) with no valid link, Instagram is open so the person has somewhere to start.
 * A link counts as added whether or not its input is open.
 */
export function SocialLinksCard({
  values,
  onChange,
  showErrors,
  focusPlatform = null,
  idPrefix = "social-links",
}: {
  values: Record<SocialPlatform, string>;
  onChange: (platform: SocialPlatform, value: string) => void;
  showErrors: boolean;
  focusPlatform?: SocialPlatform | null;
  idPrefix?: string;
}) {
  const { t } = useI18n();
  // A resumed draft opens on the links it already has, so the person sees what is saved.
  const [open, setOpen] = useState<ReadonlySet<SocialPlatform>>(
    () => new Set(SOCIAL_PLATFORMS.filter((p) => values[p].trim() !== "")),
  );
  // Each request is a new object, so asking for the same input twice still moves focus there.
  const [focusRequest, setFocusRequest] = useState<{ platform: SocialPlatform } | null>(null);
  const inputRefs = useRef<Partial<Record<SocialPlatform, HTMLInputElement | null>>>({});

  // A new focus request from the caller opens that input (adjusting state during render, not in an effect).
  const [prevFocus, setPrevFocus] = useState<SocialPlatform | null>(null);
  if (focusPlatform !== prevFocus) {
    setPrevFocus(focusPlatform);
    if (focusPlatform) {
      setOpen((o) => (o.has(focusPlatform) ? o : new Set([...o, focusPlatform])));
      setFocusRequest({ platform: focusPlatform });
    }
  }

  // Runs after the panel is un-hidden, so the input is focusable.
  useEffect(() => {
    if (focusRequest) inputRefs.current[focusRequest.platform]?.focus();
  }, [focusRequest]);

  const results = Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, normalizeSocialLink(p, values[p])])) as Record<
    SocialPlatform,
    ReturnType<typeof normalizeSocialLink>
  >;
  const added = SOCIAL_PLATFORMS.filter((p) => {
    const r = results[p];
    return r.ok && r.url !== null;
  }).length;
  const required = showErrors && socialLinksError(values) === "onboarding.error.linksRequired";

  // The required message opens Instagram, and it stays open afterwards: the first valid character clears `required`,
  // and an input the person is typing in must never collapse under the cursor.
  const [prevRequired, setPrevRequired] = useState(false);
  if (required !== prevRequired) {
    setPrevRequired(required);
    if (required) setOpen((o) => (o.has("instagram") ? o : new Set([...o, "instagram"])));
  }

  const forcedOpen = (p: SocialPlatform) => !results[p].ok || (required && p === "instagram");
  const isOpen = (p: SocialPlatform) => open.has(p) || forcedOpen(p);

  const toggle = (p: SocialPlatform) => {
    if (forcedOpen(p)) return;
    const next = new Set(open);
    if (next.has(p)) next.delete(p);
    else {
      next.add(p);
      setFocusRequest({ platform: p });
    }
    setOpen(next);
  };

  const titleId = `${idPrefix}-title`;
  const requiredId = `${idPrefix}-required`;

  return (
    <section className="flex flex-col gap-sm rounded-md border border-strong p-md" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={titleId} className="text-body font-medium text-fg">
          {t("onboarding.business.links.title")}
        </h3>
        <p className="text-label text-fg-muted" aria-live="polite">
          {added === 0 ? t("onboarding.business.links.counterNone") : t("onboarding.business.links.counterSome", { count: added })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SOCIAL_PLATFORMS.map((p) => {
          const r = results[p];
          const valid = r.ok && r.url !== null;
          return (
            <Button
              key={p}
              variant={r.ok ? "outline" : "danger"}
              size="sm"
              aria-expanded={isOpen(p)}
              aria-controls={`${idPrefix}-${p}-panel`}
              aria-describedby={!r.ok ? `${idPrefix}-${p}-error` : required ? requiredId : undefined}
              onClick={() => toggle(p)}
            >
              {t(`onboarding.business.links.platform.${p}`)}
              {valid ? (
                <>
                  <CheckIcon size={16} className="text-success" />
                  <span className="sr-only">{t("onboarding.business.links.saved")}</span>
                </>
              ) : null}
            </Button>
          );
        })}
      </div>

      {SOCIAL_PLATFORMS.map((p) => {
        const r = results[p];
        const inputId = `${idPrefix}-${p}`;
        const errorId = `${inputId}-error`;
        const previewId = `${inputId}-preview`;
        // Tailwind's `flex` beats the `hidden` attribute (author CSS over the user-agent rule), so the closed state is a class too.
        return (
          <div key={p} id={`${inputId}-panel`} hidden={!isOpen(p)} className={isOpen(p) ? "flex flex-col gap-1.5" : "hidden"}>
            <label htmlFor={inputId} className="text-label font-medium text-fg-secondary">
              {t(`onboarding.business.links.platform.${p}`)}
            </label>
            <Input
              ref={(el) => {
                inputRefs.current[p] = el;
              }}
              id={inputId}
              dir="ltr"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={300}
              value={values[p]}
              placeholder={t(`onboarding.business.links.placeholder.${p}`)}
              aria-invalid={!r.ok || undefined}
              aria-describedby={!r.ok ? errorId : r.url ? previewId : undefined}
              onChange={(e) => onChange(p, e.target.value)}
            />
            {!r.ok ? (
              <div id={errorId}>
                <InlineError>{t(`onboarding.business.links.error.${r.reason}`)}</InlineError>
              </div>
            ) : r.url ? (
              <p id={previewId} className="break-words text-label text-fg-muted">
                {t("onboarding.business.links.preview")}: <bdi dir="ltr" className="text-fg-secondary">{displayLink(r.url)}</bdi>
              </p>
            ) : null}
          </div>
        );
      })}

      {required ? (
        <div id={requiredId}>
          <InlineError>{t("onboarding.error.linksRequired")}</InlineError>
        </div>
      ) : null}
    </section>
  );
}
