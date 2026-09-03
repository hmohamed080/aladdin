"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, InlineError } from "@/components/ui/primitives";
import { Button, SubmitButton } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { ASSET_POLICY, type AssetNamespace } from "@/lib/storage/professional-assets";
export { MediaFrame } from "./media-frame";

/**
 * Pieces shared by the Portfolio and Certificates managers.
 *
 * Everything here is composition over the canonical Foundation — `Card`,
 * `Badge`, `Button`, `SubmitButton`, `InlineError` — because R3 says a second
 * Button is a permanent second implementation. What these add is arrangement,
 * which is the one layer a product surface owns.
 */

/**
 * PRIVATE / PUBLISHED, and the wording is deliberate.
 *
 * "Private" is the resting state and reads as a fact rather than a warning, so the
 * default costs nobody a moment of alarm. "Published" is the one that changed, so
 * it carries the accent. Neither says "hidden": nothing is being kept from the
 * owner, and an item nobody else can see is not in a lesser state.
 */
export function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  const { t } = useI18n();
  return (
    <Badge tone={isPublic ? "accent" : "neutral"}>
      {t(isPublic ? "portfolio.status.published" : "portfolio.status.private")}
    </Badge>
  );
}

/**
 * A small form that submits one row of hidden fields and nothing else.
 *
 * Used for publish, unpublish and reorder — actions with no input, where a form
 * is still the right control because each is a server mutation with a pending
 * state and a possible error. `useActionState` gives all three without a
 * component inventing its own loading flag.
 */
export function QuickAction({
  action,
  fields,
  label,
  ariaLabel,
  variant = "outline",
  disabled,
}: {
  action: (prev: { ok: boolean; code?: string }, fd: FormData) => Promise<{ ok: boolean; code?: string }>;
  fields: Record<string, string>;
  label: ReactNode;
  /** Required when `label` is an icon: the control still has to announce itself. */
  ariaLabel?: string;
  variant?: "outline" | "ghost" | "accent" | "primary";
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, dispatch] = useActionState(
    async (prev: { ok: boolean; code?: string }, fd: FormData) => {
      const result = await action(prev, fd);
      if (result.ok) router.refresh();
      return result;
    },
    { ok: true },
  );

  return (
    <form action={dispatch} className="contents" aria-label={ariaLabel}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} disabled={disabled} aria-label={ariaLabel}>
        {label}
      </SubmitButton>
      {state.ok ? null : <InlineError>{t(state.code ?? "states.genericRetry")}</InlineError>}
    </form>
  );
}

/**
 * The file input, with the namespace's real limits stated next to it.
 *
 * The `accept` attribute is generated from `ASSET_POLICY`, so the picker offers
 * exactly what the bucket will store — one list, not a second one written by hand
 * that drifts. It is a convenience, never a check: a person can always choose
 * "all files", which is why validation runs on what was actually picked.
 */
export function AssetFileField({
  namespace,
  onPick,
  inputRef,
}: {
  namespace: AssetNamespace;
  onPick: (file: File | null) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18n();
  const policy = ASSET_POLICY[namespace];
  const megabytes = Math.round(policy.maxBytes / (1024 * 1024));

  return (
    <div className="flex flex-col gap-2">
      <label className="text-label font-medium text-fg" htmlFor={`file-${namespace}`}>
        {t(`${namespace === "portfolio" ? "portfolio" : "certificates"}.form.file`)}
      </label>
      <input
        ref={inputRef}
        id={`file-${namespace}`}
        name="file"
        type="file"
        required
        accept={policy.types.join(",")}
        onChange={(e) => onPick(e.currentTarget.files?.[0] ?? null)}
        className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-fg file:me-3 file:rounded-sm file:border-0 file:bg-surface-sunken file:px-3 file:py-1 file:text-label file:text-fg-secondary"
      />
      <p className="text-label text-fg-muted">
        {t("assets.form.limits", {
          types: policy.types.map((m) => (m.split("/")[1] ?? m).toUpperCase()).join(" · "),
          mb: megabytes,
        })}
      </p>
    </div>
  );
}

/**
 * A disclosure that holds an add form.
 *
 * Collapsed by default so the page opens on the person's work rather than on an
 * empty form, and it closes itself on success — which is also the signal that the
 * upload finished, since the new card appears in the same moment.
 */
export function AddPanel({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.querySelector("input")?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <Card className="flex w-full flex-col gap-md">
      <div ref={panelRef} className="flex flex-col gap-md">
        <h3 className="text-title text-fg">{title}</h3>
        {children(() => setOpen(false))}
      </div>
    </Card>
  );
}
