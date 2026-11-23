"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Badge, Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Button, Checkbox, Input, Textarea } from "@/components/ui/controls";
import { savePresetAction } from "@/server/actions/admin-marketplace";

export type ReviewPreset = {
  id: string;
  sort_order: number;
  label_ar: string;
  label_en: string;
  message_ar: string;
  message_en: string;
  is_active: boolean;
};

type Draft = { id: string | null; labelAr: string; labelEn: string; messageAr: string; messageEn: string; isActive: boolean; sortOrder: number };

const EMPTY: Draft = { id: null, labelAr: "", labelEn: "", messageAr: "", messageEn: "", isActive: true, sortOrder: 100 };

/** Super Admin only (the page passes it only when the database says the viewer can manage). */
export function PresetManager({ presets }: { presets: ReviewPreset[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const m = (k: string) => t(`adminMarketplace.media.presets.${k}`);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  function save() {
    if (!draft) return;
    setMessage(null);
    start(async () => {
      const r = await savePresetAction(draft);
      if (!r.ok) {
        const known = ["not_permitted", "preset_invalid"].includes(r.code) ? r.code : "unexpected";
        return setMessage({ ok: false, text: t(`adminMarketplace.errors.${known}`) });
      }
      setDraft(null);
      setMessage({ ok: true, text: m("saved") });
      router.refresh();
    });
  }

  return (
    <Card pad="sm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-body-lg font-medium text-fg">{m("title")}</h2>
          <p className="text-label text-fg-muted">{m("hint")}</p>
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setDraft({ ...EMPTY })}>
          {m("add")}
        </Button>
      </div>

      <ul className="flex flex-col divide-y">
        {presets.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-body font-medium text-fg">{locale === "ar" ? p.label_ar : p.label_en}</p>
              <p className="text-label text-fg-secondary">{locale === "ar" ? p.message_ar : p.message_en}</p>
            </div>
            <div className="flex items-center gap-2">
              {p.is_active ? null : <Badge>{m("inactive")}</Badge>}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  setDraft({ id: p.id, labelAr: p.label_ar, labelEn: p.label_en, messageAr: p.message_ar, messageEn: p.message_en, isActive: p.is_active, sortOrder: p.sort_order })
                }
              >
                {m("edit")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {draft ? (
        <form
          className="grid gap-2 rounded-sm border p-3 tablet:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {m("labelAr")}
            <Input value={draft.labelAr} maxLength={80} onChange={(e) => set({ labelAr: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {m("labelEn")}
            <Input value={draft.labelEn} maxLength={80} onChange={(e) => set({ labelEn: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {m("messageAr")}
            <Textarea rows={3} value={draft.messageAr} maxLength={300} onChange={(e) => set({ messageAr: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {m("messageEn")}
            <Textarea rows={3} value={draft.messageEn} maxLength={300} onChange={(e) => set({ messageEn: e.target.value })} />
          </label>
          <Checkbox id="preset-active" name="isActive" checked={draft.isActive} onChange={(isActive) => set({ isActive })}>
            {m("active")}
          </Checkbox>
          <div className="flex gap-2 tablet:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {m("save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDraft(null)}>
              {m("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {message ? (message.ok ? <InlineSuccess>{message.text}</InlineSuccess> : <InlineError>{message.text}</InlineError>) : null}
    </Card>
  );
}
