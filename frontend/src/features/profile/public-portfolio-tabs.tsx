"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function PublicPortfolioTabs({ar, panels}: {ar: boolean; panels: {id: string; label: string; content: ReactNode}[]}) {
  const [active, setActive] = useState("overview");
  const prefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    function jump(event: Event) {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
      if (panels.some(panel => panel.id === event.detail)) setActive(event.detail);
    }
    window.addEventListener("public-portfolio-tab", jump);
    return () => window.removeEventListener("public-portfolio-tab", jump);
  }, [panels]);
  return <><div role="tablist" aria-label={ar ? "أقسام الملف العام" : "Public profile sections"} className="public-engineer-section-nav">{panels.map((panel, index) => <button key={panel.id} ref={node => {buttons.current[index] = node;}} role="tab" id={`${prefix}-${panel.id}-tab`} aria-controls={`${prefix}-${panel.id}-panel`} aria-selected={active === panel.id} tabIndex={active === panel.id ? 0 : -1} onClick={() => setActive(panel.id)} onKeyDown={event => {
    let next = index;
    if (event.key === (ar ? "ArrowLeft" : "ArrowRight")) next = (index + 1) % panels.length;
    else if (event.key === (ar ? "ArrowRight" : "ArrowLeft")) next = (index - 1 + panels.length) % panels.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = panels.length - 1;
    else return;
    event.preventDefault(); setActive(panels[next]!.id); buttons.current[next]?.focus();
  }}>{panel.label}</button>)}</div><div className="public-engineer-body">{panels.map(panel => <div key={panel.id} role="tabpanel" id={`${prefix}-${panel.id}-panel`} aria-labelledby={`${prefix}-${panel.id}-tab`} hidden={panel.id !== active} tabIndex={0}>{active === panel.id ? panel.content : null}</div>)}</div></>;
}

export function PublicTabJump({id, children}: {id: string; children: ReactNode}) {
  return <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("public-portfolio-tab", {detail: id}))}>{children}</button>;
}
