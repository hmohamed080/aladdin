"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { ButtonLink } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { landingBlockContent, landingLogos } from "./landing-block-content";
import styles from "./landing-details.module.css";

export type LandingDetail = "partners" | number;

export function LandingDetails({ detail, onClose }: { detail: LandingDetail | null; onClose: () => void }) {
  const { locale, dir } = useI18n();
  const t = landingBlockContent[locale];
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail !== null && !ref.current?.open) ref.current?.showModal();
    if (detail === null && ref.current?.open) ref.current.close();
  }, [detail]);
  const role = typeof detail === "number" ? t.roles[detail] : undefined;
  const title = role?.title ?? t.partnerAction;
  return <dialog ref={ref} className={styles.dialog} dir={dir} aria-labelledby="landing-detail-title" onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) ref.current?.close(); }}>
    <div className={styles.panel}>
      <header><h2 id="landing-detail-title">{title}</h2><button type="button" onClick={() => ref.current?.close()}>{locale === "ar" ? "إغلاق" : "Close"}</button></header>
      {role ? <><ul className={styles.features}>{role.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul><ButtonLink href="/auth/sign-up" variant="accent">{t.register}</ButtonLink></> : null}
      {detail === "partners" ? <><p>{t.brandNote}</p><ul className={styles.logos}>{landingLogos.map(({file,name}) => <li key={file}><Image src={`/preview/landing/partners/${file}`} alt={name} width={160} height={100} /><span>{name}</span></li>)}</ul></> : null}
    </div>
  </dialog>;
}
