"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/controls";

/**
 * Identity fields save through separate single-purpose forms (see IdentityCard and PersonalDetailsForm);
 * this one button submits whichever of them changed.
 */
const FORM_IDS = ["display-name", "username", "personal-details"] as const;

const snapshot = (form: HTMLFormElement) => JSON.stringify([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));

export function SettingsSaveBar({ label, hint }: { label: string; hint: string }) {
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    const form = (id: string) => document.getElementById(id) as HTMLFormElement | null;
    const initial = new Map<string, string>();
    for (const id of FORM_IDS) {
      const el = form(id);
      if (el) initial.set(id, snapshot(el));
    }

    const mark = (id: string, changed: boolean) =>
      setDirty((prev) => {
        if (prev.has(id) === changed) return prev;
        const next = new Set(prev);
        if (changed) next.add(id);
        else next.delete(id);
        return next;
      });

    const onEdit = (event: Event) => {
      const id = FORM_IDS.find((candidate) => (event.target as HTMLElement | null)?.closest(`#${candidate}`));
      if (!id) return;
      const el = form(id);
      if (el) mark(id, snapshot(el) !== initial.get(id));
    };
    document.addEventListener("input", onEdit);
    document.addEventListener("change", onEdit);
    return () => {
      document.removeEventListener("input", onEdit);
      document.removeEventListener("change", onEdit);
    };
  }, []);

  if (dirty.size === 0) return null;

  const save = () => {
    for (const id of FORM_IDS) if (dirty.has(id)) (document.getElementById(id) as HTMLFormElement | null)?.requestSubmit();
    setDirty(new Set());
  };

  return (
    <div className="engineer-settings-savebar" role="region" aria-live="polite">
      <span>{hint}</span>
      <Button type="button" onClick={save}>{label}</Button>
    </div>
  );
}
