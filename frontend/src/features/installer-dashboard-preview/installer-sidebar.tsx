"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import {
  SIDEBAR_MODE_COOKIE,
  SIDEBAR_MODES,
  sidebarModeLabelKey,
  type SidebarMode,
} from "@/lib/ui/sidebar-mode";
import { cn } from "@/lib/ui/cn";
import { Brand } from "@/components/layout/brand";
import { ShellAtmosphere } from "@/components/layout/shell-atmosphere";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  PanelIcon,
  XIcon,
} from "@/components/ui/icons";
import { pick } from "./mock-data";
import { INSTALLER_PRIMARY_NAV, INSTALLER_QUICK_NAV, type InstallerNavItem } from "./installer-nav";
import { signOut } from "@/server/actions/auth";

const ONE_YEAR = 60 * 60 * 24 * 365;
const MENU_HOVER_DELAY_MS = 350;

/**
 * The craftsman's own navigation on the writing direction's start edge.
 * Desktop supports the same expanded, collapsed, and expand-on-hover modes as
 * the production shell while retaining this preview's independent navigation.
 * Mobile remains a separate, always-expanded overlay drawer.
 */
export function InstallerSidebar({
  initialMode,
  mobileOpen,
  onCloseMobile,
  production = false,
}: {
  initialMode: SidebarMode;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  production?: boolean;
}) {
  const { locale, dir, t } = useI18n();
  const pathname = usePathname();
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  const [revealed, setRevealed] = useState(false);

  const open = mode === "expanded" || (mode === "hover" && revealed);
  const hoverMode = mode === "hover";

  const chooseMode = (next: SidebarMode) => {
    setMode(next);
    setRevealed(false);
    document.cookie = `${SIDEBAR_MODE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  };

  function Body({ mobile = false }: { mobile?: boolean }) {
    const narrow = mobile ? false : !open;

    return (
      <div
        onMouseEnter={!mobile && hoverMode ? () => setRevealed(true) : undefined}
        onMouseLeave={!mobile && hoverMode ? () => setRevealed(false) : undefined}
        onFocusCapture={!mobile && hoverMode ? () => setRevealed(true) : undefined}
        onBlurCapture={
          !mobile && hoverMode
            ? (event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRevealed(false);
              }
            : undefined
        }
        className="relative z-10 flex h-full w-full flex-col"
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center",
            narrow ? "justify-center px-2" : "justify-between px-5",
          )}
        >
          {narrow ? null : <Brand name={t("common.appName")} size="sm" tone="shell" wordmark />}
          {mobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label={locale === "ar" ? "إغلاق القائمة" : "Close menu"}
              className="grid h-8 w-8 place-items-center rounded-sm text-shell-fg-muted hover:bg-shell-2 hover:text-shell-fg desktop:hidden"
            >
              <XIcon size={18} />
            </button>
          ) : (
            <SidebarModeControl mode={mode} onPick={chooseMode} />
          )}
        </div>

        <nav
          aria-label={locale === "ar" ? "التنقل الرئيسي" : "Primary navigation"}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            narrow ? "px-2" : "px-3",
          )}
        >
          <ul className="flex flex-col gap-0.5">
            {INSTALLER_PRIMARY_NAV.filter((item) => !production || Boolean(item.href)).map((item, index) => (
              <NavRow key={item.id} item={item} locale={locale} active={production && item.href ? pathname === item.href || (item.href !== "/home" && pathname.startsWith(`${item.href}/`)) : index === 0} narrow={narrow} production={production} />
            ))}
          </ul>

          {narrow ? (
            <div className="my-3 border-t border-shell-line" />
          ) : (
            <p className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-wide text-shell-fg-muted">
              {locale === "ar" ? "أدوات سريعة" : "Quick tools"}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {INSTALLER_QUICK_NAV.filter((item) => !production || Boolean(item.href)).map((item) => (
              <NavRow key={item.id} item={item} locale={locale} active={false} narrow={narrow} production={production} />
            ))}
          </ul>
        </nav>

        <div className={cn("shrink-0 pb-2.5 pt-2", narrow ? "px-2" : "px-3")}>
          {production ? (
            <Link
              href="/home/points"
              title={locale === "ar" ? "نقاطي ومكافآتي" : "My points and rewards"}
              className={cn(
                "flex rounded-md border border-iris-solid/30 bg-iris-solid/15 p-2 transition-colors hover:bg-iris-solid/20",
                narrow ? "items-center justify-center" : "items-center gap-2.5",
              )}
            >
              <Image src="/assets/installer-dashboard/rewards/gift.webp" alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
              {narrow ? null : <span className="text-label font-semibold text-shell-fg">{locale === "ar" ? "نقاطي ومكافآتي" : "My points & rewards"}</span>}
            </Link>
          ) : narrow ? (
            <a
              href="#rewards"
              title={locale === "ar" ? "ادعُ صديقًا واحصل على 200 نقطة" : "Invite a friend, earn 200 pts"}
              className="flex items-center justify-center rounded-md border border-iris-solid/30 bg-iris-solid/15 p-2 transition-colors hover:bg-iris-solid/20"
            >
              <Image
                src="/assets/installer-dashboard/rewards/gift.webp"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 shrink-0 object-contain"
              />
            </a>
          ) : (
            <a
              href="#rewards"
              className={cn(
                "flex flex-col gap-1.5 rounded-md border border-iris-solid/30 bg-iris-solid/15 p-3",
                "transition-colors hover:bg-iris-solid/20",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
              )}
            >
              <span className="flex items-center gap-2">
                <Image
                  src="/assets/installer-dashboard/rewards/gift.webp"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-contain"
                />
                <span className="min-w-0 flex-1 text-label font-medium text-shell-fg-secondary">
                  {locale === "ar" ? "ادعُ صديقًا واحصل على" : "Invite a friend, earn"}
                </span>
              </span>
              <span className="text-body-lg font-semibold leading-tight text-shell-fg">
                {locale === "ar" ? "200 نقطة لكل صديق" : "200 pts per friend"}
              </span>
              <span className="flex items-center gap-1 text-label font-semibold text-white">
                {locale === "ar" ? "دعوة الآن" : "Invite now"}
                <Forward size={13} />
              </span>
            </a>
          )}

          <form action={production ? signOut : undefined}>
          <button
            type={production ? "submit" : "button"}
            title={locale === "ar" ? "تسجيل خروج" : "Sign out"}
            className={cn(
              "mt-2 flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-label font-medium text-shell-fg-secondary",
              "hover:bg-shell-2 hover:text-shell-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
              narrow && "justify-center px-0",
            )}
          >
            <LogOutIcon size={16} />
            {narrow ? null : locale === "ar" ? "تسجيل خروج" : "Sign out"}
          </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        data-preview-sidebar=""
        data-sidebar-mode={mode}
        data-sidebar-open={open ? "true" : "false"}
        className={cn(
          "sticky top-0 z-drawer hidden shrink-0 overflow-hidden bg-shell transition-[width] duration-base ease-out-expo desktop:block",
          open ? "w-60" : "w-14",
        )}
        style={{ height: "100dvh" }}
      >
        <ShellAtmosphere />
        <Body />
      </div>

      <div
        className={cn(
          "fixed inset-0 z-drawer desktop:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          onClick={onCloseMobile}
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity duration-base",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "absolute inset-y-0 start-0 w-64 max-w-[85vw] overflow-hidden bg-shell shadow-lg",
            "transition-transform duration-base ease-out-expo",
            mobileOpen ? "translate-x-0" : dir === "rtl" ? "translate-x-full" : "-translate-x-full",
          )}
        >
          <ShellAtmosphere />
          <Body mobile />
        </div>
      </div>
    </>
  );
}

function SidebarModeControl({ mode, onPick }: { mode: SidebarMode; onPick: (mode: SidebarMode) => void }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; insetInlineStart: number } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const scheduleOpen = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    openTimer.current = setTimeout(() => setMenuOpen(true), MENU_HOVER_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);
  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setMenuOpen(false), 140);
  }, [clearCloseTimer, clearOpenTimer]);
  const closeNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setMenuOpen(false);
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearCloseTimer, clearOpenTimer],
  );

  useEffect(() => {
    if (!menuOpen || !trigger.current) return;
    const place = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      setMenuPosition({ top: rect.bottom + 4, insetInlineStart: rtl ? window.innerWidth - rect.right : rect.left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const inside = (node: Node | null) =>
      Boolean(trigger.current?.contains(node)) || Boolean(menu.current?.contains(node));
    const onPointer = (event: MouseEvent) => {
      if (!inside(event.target as Node)) closeNow();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNow();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [closeNow, menuOpen]);

  const label = `${t("nav.sidebar.control")}: ${t(sidebarModeLabelKey(mode))}`;

  return (
    <div className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          closeNow();
          onPick(mode === "expanded" ? "collapsed" : "expanded");
        }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={() => setMenuOpen(true)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={label}
        data-testid="installer-sidebar-control"
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-sm text-shell-fg-muted transition-colors",
          "hover:bg-shell-2 hover:text-shell-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
        )}
      >
        <PanelIcon size={17} />
      </button>

      {menuOpen && menuPosition
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              data-testid="installer-sidebar-menu"
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
              className="fixed z-popover w-44 overflow-hidden rounded-md border bg-surface py-1 shadow-lg"
              style={{ top: menuPosition.top, insetInlineStart: menuPosition.insetInlineStart }}
            >
              {SIDEBAR_MODES.map((value) => {
                const selected = value === mode;
                return (
                  <button
                    key={value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeNow();
                      onPick(value);
                    }}
                    aria-current={selected ? "true" : undefined}
                    data-testid={`installer-sidebar-mode-${value}`}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-label font-medium transition-colors",
                      selected ? "text-fg" : "text-fg-secondary hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <span className="truncate">{t(sidebarModeLabelKey(value))}</span>
                    {selected ? <CheckIcon size={14} className="ms-auto shrink-0 text-accent" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function NavRow({
  item,
  locale,
  active,
  narrow,
  production,
}: {
  item: InstallerNavItem;
  locale: "ar" | "en";
  active: boolean;
  narrow: boolean;
  production: boolean;
}) {
  const Icon: ComponentType<{ size?: number }> = item.Icon;
  const label = pick(locale, item.label);

  const className = cn(
    "group relative z-10 flex items-center rounded-sm text-label font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
    narrow ? "justify-center px-0 py-0.5" : "gap-1 px-3 py-0.5",
    active
      ? "bg-shell-active text-shell-active-fg"
      : "text-shell-fg-secondary hover:bg-shell-2 hover:text-shell-fg",
  );

  const content = (
    <>
        <span
          data-nav-icon="true"
          className={cn(
            "relative grid h-9 w-9 shrink-0 place-items-center rounded-sm transition-colors",
            !active && narrow && "group-hover:bg-surface-2 group-hover:shadow-sm group-focus-visible:bg-surface-2",
            active ? "text-shell-active-fg" : "text-shell-fg-secondary group-hover:text-shell-fg",
          )}
        >
          <Icon size={17} />
          {narrow && item.badge && !production ? (
            <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-pill bg-accent-solid px-1 text-[9px] font-semibold text-on-accent">
              {item.badge}
            </span>
          ) : null}
        </span>
        {narrow ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
        {!narrow && item.badge && !production ? (
          <span
            className={cn(
              "grid h-5 min-w-5 shrink-0 place-items-center rounded-pill px-1.5 text-[11px] font-semibold",
              active ? "bg-white/20 text-white" : "bg-shell-gold-soft text-accent-solid",
            )}
          >
            {item.badge}
          </span>
        ) : null}
    </>
  );

  return (
    <li>
      {production && item.href ? (
        <Link href={item.href} aria-current={active ? "page" : undefined} aria-label={narrow ? label : undefined} title={narrow ? label : undefined} className={className}>{content}</Link>
      ) : (
        <a href={item.anchor ? `#${item.anchor}` : "#"} onClick={item.anchor ? undefined : (event) => event.preventDefault()} aria-current={active ? "page" : undefined} aria-label={narrow ? label : undefined} title={narrow ? label : undefined} className={className}>{content}</a>
      )}
    </li>
  );
}
