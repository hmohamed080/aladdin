"use client";

import Link from "next/link";
import { useEffect, type ComponentType, type CSSProperties } from "react";
import { LandingFooter } from "@/features/landing-preview/landing-footer";
import { LandingHeader } from "@/features/landing-preview/landing-header";
import {
  AlertIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChevronDownIcon,
  ClipboardIcon,
  ClockIcon,
  FileTextIcon,
  GlobeIcon,
  HandshakeIcon,
  LandmarkIcon,
  MailIcon,
  MoneyIcon,
  RefreshIcon,
  ScrollIcon,
  SettingsIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import brand from "@/styles/brand-2026.module.css";
import {
  LEGAL_UPDATED_AT,
  PRIVACY_CONTACT_EMAIL,
  legalDocument,
  type LegalBlock,
  type LegalDocument,
  type LegalDocumentKey,
  type LegalSection,
} from "@/features/legal/content";
import styles from "./legal-document.module.css";

type Icon = ComponentType<{ size?: number }>;

const RELATED: Record<LegalDocumentKey, { href: string; labelKey: "legal.seePrivacy" | "legal.seeDataDeletion" }> = {
  privacy: { href: "/legal/data-deletion", labelKey: "legal.seeDataDeletion" },
  dataDeletion: { href: "/legal/privacy", labelKey: "legal.seePrivacy" },
  terms: { href: "/legal/privacy", labelKey: "legal.seePrivacy" },
};

/** One icon per section id (from the approved layout); unknown ids fall back to a document. */
const SECTION_ICONS: Record<string, Icon> = {
  // privacy
  "who-we-are": BuildingIcon,
  "data-we-collect": FileTextIcon,
  "how-we-use": SettingsIcon,
  "legal-bases": ShieldIcon,
  sharing: UsersIcon,
  retention: ClockIcon,
  cookies: ClipboardIcon,
  security: ShieldIcon,
  "your-rights": UserIcon,
  deletion: TrashIcon,
  children: UsersIcon,
  transfers: GlobeIcon,
  changes: RefreshIcon,
  contact: MailIcon,
  // terms
  about: BuildingIcon,
  "who-can-use": UsersIcon,
  account: ShieldIcon,
  verification: BadgeCheckIcon,
  dealing: HandshakeIcon,
  content: CameraIcon,
  "acceptable-use": FileTextIcon,
  fees: MoneyIcon,
  "intellectual-property": ScrollIcon,
  termination: XIcon,
  disclaimer: AlertIcon,
  "governing-law": LandmarkIcon,
  // data deletion
  request: MailIcon,
  facebook: UserIcon,
  google: GlobeIcon,
  "what-is-deleted": TrashIcon,
  "what-we-keep": ShieldIcon,
  timeline: ClockIcon,
};
const iconFor = (id: string): Icon => SECTION_ICONS[id] ?? FileTextIcon;

/** "١. من نحن" / "1. Who we are" -> "من نحن" / "Who we are" (the page numbers sections itself: 01, 02 …). */
export function headingText(heading: string): string {
  return heading.replace(/^[0-9٠-٩]+\s*[.\-–]\s*/, "");
}

/** The section's first sentence (or first list item), used as the one-line summary; nothing is written for it. */
export function sectionSummary(section: LegalSection): string {
  const first = section.blocks[0];
  if (!first) return "";
  const raw = first.kind === "p" ? first.text : (first.items[0] ?? "");
  const match = raw.match(/^.+?[.!؟?](?=\s|$)/s);
  const sentence = match ? match[0] : raw;
  return sentence.length > 170 ? `${sentence.slice(0, 167).trimEnd()}…` : sentence;
}

/** Photographs per document (public/assets/legal): a wide hero and, for the contents column, a tall card. */
const PHOTOS: Record<LegalDocumentKey, { hero: string; aside?: string }> = {
  privacy: { hero: "hero-olive-arches", aside: "card-terracotta" },
  terms: { hero: "hero-arches", aside: "card-niche" },
  dataDeletion: { hero: "hero-olive-arches" },
};
const photoVar = (name: string) => `url(/assets/legal/${name}.jpg)`;

const pad = (n: number) => String(n).padStart(2, "0");

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") return <p>{block.text}</p>;
  const items = block.items.map((item) => <li key={item}>{item}</li>);
  return block.kind === "steps" ? <ol className="list-decimal">{items}</ol> : <ul className="list-disc">{items}</ul>;
}

function Hero({ doc, updated, photo }: { doc: LegalDocument; updated: string; photo: string }) {
  return (
    <section className={styles.hero} aria-labelledby="legal-title">
      <div className={styles.heroPhoto} aria-hidden="true" style={{ "--hero-photo": photoVar(photo) } as CSSProperties} />
      <div className={styles.heroText}>
        <p className={styles.eyebrow} aria-hidden="true">ALADDIN</p>
        <h1 id="legal-title">{doc.title}</h1>
        <p className={styles.intro}>{doc.intro}</p>
        {doc.notice ? <p className={styles.notice} role="note">{doc.notice}</p> : null}
        <p className={styles.updated}>
          <CalendarIcon size={18} aria-hidden="true" />
          <span>
            {doc.updatedLabel}: <time dateTime={doc.updatedAt ?? LEGAL_UPDATED_AT}>{updated}</time>
          </span>
        </p>
      </div>
    </section>
  );
}

/** Closing band: the document's own last section (the contact one) plus the monitored inbox. */
function ClosingBand({ doc }: { doc: LegalDocument }) {
  const last = doc.sections[doc.sections.length - 1];
  const first = last?.blocks[0];
  return (
    <section className={styles.cta} aria-labelledby="legal-cta-title">
      <div className={styles.ctaText}>
        <h2 id="legal-cta-title">{last ? headingText(last.heading) : doc.contactLabel}</h2>
        {first?.kind === "p" ? <p>{first.text}</p> : null}
      </div>
      <div className={styles.ctaContact}>
        <span className={styles.ctaIcon} aria-hidden="true"><MailIcon size={22} /></span>
        <div>
          <p className={styles.ctaLabel}>{doc.writeToUs}</p>
          <p className={styles.ctaEmail} dir="ltr">{PRIVACY_CONTACT_EMAIL}</p>
          <a className={styles.ctaButton} href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>
            {doc.contactLabel}
            <ArrowUpRightIcon size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

/** Privacy Policy and Terms: contents beside a list of collapsible sections. */
function PolicyLayout({ doc, asidePhoto }: { doc: LegalDocument; asidePhoto?: string }) {
  // a link from the contents (or a shared URL) opens the section it points to
  useEffect(() => {
    const openFromHash = () => {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target instanceof HTMLDetailsElement) {
        target.open = true;
        target.scrollIntoView({ block: "start" });
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  return (
    <div className={styles.layout}>
      <aside className={styles.aside}>
        <nav aria-label={doc.contentsLabel} className={styles.contents}>
          <h2 className={styles.contentsTitle}>
            <FileTextIcon size={20} aria-hidden="true" />
            {doc.contentsLabel}
          </h2>
          <ol>
            {doc.sections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <span className={styles.contentsNum}>{pad(index + 1)}</span>
                  {headingText(section.heading)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className={styles.asideCard} aria-hidden={doc.aside ? undefined : "true"} style={asidePhoto ? ({ "--aside-photo": photoVar(asidePhoto) } as CSSProperties) : undefined}>
          {doc.aside ? <p>{doc.aside}</p> : null}
        </div>
      </aside>

      <div className={styles.items}>
        {doc.sections.map((section, index) => {
          const Icon = iconFor(section.id);
          return (
            <details key={section.id} id={section.id} className={styles.item}>
              <summary>
                <span className={styles.itemIcon} aria-hidden="true"><Icon size={24} /></span>
                <span className={styles.itemHead}>
                  <h2>
                    <span className={styles.itemNum}>{pad(index + 1)}.</span> {headingText(section.heading)}
                  </h2>
                  <span className={styles.itemSummary}>{sectionSummary(section)}</span>
                </span>
                <ChevronDownIcon size={20} className={styles.chevron} aria-hidden="true" />
              </summary>
              <div className={styles.itemBody}>
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

/** Data Deletion: the request steps, then one card per topic. */
function DeletionLayout({ doc }: { doc: LegalDocument }) {
  const byId = new Map(doc.sections.map((s) => [s.id, s]));
  const request = byId.get("request");
  const stepsBlock = request?.blocks.find((b): b is Extract<LegalBlock, { kind: "steps" }> => b.kind === "steps");
  const note = request?.blocks.find((b): b is Extract<LegalBlock, { kind: "p" }> => b.kind === "p");
  const stepIcons: Icon[] = [MailIcon, FileTextIcon, ShieldIcon];
  const cardIds = ["facebook", "google", "what-we-keep", "timeline", "what-is-deleted"];
  return (
    <div className={styles.deletion}>
      {request && stepsBlock ? (
        <section className={styles.stepsCard} aria-labelledby="deletion-steps">
          <h2 id="deletion-steps">{headingText(request.heading)}</h2>
          <ol className={styles.steps}>
            {stepsBlock.items.map((text, index) => {
              const Icon = stepIcons[index] ?? FileTextIcon;
              return (
                <li key={text}>
                  <span className={styles.stepIcon} aria-hidden="true"><Icon size={26} /></span>
                  <span className={styles.stepNum}>{pad(index + 1)}</span>
                  <span className={styles.stepText}>{text}</span>
                </li>
              );
            })}
          </ol>
          {note ? <p className={styles.stepNote}>{note.text}</p> : null}
        </section>
      ) : null}

      <div className={styles.cards}>
        {request && stepsBlock ? (
          <section className={`${styles.card} ${styles.cardAccent}`} aria-labelledby="deletion-request">
            <span className={styles.cardIcon} aria-hidden="true"><MailIcon size={24} /></span>
            <h2 id="deletion-request">{headingText(request.heading)}</h2>
            <p>{stepsBlock.items[0]}</p>
            <a className={styles.cardButton} href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>
              <ArrowUpRightIcon size={16} aria-hidden="true" />
              <span dir="ltr">{PRIVACY_CONTACT_EMAIL}</span>
            </a>
          </section>
        ) : null}
        {cardIds.map((id) => {
          const section = byId.get(id);
          if (!section) return null;
          const Icon = iconFor(id);
          return (
            <section key={id} id={id} className={styles.card} aria-labelledby={`${id}-heading`}>
              <span className={styles.cardIcon} aria-hidden="true"><Icon size={24} /></span>
              <h2 id={`${id}-heading`}>{headingText(section.heading)}</h2>
              <div className={styles.cardBody}>
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A published legal document (Privacy Policy, Terms of Service, Data Deletion Instructions) in the visitor's
 * locale: the site's own header and footer around a hero, the document, and a closing contact band.
 * Public: no session needed (docs/frontend/legal-pages.md).
 */
export function LegalDocumentView({ documentKey }: { documentKey: LegalDocumentKey }) {
  const { t, locale, dir } = useI18n();
  const doc = legalDocument(documentKey, locale);
  const related = RELATED[documentKey];
  const updated = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${doc.updatedAt ?? LEGAL_UPDATED_AT}T00:00:00Z`),
  );
  return (
    <div className={`${brand.brand} ${styles.page}`} dir={dir}>
      <div className={styles.container}>
        <div className={styles.headerSlot}>
          <LandingHeader anchorBase="/" />
        </div>
      </div>
      <main className={styles.container}>
        <Hero doc={doc} updated={updated} photo={PHOTOS[documentKey].hero} />
        {documentKey === "dataDeletion" ? <DeletionLayout doc={doc} /> : <PolicyLayout doc={doc} asidePhoto={PHOTOS[documentKey].aside} />}
        <ClosingBand doc={doc} />
        <p className={styles.related}>
          <Link href={related.href}>{t(related.labelKey)}</Link>
          <Link href="/">{t("legal.backToHome")}</Link>
        </p>
      </main>
      <LandingFooter anchorBase="/" />
    </div>
  );
}
