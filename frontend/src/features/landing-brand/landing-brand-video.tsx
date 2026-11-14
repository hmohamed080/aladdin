"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { landingVideos } from "../landing-preview/landing-video-content";
import { brandContent } from "./landing-brand-content";
import { BrandIcon } from "./landing-brand-icons";
import styles from "./landing-brand.module.css";

/** Hero "Watch the video" button: opens the existing landing clips in a dialog (first clip, with a switcher). */
export function LandingBrandVideo() {
  const { locale, dir } = useI18n();
  const t = brandContent[locale].hero;
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<number>(landingVideos[0].id);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const current = landingVideos.find((v) => v.id === id) ?? landingVideos[0];

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <>
      <button type="button" className={styles.videoBtn} onClick={() => { setFailed(false); setOpen(true); }}>
        <i><BrandIcon name="play" size={22} /></i>
        <span>{t.video}</span>
      </button>
      <dialog ref={dialog} dir={dir} className={styles.videoDialog} aria-label={current[locale].title} onClose={() => { player.current?.pause(); setOpen(false); }} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        {open ? (
          <>
            <header><h2>{current[locale].title}</h2><button type="button" onClick={() => setOpen(false)}>{locale === "ar" ? "إغلاق" : "Close"}</button></header>
            <video key={current.id} ref={player} src={`/preview/landing/videos/${current.id}.mp4`} poster={`/preview/landing/videos/${current.id}.jpg`} controls playsInline autoPlay preload="metadata" aria-label={current[locale].title} onError={() => setFailed(true)} />
            {failed ? <p role="alert">{locale === "ar" ? "تعذّر تشغيل الفيديو." : "The video could not be played."}</p> : <p>{current[locale].description}</p>}
            <ul>
              {landingVideos.map((v) => (
                <li key={v.id}><button type="button" aria-pressed={v.id === current.id} onClick={() => { setFailed(false); setId(v.id); }}>{v[locale].title}<small dir="ltr">{v.duration}</small></button></li>
              ))}
            </ul>
          </>
        ) : null}
      </dialog>
    </>
  );
}
