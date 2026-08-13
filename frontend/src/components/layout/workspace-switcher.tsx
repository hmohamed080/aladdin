"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { selectWorkspace } from "@/server/actions/context";
import { PERSONAL_CONTEXT, type WorkspaceEntry } from "@/lib/workspace/model";
import { BuildingIcon, ChevronDownIcon, PlusIcon, UserIcon, CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The WORKSPACE switcher — it changes WHERE the user is working, never WHO they
 * are. This is deliberately NOT a profile/persona/"use as" switcher: selecting
 * "AH Design Studio" does not make the signed-in Engineer a showroom, and
 * selecting Personal does not drop their memberships. One person, one user id,
 * many places to work.
 *
 * What it lists is derived, never stored: the Personal entry appears only when a
 * personal persona was explicitly claimed, and each business entry is one ACTIVE
 * membership. A suspended or revoked membership therefore disappears on its own —
 * and selecting a workspace still grants nothing, because membership, capability,
 * branch scope and RLS are re-checked on every request.
 *
 * Layout is direction-agnostic (logical `start`/`end` utilities), so the panel and
 * its chevron sit correctly in both LTR and RTL without mirrored markup.
 */
export function WorkspaceSwitcher({
  entries,
  activeKey,
}: {
  /** Personal + every organization with an active membership. */
  entries: WorkspaceEntry[];
  /** `personal`, or the active organization id. */
  activeKey: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape — a menu that traps the page is worse than
  // no menu at all.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = entries.find((e) =>
    e.kind === "personal" ? activeKey === PERSONAL_CONTEXT : e.organizationId === activeKey,
  );
  const activeLabel =
    active?.kind === "personal" ? t("workspace.personal") : (active?.name ?? t("workspace.title"));

  const choose = (value: string) => {
    setOpen(false);
    start(() => selectWorkspace(value));
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("workspace.switch")}
        data-testid="workspace-switcher"
        className={cn(
          "flex max-w-56 items-center gap-2 rounded-md border border-strong px-2.5 py-1.5 text-label font-medium text-fg",
          "transition-colors hover:bg-surface-2/60 disabled:opacity-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        {active?.kind === "personal" ? (
          <UserIcon size={16} className="shrink-0 text-fg-muted" />
        ) : (
          <BuildingIcon size={16} className="shrink-0 text-fg-muted" />
        )}
        <span className="truncate">{activeLabel}</span>
        <ChevronDownIcon size={14} className="shrink-0 text-fg-muted" />
      </button>

      {open ? (
        <div
          role="menu"
          data-testid="workspace-menu"
          className="absolute top-full mt-1 start-0 z-50 w-64 overflow-hidden rounded-md border border-strong bg-surface shadow-lg"
          style={{ zIndex: 300 }}
        >
          <p className="px-3 pt-2.5 pb-1 text-label font-semibold uppercase tracking-wide text-fg-muted">
            {t("workspace.title")}
          </p>
          <ul className="flex flex-col py-0.5">
            {entries.map((entry) => {
              const value = entry.kind === "personal" ? PERSONAL_CONTEXT : entry.organizationId;
              const selected = value === activeKey;
              return (
                <li key={value}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => choose(value)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors",
                      "hover:bg-surface-2/70 focus-visible:outline-none focus-visible:bg-surface-2/70",
                      selected && "bg-accent-solid/10",
                    )}
                  >
                    {entry.kind === "personal" ? (
                      <UserIcon size={16} className="shrink-0 text-fg-muted" />
                    ) : (
                      <BuildingIcon size={16} className="shrink-0 text-fg-muted" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body text-fg">
                        {entry.kind === "personal" ? entry.name || t("workspace.personal") : entry.name}
                      </span>
                      <span className="truncate text-label text-fg-muted">
                        {entry.kind === "personal"
                          ? t("workspace.personal")
                          : t(`workspace.relationship.${entry.relationship}`)}
                      </span>
                    </span>
                    {selected ? (
                      <CheckIcon size={16} className="ms-auto shrink-0 text-accent" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t">
            <a
              href="/business/new"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-body font-medium text-accent transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:bg-surface-2/70"
            >
              <PlusIcon size={16} className="shrink-0" />
              {t("workspace.addBusiness")}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
