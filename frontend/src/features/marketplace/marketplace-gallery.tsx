"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, XIcon } from "@/components/ui/icons";
import { marketplaceCopy } from "./marketplace-copy";
import type { Locale } from "./marketplace-types";
import styles from "./marketplace-detail.module.css";

/** A product carries between 1 and 4 images (seller upload limit; the first is the cover). */
export const MAX_PRODUCT_IMAGES = 4;

/**
 * Product image carousel: vertical thumbnails, previous/next, swipe, arrow keys and a zoom view.
 * With a single image it renders just the picture — no controls to operate.
 */
export function MarketplaceGallery({ images, name, locale, dir }: { images: string[]; name: string; locale: Locale; dir: "rtl" | "ltr" }) {
  const t = marketplaceCopy[locale];
  const list = images.slice(0, MAX_PRODUCT_IMAGES);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [closing, setClosing] = useState(false);
  const startX = useRef<number | null>(null);
  const many = list.length > 1;
  const go = (delta: number) => setIndex((i) => (i + delta + list.length) % list.length);
  // In RTL the "next" image is to the visual left.
  const step = (visual: "left" | "right") => go((visual === "right") === (dir === "ltr") ? 1 : -1);

  const openZoom = () => { setClosing(false); setZoom(true); };
  /** Plays the exit animation, then unmounts (see onAnimationEnd on the overlay). */
  const closeZoom = () => setClosing(true);

  useEffect(() => {
    if (!zoom) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setClosing(true);
      if (e.key === "ArrowLeft") step("left");
      if (e.key === "ArrowRight") step("right");
    };
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onDocKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, dir, list.length]);

  const onKey = (e: KeyboardEvent) => {
    if (!many) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step("left"); }
    if (e.key === "ArrowRight") { e.preventDefault(); step("right"); }
  };
  const onDown = (e: PointerEvent) => { startX.current = e.clientX; };
  const onUp = (e: PointerEvent) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) < 6 && (e.target as HTMLElement).tagName === "IMG") { openZoom(); return; }
    if (Math.abs(dx) < 40) return;
    step(dx < 0 ? "left" : "right");
  };

  return (
    <section aria-roledescription={many ? "carousel" : undefined} aria-label={t.gallery} className={styles.gallery} onKeyDown={onKey}>
      {many ? (
        <ul className={styles.thumbs}>
          {list.map((src, i) => (
            <li key={src}>
              <button type="button" aria-label={`${t.gallery} ${i + 1}`} aria-pressed={i === index}
                className={`${styles.thumb} ${i === index ? styles.thumbActive : ""}`} onClick={() => setIndex(i)}>
                <Image src={src} alt="" width={120} height={90} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.stage} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { startX.current = null; }}>
        <Image src={list[index]!} alt={name} fill priority={index === 0} sizes="(max-width: 1023px) 92vw, 46vw" className={styles.stageImage} />
        <button type="button" className={styles.zoomBtn} aria-label={t.zoom} onClick={openZoom}>
          <EyeIcon size={18} aria-hidden="true" />
        </button>
        {many ? (
          <>
            <button type="button" className={`${styles.nav} ${styles.navLeft}`} aria-label={dir === "rtl" ? t.next : t.prev} onClick={() => step("left")}>
              <ChevronLeftIcon size={20} aria-hidden="true" />
            </button>
            <button type="button" className={`${styles.nav} ${styles.navRight}`} aria-label={dir === "rtl" ? t.prev : t.next} onClick={() => step("right")}>
              <ChevronRightIcon size={20} aria-hidden="true" />
            </button>
            <p className={styles.count} dir="ltr" aria-live="polite">{index + 1} / {list.length}</p>
          </>
        ) : null}
      </div>

      {zoom ? (
        <div className={`${styles.lightbox} ${closing ? styles.lightboxOut : ""}`} role="dialog" aria-modal="true" aria-label={t.zoom}
          onClick={closeZoom} onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) { setZoom(false); setClosing(false); } }}>
          <button type="button" className={styles.lightboxClose} aria-label={t.close} onClick={closeZoom}><XIcon size={22} aria-hidden="true" /></button>
          <div className={styles.lightboxStage} onClick={(e) => e.stopPropagation()}>
            <div className={styles.lightboxImg} key={index}>
              <Image src={list[index]!} alt={name} fill sizes="100vw" style={{ objectFit: "contain" }} />
            </div>
            {many ? (
              <>
                <button type="button" className={`${styles.lightboxNav} ${styles.navLeft}`} aria-label={dir === "rtl" ? t.next : t.prev} onClick={() => step("left")}>
                  <ChevronLeftIcon size={24} aria-hidden="true" />
                </button>
                <button type="button" className={`${styles.lightboxNav} ${styles.navRight}`} aria-label={dir === "rtl" ? t.prev : t.next} onClick={() => step("right")}>
                  <ChevronRightIcon size={24} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
          {many ? (
            <ul className={styles.lightboxThumbs} onClick={(e) => e.stopPropagation()}>
              {list.map((src, i) => (
                <li key={src}>
                  <button type="button" aria-label={`${t.gallery} ${i + 1}`} aria-pressed={i === index}
                    className={`${styles.lightboxThumb} ${i === index ? styles.thumbActive : ""}`} onClick={() => setIndex(i)}>
                    <Image src={src} alt="" width={96} height={72} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
