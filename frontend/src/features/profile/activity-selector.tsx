"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { ChoiceChip } from "@/features/onboarding/wizard";
import type { ActivitiesState } from "@/server/actions/activities";

const INITIAL: ActivitiesState = { ok: false };

/** Label for an activity key; falls back to the key rather than a message path. */
export function activityLabel(t: (key: string) => string, key: string): string {
  const path = `profileActivities.labels.${key}`;
  const label = t(path);
  return label === path ? key : label;
}

/**
 * Multi-select for the audience's subtype vocabulary (Showroom/Supplier/
 * Manufacturer/Importer activities, Engineer/Sales specializations). Same
 * whole-set-write discipline as `TradeSelector`: the form posts the entire
 * selection and the RPC applies it atomically, so a double-submit converges.
 *
 * `catalog` is the ACTIVE vocabulary for this audience only (RLS withholds
 * retired rows), so nothing outside the approved list can be offered.
 */
export function ActivitySelector({
  catalog,
  selected: initialSelected,
  action,
  orgId,
}: {
  catalog: string[];
  selected: string[];
  action: (prev: ActivitiesState, fd: FormData) => Promise<ActivitiesState>;
  /** Set for an organization-scoped selector; absent for the caller's own persona. */
  orgId?: string;
}) {
  const { t } = useI18n();
  const [state, submit] = useActionState(action, INITIAL);
  const [selected, setSelected] = useState<string[]>(initialSelected.filter((k) => catalog.includes(k)));

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  if (catalog.length === 0) return null;

  return (
    <Card className="flex flex-col gap-md">
      {/* Test hook on a real element wrapping the WHOLE selector (Card forwards no data-*). */}
      <div className="flex flex-col gap-md" data-testid="activity-selector">
        <div className="flex flex-col gap-1">
          <h2 className="text-title text-fg">{t("profileActivities.title")}</h2>
          <p className="max-w-prose text-body text-fg-secondary">{t("profileActivities.body")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {catalog.map((key) => (
            <ChoiceChip
              key={key}
              selected={selected.includes(key)}
              label={activityLabel(t, key)}
              onToggle={() => toggle(key)}
            />
          ))}
        </div>

        {selected.length === 0 ? <p className="text-label text-fg-muted">{t("profileActivities.empty")}</p> : null}

        <form action={submit} className="flex flex-wrap items-center gap-sm">
          {orgId ? <input type="hidden" name="orgId" value={orgId} /> : null}
          <input type="hidden" name="keys" value={catalog.filter((k) => selected.includes(k)).join("\n")} />
          <SubmitButton variant="primary" size="sm" pendingLabel={t("profileActivities.saving")}>
            {t("profileActivities.save")}
          </SubmitButton>
          {state.ok ? <InlineSuccess>{t("profileActivities.saved")}</InlineSuccess> : null}
          {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
        </form>
      </div>
    </Card>
  );
}
