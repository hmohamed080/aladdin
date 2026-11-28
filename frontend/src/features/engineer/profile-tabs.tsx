"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/controls";
import type { Locale } from "@/lib/i18n/locales";

export function ProfileTabs({ locale, panels }: {
  locale: Locale;
  panels: { id: string; label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const prefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="flex min-w-0 flex-col gap-lg">
    <div role="tablist" aria-label={locale === "ar" ? "أقسام الملف" : "Profile sections"} className="engineer-profile-tabs flex gap-2 overflow-x-auto rounded-md border bg-surface p-2">
      {panels.map((panel, index) => <Button
        key={panel.id}
        ref={(node) => { buttons.current[index] = node; }}
        id={`${prefix}-tab-${panel.id}`}
        role="tab"
        aria-selected={index === active}
        aria-controls={`${prefix}-panel-${panel.id}`}
        tabIndex={index === active ? 0 : -1}
        variant="ghost"
        className="shrink-0"
        onClick={() => setActive(index)}
        onKeyDown={(event) => {
          let next = index;
          const forward = locale === "ar" ? "ArrowLeft" : "ArrowRight";
          const backward = locale === "ar" ? "ArrowRight" : "ArrowLeft";
          if (event.key === forward) next = (index + 1) % panels.length;
          else if (event.key === backward) next = (index - 1 + panels.length) % panels.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = panels.length - 1;
          else return;
          event.preventDefault();
          setActive(next);
          buttons.current[next]?.focus();
        }}
      >{panel.label}</Button>)}
    </div>
    {panels.map((panel, index) => <div
      key={panel.id}
      id={`${prefix}-panel-${panel.id}`}
      role="tabpanel"
      aria-labelledby={`${prefix}-tab-${panel.id}`}
      hidden={index !== active}
      tabIndex={0}
    >{index === active ? panel.content : null}</div>)}
  </div>;
}
