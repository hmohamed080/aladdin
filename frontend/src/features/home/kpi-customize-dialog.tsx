"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { PencilIcon, ChevronUpIcon, ChevronDownIcon, EyeOffIcon, PlusIcon, CheckIcon, XIcon } from "@/components/ui/icons";
import { DASHBOARD_KPI_CATALOG, type DashboardKpiCardKey } from "@/lib/workspace/dashboard-kpi-catalog";
import {
  setPersonalKpiLayoutAction,
  resetPersonalKpiLayoutAction,
  setTeamDefaultKpiLayoutAction,
  resetTeamDefaultKpiLayoutAction,
} from "@/server/actions/dashboard-kpi-layout";

/**
 * The pencil trigger beside "نظرة على يومك" plus its customization dialog —
 * reorder, show/hide, and (for an org.manage caller) publish as the team
 * default. Personal and team-default are two DIFFERENT actions with two
 * different results, never conflated: saving your own layout never touches
 * what a teammate without a personal override sees, and only an authorized
 * owner/manager may change that shared starting point (enforced again,
 * server-side, by the RPCs this calls — this dialog only hides the controls
 * a plain member could not use anyway).
 *
 * Reordering is keyboard-only by design (move-up/move-down buttons on every
 * row) — no drag-and-drop, so there is nothing here that ONLY a mouse or a
 * touch gesture can drive. The list itself needs no RTL-specific handling:
 * it is vertical, and up/down keep their meaning in both directions.
 */
export function KpiCustomizeDialog({
  orgId,
  availableKeys,
  initialOrder,
  hasPersonal,
  hasTeamDefault,
  canManageTeamDefault,
}: {
  orgId: string;
  /**
   * Just the KEYS the caller's buyer/seller stance permits — a Server
   * Component prop must be serializable, and the catalog's own `Icon` field
   * is a component reference, which crosses the server/client boundary as
   * neither a plain value nor a Server Action. Only strings pass; the
   * matching `DASHBOARD_KPI_CATALOG` rows (icons included) are resolved
   * client-side, right below, from this same shared, statically-imported
   * catalog module.
   */
  availableKeys: DashboardKpiCardKey[];
  initialOrder: DashboardKpiCardKey[];
  hasPersonal: boolean;
  hasTeamDefault: boolean;
  canManageTeamDefault: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<DashboardKpiCardKey[]>(initialOrder);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const availableKeySet = new Set(availableKeys);
  const availableCards = DASHBOARD_KPI_CATALOG.filter((c) => availableKeySet.has(c.key));

  const byKey = new Map(availableCards.map((c) => [c.key, c]));
  const hidden = availableCards.filter((c) => !enabled.includes(c.key));

  useEffect(() => {
    if (!open) return;
    setEnabled(initialOrder);
    setNotice(null);
    const triggerEl = triggerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the dialog heading first — every action inside is reachable by
    // Tab from there, and there is no single "first field" the way a plain
    // form has.
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (previouslyFocused ?? triggerEl)?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function move(index: number, delta: 1 | -1) {
    setEnabled((cur) => {
      const next = cur.slice();
      const target = index + delta;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function onRowKeyDown(e: ReactKeyboardEvent<HTMLLIElement>, index: number) {
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      move(index, -1);
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      move(index, 1);
    }
  }

  function hide(key: DashboardKpiCardKey) {
    setEnabled((cur) => cur.filter((k) => k !== key));
  }

  function show(key: DashboardKpiCardKey) {
    setEnabled((cur) => (cur.length >= 8 ? cur : [...cur, key]));
  }

  // Every action stays OPEN on success rather than closing — a notice shown
  // for a single frame inside a dialog that immediately unmounts is not a
  // notice a person can actually read. The caller dismisses explicitly
  // (Escape or the backdrop), which also means they can act again
  // immediately (save personally, then also publish as the team default)
  // without reopening.
  function run(action: () => Promise<{ ok: boolean; message?: string }>, successMessage: string) {
    start(async () => {
      const res = await action();
      setNotice(res.ok ? successMessage : t("home.customize.error"));
      if (res.ok) router.refresh();
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("home.customize.trigger")}
        title={t("home.customize.trigger")}
        data-testid="kpi-customize-trigger"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas"
      >
        <PencilIcon size={15} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-brand-basalt/60 p-md"
          style={{ zIndex: 500 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            data-testid="kpi-customize-dialog"
            className="flex max-h-[90dvh] w-full max-w-lg flex-col gap-md overflow-auto rounded-md border bg-surface p-lg shadow-lg focus:outline-none"
          >
            <div className="flex items-start justify-between gap-md">
              <div>
                <h2 id={titleId} className="text-title text-fg">
                  {t("home.customize.title")}
                </h2>
                <p className="mt-1 text-body text-fg-secondary">{t("home.customize.body")}</p>
              </div>
              {/* No action here auto-closes the dialog (a notice inside a
                  dialog that immediately unmounts is unreadable), so an
                  explicit close control is the primary way out, alongside
                  Escape and the backdrop. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <XIcon size={16} />
              </button>
            </div>

            {notice ? (
              <p role="status" className="rounded-sm border bg-surface-2/60 px-md py-2 text-body text-fg">
                {notice}
              </p>
            ) : null}

            <div>
              <h3 className="text-label font-medium text-fg-muted">{t("home.customize.visible")}</h3>
              <ol className="mt-1.5 flex flex-col gap-1">
                {enabled.map((key, i) => {
                  const card = byKey.get(key);
                  if (!card) return null;
                  return (
                    <li
                      key={key}
                      onKeyDown={(e) => onRowKeyDown(e, i)}
                      className="flex items-center gap-2 rounded-sm border bg-surface-2/40 px-2.5 py-1.5"
                    >
                      <card.Icon size={16} />
                      <span className="min-w-0 flex-1 truncate text-body text-fg">{t(card.labelKey)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label={t("home.customize.moveUp")}
                          title={t("home.customize.moveUp")}
                          className="grid h-7 w-7 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                          <ChevronUpIcon size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(i, 1)}
                          disabled={i === enabled.length - 1}
                          aria-label={t("home.customize.moveDown")}
                          title={t("home.customize.moveDown")}
                          className="grid h-7 w-7 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                          <ChevronDownIcon size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => hide(key)}
                          aria-label={t("home.customize.hide")}
                          title={t("home.customize.hide")}
                          className="grid h-7 w-7 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                          <EyeOffIcon size={15} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {hidden.length > 0 ? (
              <div>
                <h3 className="text-label font-medium text-fg-muted">{t("home.customize.available")}</h3>
                {enabled.length >= 8 ? (
                  <p className="mt-1 text-label text-fg-muted">{t("home.customize.maxReached")}</p>
                ) : null}
                <ul className="mt-1.5 flex flex-col gap-1">
                  {hidden.map((card) => (
                    <li
                      key={card.key}
                      className="flex items-center gap-2 rounded-sm border border-dashed px-2.5 py-1.5 text-fg-muted"
                    >
                      <card.Icon size={16} />
                      <span className="min-w-0 flex-1 truncate text-body">{t(card.labelKey)}</span>
                      <button
                        type="button"
                        onClick={() => show(card.key)}
                        disabled={enabled.length >= 8}
                        aria-label={t("home.customize.show")}
                        title={t("home.customize.show")}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm transition-colors hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <PlusIcon size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-col gap-sm border-t pt-md">
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <p className="text-label text-fg-muted">{t("home.customize.personalNote")}</p>
                <div className="flex flex-wrap gap-sm">
                  {hasPersonal ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() => resetPersonalKpiLayoutAction(orgId), t("home.customize.resetDone"))
                      }
                      className="inline-flex h-8 items-center rounded-sm px-3 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-60"
                    >
                      {t("home.customize.resetPersonal")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending || enabled.length === 0}
                    onClick={() =>
                      run(() => setPersonalKpiLayoutAction(orgId, enabled), t("home.customize.savedPersonal"))
                    }
                    data-testid="kpi-customize-save-personal"
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent-solid px-3 text-label font-medium text-on-accent transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <CheckIcon size={14} />
                    {t("home.customize.savePersonal")}
                  </button>
                </div>
              </div>

              {canManageTeamDefault ? (
                <div className="flex flex-wrap items-center justify-between gap-sm border-t pt-sm">
                  <p className="text-label text-fg-muted">{t("home.customize.teamDefaultNote")}</p>
                  <div className="flex flex-wrap gap-sm">
                    {hasTeamDefault ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => resetTeamDefaultKpiLayoutAction(orgId), t("home.customize.resetDone"))}
                        className="inline-flex h-8 items-center rounded-sm px-3 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-60"
                      >
                        {t("home.customize.resetTeamDefault")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={pending || enabled.length === 0}
                      onClick={() =>
                        run(() => setTeamDefaultKpiLayoutAction(orgId, enabled), t("home.customize.savedTeamDefault"))
                      }
                      data-testid="kpi-customize-save-team-default"
                      className={cn(
                        "inline-flex h-8 items-center rounded-sm border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      {t("home.customize.saveTeamDefault")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
