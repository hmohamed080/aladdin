"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/controls";
import { FORM_SAVED_EVENT, type FormSavedDetail } from "@/lib/ui/form-saved";

/**
 * Identity fields save through separate single-purpose forms (see IdentityCard and PersonalDetailsForm);
 * this one button submits whichever of them changed. A form stays unsaved until it announces success
 * (see form-saved.ts), so a failed or blocked save keeps the button on screen.
 */
const FORM_IDS = ["display-name", "personal-details"] as const;

// React's own `$ACTION` fields are not user input.
const snapshot = (data: FormData) =>
  JSON.stringify([...data.entries()].filter(([k]) => !k.startsWith("$ACTION")).map(([k, v]) => [k, String(v)]));

export function SettingsSaveBar({ label, hint }: { label: string; hint: string }) {
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    const form = (id: string) => document.getElementById(id) as HTMLFormElement | null;
    const saved = new Map<string, string>();
    for (const id of FORM_IDS) {
      const el = form(id);
      if (el) saved.set(id, snapshot(new FormData(el)));
    }

    const mark = (id: string, changed: boolean) =>
      setDirty((prev) => {
        if (prev.has(id) === changed) return prev;
        const next = new Set(prev);
        if (changed) next.add(id);
        else next.delete(id);
        return next;
      });

    const compare = (id: string) => {
      const el = form(id);
      if (el) mark(id, snapshot(new FormData(el)) !== saved.get(id));
    };
    const onEdit = (event: Event) => {
      const id = FORM_IDS.find((candidate) => (event.target as HTMLElement | null)?.closest(`#${candidate}`));
      if (id) compare(id);
    };
    // Compare against what was SENT: an edit made while saving is still unsaved.
    const onSaved = (event: Event) => {
      const { id, data } = (event as CustomEvent<FormSavedDetail>).detail;
      if (!saved.has(id)) return;
      saved.set(id, snapshot(data));
      compare(id);
    };
    document.addEventListener("input", onEdit);
    document.addEventListener("change", onEdit);
    window.addEventListener(FORM_SAVED_EVENT, onSaved);
    return () => {
      document.removeEventListener("input", onEdit);
      document.removeEventListener("change", onEdit);
      window.removeEventListener(FORM_SAVED_EVENT, onSaved);
    };
  }, []);

  if (dirty.size === 0) return null;

  const save = () => {
    for (const id of FORM_IDS) if (dirty.has(id)) (document.getElementById(id) as HTMLFormElement | null)?.requestSubmit();
  };

  return (
    <div className="engineer-settings-savebar" role="region" aria-live="polite">
      <span>{hint}</span>
      <Button type="button" onClick={save}>{label}</Button>
    </div>
  );
}
