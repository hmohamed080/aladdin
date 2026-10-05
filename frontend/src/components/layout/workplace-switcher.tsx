"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { selectWorkspace } from "@/server/actions/context";
import { PERSONAL_CONTEXT, type WorkspaceEntry } from "@/lib/workspace/model";
import { BuildingIcon, CheckIcon, ChevronDownIcon, UserIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { menuItemClass, menuSectionLabelClass, menuSurfaceClass } from "@/components/ui/menu";

/**
 * The narrow WORKPLACE control — for someone who WORKS in an organization (an
 * employee, a salesperson's affiliated showroom) rather than someone entitled to
 * build one. It is deliberately not the generic `WorkspaceSwitcher`: no
 * "Workspace" framing, no "Add business", no ownership semantics, no showroom
 * connection. It only moves between places the caller genuinely belongs to, which
 * is exactly what the membership already allows and nothing more.
 *
 * With only one place to be there is nothing to switch, so it renders as a plain
 * label: the header keeps naming where you are without offering a menu.
 */
export function WorkplaceSwitcher({
  entries,
  activeKey,
  activeDisplayName,
}: {
  entries: WorkspaceEntry[];
  /** `personal`, or the active organization id. */
  activeKey: string;
  /** The active organization's own Arabic/English name, already resolved for the locale. */
  activeDisplayName?: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);

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
    active?.kind === "personal" ? t("workspace.personal") : activeDisplayName || active?.name || t("workspace.workplaces");

  const labelClass = "flex h-7 min-w-0 max-w-32 items-center gap-1.5 rounded-sm px-2 text-label font-medium text-fg tablet:max-w-56 desktop:max-w-none";

  if (entries.length <= 1) {
    return (
      <div data-testid="workplace-label" className={labelClass}>
        <BuildingIcon size={16} className="shrink-0 text-fg-muted" />
        <span className="max-w-full truncate">{activeLabel}</span>
      </div>
    );
  }

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
        aria-label={t("workspace.workplaces")}
        title={activeLabel}
        data-testid="workplace-switcher"
        className={cn(labelClass, "transition-colors hover:bg-surface-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")}
      >
        {active?.kind === "personal" ? (
          <UserIcon size={16} className="shrink-0 text-fg-muted" />
        ) : (
          <BuildingIcon size={16} className="shrink-0 text-fg-muted" />
        )}
        <span className="max-w-full truncate">{activeLabel}</span>
        <ChevronDownIcon size={14} className="shrink-0 text-fg-muted" />
      </button>

      {open ? (
        <div role="menu" data-testid="workplace-menu" className={cn(menuSurfaceClass, "absolute top-full mt-1 start-0 z-popover w-64")}>
          <p className={cn(menuSectionLabelClass, "px-3 pt-2.5 pb-1")}>{t("workspace.workplaces")}</p>
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
                    className={menuItemClass(selected)}
                  >
                    {entry.kind === "personal" ? (
                      <UserIcon size={16} className="shrink-0 text-fg-muted" />
                    ) : (
                      <BuildingIcon size={16} className="shrink-0 text-fg-muted" />
                    )}
                    <span className="truncate text-body text-fg">
                      {entry.kind === "personal" ? t("workspace.personal") : entry.name}
                    </span>
                    {selected ? <CheckIcon size={16} className="ms-auto shrink-0 text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
