"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { selectWorkspace } from "@/server/actions/context";
import { PERSONAL_CONTEXT, type WorkspaceEntry } from "@/lib/workspace/model";
import { BuildingIcon, ChevronDownIcon, PlusIcon, UserIcon, CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { menuItemClass, menuSectionLabelClass, menuSurfaceClass } from "@/components/ui/menu";

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
  showConnectShowroom = false,
}: {
  /** Personal + every organization with an active membership. */
  entries: WorkspaceEntry[];
  /** `personal`, or the active organization id. */
  activeKey: string;
  /**
   * Offer "connect a showroom" — the affiliation path, distinct from creating a
   * business. Shown for a Salesperson, whose Sales tools live in someone else's
   * business (Sprint 13).
   */
  showConnectShowroom?: boolean;
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

  /**
   * The organization's KIND, in the words the product shows users.
   *
   * Two businesses in the same account can carry the same trading name in a
   * user's head — "Nile" the importer and "Nile" the showroom — and the header is
   * where you check which one you are about to file a quote under. The label
   * comes from the `orgType` catalog, never from the raw enum: the internal value
   * for a distributor is `supplier`, a word this product does not say to anyone.
   * A missing or unrecognized type renders nothing rather than a raw key.
   */
  const activeType =
    active?.kind === "business" && active.orgType ? t(`orgType.${active.orgType}`) : null;
  const typeLabel = activeType && !activeType.startsWith("orgType.") ? activeType : null;

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
        /* The type has to stay REACHABLE even though it no longer has a second
           line to sit on: two of your businesses can share a trading name, and
           this is where you check which one you are about to file a quote under.
           Hover and assistive tech both get it; the 48px row does not pay for it. */
        title={typeLabel ? `${activeLabel} · ${typeLabel}` : activeLabel}
        data-testid="workspace-switcher"
        className={cn(
          // A CRUMB, not a boxed control: no border, one 28px line, revealed by
          // hover. In a 48px bar a bordered two-line chip reads as a form field
          // parked in the chrome, and it was the tallest thing in the row. The
          // cap stays responsive — at 393px this trigger shares its row with the
          // search, help, theme and avatar controls.
          "flex h-7 min-w-0 max-w-32 items-center gap-1.5 rounded-sm px-2 text-label font-medium text-fg tablet:max-w-56",
          "transition-colors hover:bg-surface-hover disabled:opacity-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        {active?.kind === "personal" ? (
          <UserIcon size={16} className="shrink-0 text-fg-muted" />
        ) : (
          <BuildingIcon size={16} className="shrink-0 text-fg-muted" />
        )}
        {/* One line only. The type used to sit under the name on desktop, which
            forced a two-line trigger; the name is already the answer to "where
            am I", and the type is a tie-breaker you need when CHOOSING — where
            it still is, on every row of the menu below. */}
        <span className="max-w-full truncate">{activeLabel}</span>
        <ChevronDownIcon size={14} className="shrink-0 text-fg-muted" />
      </button>

      {open ? (
        <div
          role="menu"
          data-testid="workspace-menu"
          // `z-popover`, not the drawer layer this used to sit on. It carried
          // BOTH a dead `z-50` class and an inline `zIndex: 300`; the inline
          // value won, which put this menu on the same layer as the sidebar
          // hover-reveal and one layer BELOW its own sibling in the header.
          className={cn(menuSurfaceClass, "absolute top-full mt-1 start-0 z-popover w-64")}
        >
          <p className={cn(menuSectionLabelClass, "px-3 pt-2.5 pb-1")}>
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
                    className={menuItemClass(selected)}
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

          {/* Two DIFFERENT things, kept visibly apart. "Add business" creates a
              business the person will OWN. "Connect a showroom" asks to join a
              business someone else owns — the salesperson becomes a member, never
              its owner. Collapsing them into one entry is how a salesperson ends up
              accidentally creating a duplicate of their own employer. */}
          <div className="flex flex-col border-t">
            <a
              href="/business/new"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-body font-medium text-accent transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover"
            >
              <PlusIcon size={16} className="shrink-0" />
              {t("workspace.addBusiness")}
            </a>
            {showConnectShowroom ? (
              <a
                href="/home/showroom"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 pb-2.5 text-start text-body font-medium text-accent transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover"
              >
                <BuildingIcon size={16} className="shrink-0" />
                {t("workspace.connectShowroom")}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
