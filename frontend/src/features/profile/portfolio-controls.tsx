"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HeartIcon, MessageIcon, MailIcon, SearchIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

export function PortfolioSearch({ ar }: { ar: boolean }) {
  const [result, setResult] = useState("");
  return <form className="portfolio-search" onSubmit={event => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") || "").trim().toLocaleLowerCase();
    if (!query) return;
    const match = Array.from(document.querySelectorAll<HTMLElement>("[data-portfolio-search]")).find(el => el.textContent?.toLocaleLowerCase().includes(query));
    if (match) { match.scrollIntoView({ block: "center", behavior: "auto" }); match.focus({ preventScroll: true }); }
    setResult(match ? "" : ar ? "لا توجد نتائج في هذا الملف" : "No matches in this portfolio");
  }}><input name="q" type="search" aria-label={ar ? "ابحث في القسم الحالي" : "Search current section"} placeholder={ar ? "ابحث في القسم الحالي…" : "Search current section…"} /><button aria-label={ar ? "بحث" : "Search"}><SearchIcon size={18} /></button><span role="status">{result}</span></form>;
}

export function PortfolioRail({ children, ar, id }: { children: ReactNode; ar: boolean; id: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({start: true, end: true});
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const update = () => setEdges({start: Math.abs(el.scrollLeft) < 2, end: Math.abs(el.scrollLeft) >= el.scrollWidth - el.clientWidth - 2});
    const observer = new ResizeObserver(update); observer.observe(el); el.addEventListener("scroll", update); update();
    return () => {observer.disconnect(); el.removeEventListener("scroll", update);};
  }, []);
  return <div className="portfolio-rail-wrap"><div className="portfolio-rail" id={id} ref={rail}>{children}</div>{!(edges.start && edges.end) && <><button disabled={edges.start} className="portfolio-rail-prev" aria-label={ar ? "السابق" : "Previous"} aria-controls={id} onClick={() => rail.current?.scrollBy({left: ar ? 280 : -280, behavior: "auto"})}>{ar ? <ChevronRightIcon /> : <ChevronLeftIcon />}</button><button disabled={edges.end} className="portfolio-rail-next" aria-label={ar ? "التالي" : "Next"} aria-controls={id} onClick={() => rail.current?.scrollBy({left: ar ? -280 : 280, behavior: "auto"})}>{ar ? <ChevronLeftIcon /> : <ChevronRightIcon />}</button></>}</div>;
}

/** Sample controls never send a request or create a production conversation. */
export function PortfolioSampleActions({ ar, compact = false }: { ar: boolean; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [saved, setSaved] = useState(false);
  const [kind, setKind] = useState<"quote" | "message">("quote");
  const [draftSaved, setDraftSaved] = useState(false);
  function open(next: "quote" | "message") { setKind(next); setDraftSaved(false); dialog.current?.showModal(); }
  return <><div className="portfolio-contact-actions"><button className="portfolio-primary" onClick={() => open("quote")}><MailIcon size={18} />{ar ? "طلب عرض سعر" : "Request a quote"}</button><button onClick={() => open("message")}><MessageIcon size={18} />{ar ? "مراسلة" : "Message"}</button>{!compact && <button aria-pressed={saved} onClick={() => setSaved(!saved)}><HeartIcon size={18} fill={saved ? "currentColor" : "none"} />{saved ? (ar ? "محفوظ" : "Saved") : (ar ? "حفظ" : "Save")}</button>}</div>
    <dialog ref={dialog} className="portfolio-dialog" aria-labelledby={titleId}><form onSubmit={event => {event.preventDefault(); setDraftSaved(true);}}><button type="button" className="portfolio-dialog-close" onClick={() => dialog.current?.close()}>{ar ? "إغلاق" : "Close"}</button><h2 id={titleId}>{kind === "quote" ? (ar ? "طلب عرض سعر" : "Request a quote") : (ar ? "مراسلة المهندس" : "Message the architect")}</h2><p>{ar ? "تجربة محلية للتصميم — لن يتم إرسال أي رسالة أو طلب." : "Local design sample — no message or request will be sent."}</p><label>{ar ? "تفاصيل مشروعك" : "Project details"}<textarea required rows={5} maxLength={1500} /></label><button className="portfolio-primary" type="submit">{ar ? "حفظ مسودة تجريبية" : "Save sample draft"}</button><p role="status">{draftSaved ? (ar ? "المسودة محفوظة خلال هذه الزيارة فقط. لم يتم إرسالها." : "Draft kept for this visit only. Nothing was sent.") : ""}</p></form></dialog></>;
}
