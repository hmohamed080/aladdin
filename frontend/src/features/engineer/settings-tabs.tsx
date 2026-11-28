"use client";

import { useEffect, useState, type ReactNode } from "react";

export type SettingsTab = {
  id: string;
  title: string;
  panel: ReactNode;
};

/** Settings sections as tabs: one panel at a time, selection mirrored in the URL hash so a section is linkable. */
export function SettingsTabs({ tabs, label, heading }: { tabs: SettingsTab[]; label: string; heading: ReactNode }) {
  const [active, setActive] = useState(tabs[0]!.id);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#settings-/, "");
      if (tabs.some((tab) => tab.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  const select = (id: string) => {
    setActive(id);
    window.history.replaceState(null, "", `#settings-${id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length]!;
    select(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  return (
    <div className="engineer-settings-layout">
      <div className="engineer-settings-side">
        {heading}
        <div className="engineer-settings-nav" role="tablist" aria-label={label} aria-orientation="vertical">
          {tabs.map(({ id, title }, i) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active === id}
              aria-controls={`settings-${id}`}
              tabIndex={active === id ? 0 : -1}
              suppressHydrationWarning // the pre-paint script in settings-sections.ts may already have selected the URL's tab
              onClick={() => select(id)}
              onKeyDown={(event) => onKeyDown(event, i)}
            >
              {title}
            </button>
          ))}
        </div>
      </div>
      <div className="engineer-settings-content">
        {tabs.map(({ id, panel }) => (
          <div key={id} id={`settings-${id}`} role="tabpanel" aria-labelledby={`settings-tab-${id}`} hidden={active !== id} suppressHydrationWarning>
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}
