"use client";

import { useState } from "react";
import { brandContent } from "./landing-brand-content";

const link = { padding: "13px 4px", fontSize: "16px", color: "var(--lb-cream)", borderBottom: "1px solid rgba(242,233,216,.1)" } as const;

/** Mobile header from the approved mockup: logo at the inline start, burger at the end, links and the two account buttons in the opened menu. */
export function LandingBrandMobileHeader() {
  const [open, setOpen] = useState(false);
  const t = brandContent.nav;
  const items: [string, string][] = t.items.map(([label, href]) => [label, href === "#top" ? "#top" : href === "#market" ? "#market" : href === "#roles" ? "#m-roles" : href === "#why" ? "#m-why" : "#m-footer"]);
  return (
    <>
      <header style={{ background: "var(--lb-navy-2)", minHeight: "58px", padding: "0 8px 0 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexDirection: "row-reverse" }}>
        <button type="button" onClick={() => setOpen(!open)} aria-label={t.menu} aria-expanded={open} aria-controls="m-nav" style={{ width: "48px", height: "48px", border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--lb-cream)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"}></path></svg>
        </button>
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: "10px", color: "inherit", textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size logo mark */}
          <img src="/landing-brand/mark-cream.png" alt="" style={{ height: "44px", width: "auto", flex: "none", display: "block" }} />
          <span style={{ fontWeight: 800, fontSize: "24px", color: "var(--lb-white)" }}>علاء الدين</span>
        </a>
      </header>
      {open ? (
        <nav id="m-nav" aria-label={t.label} style={{ background: "var(--lb-navy-2)", padding: "0 22px 20px", display: "flex", flexDirection: "column" }}>
          {items.map(([label, href]) => (
            <a key={label} href={href} onClick={() => setOpen(false)} style={{ ...link, textDecoration: "none" }}>{label}</a>
          ))}
          <div style={{ display: "flex", gap: "10px", paddingTop: "14px" }}>
            <a href="/auth/sign-up" style={{ flex: 1, textAlign: "center", background: "var(--lb-cream)", color: "var(--lb-navy)", fontWeight: 800, fontSize: "15px", padding: "13px", borderRadius: "999px", textDecoration: "none" }}>{t.register}</a>
            <a href="/auth/sign-in" style={{ flex: 1, textAlign: "center", border: "1px solid var(--lb-sand)", color: "var(--lb-sand)", fontWeight: 700, fontSize: "15px", padding: "12px", borderRadius: "999px", textDecoration: "none" }}>{t.signIn}</a>
          </div>
        </nav>
      ) : null}
    </>
  );
}
