"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PlayIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { landingBlockContent } from "./landing-block-content";
import { landingVideos } from "./landing-video-content";
import layout from "./landing-ecosystem.module.css";
import styles from "./landing-videos.module.css";

export function LandingVideos() {
  const { locale, dir } = useI18n();
  const t = landingBlockContent[locale];
  const [selected, setSelected] = useState<number | null>(null);
  const [gallery, setGallery] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const current = landingVideos.find((item) => item.id === selected);
  const copy = current?.[locale];
  const open = gallery || selected !== null;
  const play = (id: number) => { setFailed(false); setSelected(id); setGallery(false); };
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return <section id="platform" className={layout.videosSection} aria-labelledby="videos-heading">
    <div className={layout.sectionHeading}>
      <h2 id="videos-heading" className={layout.heading}>{t.videos}</h2>
      <button type="button" className={layout.secondaryAction} onClick={() => setGallery(true)}>{t.videoAction}</button>
    </div>
    <div className={layout.videos}>
      {landingVideos.map((item) => <article key={item.id} className={layout.videoCard} data-content-slot="video">
        <button type="button" className={styles.thumbnail} onClick={() => play(item.id)} aria-label={`${locale === "ar" ? "شغّل" : "Play"}: ${item[locale].title}`}>
          <Image src={`/preview/landing/videos/${item.id}.jpg`} alt="" fill sizes="(max-width: 767px) 45vw, (max-width: 1023px) 30vw, 20vw" />
          <span className={styles.category}>{item[locale].category}</span>
          <span className={styles.play} aria-hidden="true"><PlayIcon size={24} /></span>
          <span className={styles.duration}>{item.duration}</span>
        </button>
        <h3>{item[locale].title}</h3><p>{item[locale].description}</p>
      </article>)}
    </div>
    <dialog ref={dialog} dir={dir} className={styles.dialog} aria-labelledby="preview-video-title" onClose={() => {
      player.current?.pause(); setSelected(null); setGallery(false); setFailed(false);
    }} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header className={styles.header}>
        <h2 id="preview-video-title">{copy?.title ?? t.videoAction}</h2>
        <Button variant="outline" onClick={() => dialog.current?.close()}>{locale === "ar" ? "إغلاق" : "Close"}</Button>
      </header>
      {current && copy ? <>
        <video key={current.id} ref={player} className={styles.video} src={`/preview/landing/videos/${current.id}.mp4`} poster={`/preview/landing/videos/${current.id}.jpg`} controls playsInline autoPlay preload="metadata" aria-label={copy.title} onError={() => setFailed(true)} />
        {failed ? <p role="alert">{locale === "ar" ? "تعذّر تشغيل الفيديو." : "The video could not be played."} <a href={`/preview/landing/videos/${current.id}.mp4`}>{locale === "ar" ? "افتح ملف الفيديو" : "Open video file"}</a></p> : null}
        <p className={styles.description}>{copy.description}</p>
        <Button variant="ghost" onClick={() => { player.current?.pause(); setSelected(null); setGallery(true); }}>{t.videoAction}</Button>
      </> : null}
      {gallery ? <ul className={styles.gallery}>{landingVideos.map((item) => <li key={item.id}>
        <button type="button" onClick={() => play(item.id)}>
          <Image src={`/preview/landing/videos/${item.id}.jpg`} alt="" width={96} height={64} />
          <span><strong>{item[locale].title}</strong><span>{item[locale].description}</span></span>
          <span dir="ltr">{item.duration}</span>
        </button>
      </li>)}</ul> : null}
    </dialog>
  </section>;
}
