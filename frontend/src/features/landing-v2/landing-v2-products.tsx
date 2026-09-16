"use client";

import Image from "next/image";
import { ButtonLink } from "@/components/ui/controls";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-v2-products.module.css";

const content = {
  ar: {
    eyebrow: "كل احتياجات التشطيبات",
    title: "كل منتجات التشطيبات في مكان واحد",
    description: "تصفح آلاف المنتجات، قارن الخيارات، وتواصل مباشرة مع الموردين والمعارض الموثوقين",
    cta: "استكشف المنتجات",
  },
  en: {
    eyebrow: "ALL YOUR FINISHING NEEDS",
    title: "All your finishing products in one place",
    description: "Browse thousands of products, compare options, and connect directly with trusted suppliers and showrooms",
    cta: "Explore Products",
  },
} as const;

/**
 * `section-2.png` IS the section — the whole laptop/plant/marble composition
 * plus its own baked-in "FROM / MATERIALS / TO / MASTERPIECES" wordmark at
 * the far right edge (already English, so it reads correctly in both
 * locales — nothing to translate or duplicate). This component adds ONLY
 * the copy that is NOT already in the asset: the eyebrow/title/description/
 * CTA, positioned over the plain dark-wall area the image already leaves
 * empty on its left third, per the approved full-page reference.
 */
export function LandingV2Products() {
  const { locale, dir } = useI18n();
  const copy = content[locale];

  return (
    <section id="platform" className={styles.section} data-landing-v2-part="Products">
      <div className={styles.frame}>
        <Image
          src="/landing-v2/sections/products-scene.png"
          alt=""
          fill
          sizes="100vw"
          className={styles.sceneImg}
        />
      </div>

      {/* A sibling of `.frame`, not a child (same structure as Section 3's
          `.overlay`) — `.frame` keeps `overflow: hidden` and a fixed
          aspect-ratio at every width (it's just the cropped image), so at
          mobile, where the overlay switches to a real static block stacked
          BELOW the image instead of on top of it (the cropped frame is too
          short there to hold this copy without the description running
          into the laptop art), it needs to not be fighting the image's own
          clipped box.

          `.copy` itself carries NO `dir` — it inherits `.copyWrap`'s pinned
          `direction: ltr` so its own logical properties (this component's
          `margin-inline-start` inset, and `text-align: start`) resolve
          physically LEFT at every locale. `dir={dir}` moves down to each
          text-bearing child instead, so only how the ARABIC SCRIPT itself
          shapes/reads changes per locale — not where the block sits or
          which edge its text hugs. (Before this, `dir={dir}` sat on
          `.copy` itself: in Arabic that flipped `margin-inline-start` to
          the physical right — zeroing the intended left inset — and
          flipped `text-align: start` to physical right, right-aligning
          the title/description against the reference's left-aligned
          composition.) */}
      <Reveal direction="start" className={styles.copyWrap}>
        <div className={styles.copy}>
          <p className={styles.eyebrow} dir={dir}>
            {copy.eyebrow}
          </p>
          <h2 className={styles.title} dir={dir}>{copy.title}</h2>
          <p className={styles.description} dir={dir}>{copy.description}</p>
          {/* The button is the only INLINE-level content directly inside
              `.copy`, so its line box belongs to `.copy` itself — which
              stays pinned `direction: ltr` for the margin fix above, and
              would otherwise always park this button on the physical
              left, same as English, regardless of locale. Wrapping it in
              its own `dir={dir}` block gives it its OWN line box that
              resolves `text-align: start` against ITS OWN direction, so
              it aligns to the same edge as the (separately `dir={dir}`)
              title/description above it. `ButtonLink` doesn't forward a
              `dir` prop to its `<a>`, but the wrapper's `direction: rtl`
              still inherits down into `.cta` (an `inline-flex` row),
              which flips the icon to the correct RTL-relative side too. */}
          <div dir={dir} className={styles.ctaWrap}>
            <ButtonLink href="/auth/sign-up" variant="accent" size="md" className={`${styles.cta} rounded-pill`}>
              <span dir={dir}>{copy.cta}</span>
              <span className={styles.ctaIcon}>
                <ArrowUpRightIcon size={16} strokeWidth={2} />
              </span>
            </ButtonLink>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
