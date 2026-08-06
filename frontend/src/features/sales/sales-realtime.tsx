"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { rtAddChannel, rtRemoveChannel, rtRefresh, rtDeferred, rtStatus, REALTIME_DEBUG } from "@/features/sales/realtime-debug";

/**
 * Scoped sales Realtime (Sprint 6 / 6.1 / 6.2). Mounted once in the B2B shell for
 * the ACTIVE organization + branch. It subscribes — through the caller's normal
 * anon browser client, never service_role — to Postgres Changes on the two
 * approved tables (`leads`, `follow_up_tasks`), narrowed to **exactly what the
 * current pages display**:
 *   - **All branches** (activeBranchId null) → `organization_id=eq.<orgId>`;
 *   - **a selected branch** → `branch_id=eq.<branchId>` (which, like the list
 *     queries, EXCLUDES org-wide NULL-branch rows — honest scope, no spurious
 *     refreshes from other branches).
 * The org/branch ids are SERVER-DERIVED (validated against real membership), not
 * raw cookies, so a forged cookie can't widen the subscription.
 *
 * RLS is the real boundary; this component NEVER renders a Realtime payload. An
 * event is only a hint: it triggers a debounced `router.refresh()`, which
 * re-fetches through RLS on the server — so the client can never surface a row it
 * isn't authorized to see, and duplicate/out-of-order events can't corrupt local
 * state (there is no client card state — the server is the single source of truth).
 *
 * Lifecycle: the channel is created per (org, branch); the effect deps rebuild it
 * when either changes (old channel removed BEFORE the new one becomes effective),
 * and it is removed on unmount and on `SIGNED_OUT` — no leak, no duplicate. EVERY
 * pending timer is cleared on unmount / org / branch change / sign-out, and no
 * state is set after unmount.
 *
 * Open-edit safety (Sprint 6.2): a refresh is deferred to the manual "Updated ↻"
 * affordance while any B2B **edit form is DIRTY** — the form stays protected after
 * the edited control loses focus (a document-level capture guard tracks modified
 * forms; search/filter forms opt out with `data-no-dirty`), until a navigation
 * resets it. So incoming data never overwrites unsaved input or moves focus.
 */
type Status = "connecting" | "live" | "reconnecting" | "offline";

/** True while the active element is a form control the user is actively editing. */
function isFocusedInControl(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable === true;
}

export function SalesRealtime({ orgId, branchId }: { orgId: string; branchId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("connecting");
  const [flash, setFlash] = useState(false);
  const [pending, setPending] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeRef = useRef<string>("");
  const mounted = useRef(true);
  // Forms the user has modified (dirty). A WeakSet is fine — we only test presence
  // and never enumerate; it holds element refs, never values (no PII).
  const dirtyForms = useRef<Set<HTMLFormElement>>(new Set());

  // Track real component mount/unmount (independent of the subscription effect's
  // deps) so no setState fires after unmount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Dirty-form guard: mark a form dirty on the first user modification and keep it
  // dirty after focus leaves. Search/filter forms opt out via `data-no-dirty`.
  useEffect(() => {
    function onEdit(e: Event) {
      const target = e.target as HTMLElement | null;
      const form = target?.closest?.("form");
      if (!form || form.hasAttribute("data-no-dirty")) return;
      dirtyForms.current.add(form as HTMLFormElement);
    }
    function onReset(e: Event) {
      const form = (e.target as HTMLElement | null)?.closest?.("form");
      if (form) dirtyForms.current.delete(form as HTMLFormElement);
    }
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    document.addEventListener("reset", onReset, true);
    return () => {
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      document.removeEventListener("reset", onReset, true);
    };
  }, []);

  // A navigation (successful submit, link, or the manual refresh landing on a new
  // route) resets the dirty set — the previous forms are gone/reset.
  useEffect(() => {
    dirtyForms.current.clear();
  }, [pathname]);

  function anyFormDirty(): boolean {
    // Prune forms detached by a soft refresh so we never defer forever.
    for (const f of dirtyForms.current) if (!f.isConnected) dirtyForms.current.delete(f);
    return dirtyForms.current.size > 0;
  }

  function doRefresh() {
    if (!mounted.current) return;
    router.refresh();
    rtRefresh(scopeRef.current);
    // A refresh means the user chose to accept incoming data — dirty state is stale.
    dirtyForms.current.clear();
    setPending(false);
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      if (mounted.current) setFlash(false);
      flashTimer.current = null;
    }, 2500);
  }

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const scope = branchId ? `branch:${branchId}` : `org:${orgId}`;
    const filter = branchId ? `branch_id=eq.${branchId}` : `organization_id=eq.${orgId}`;
    scopeRef.current = scope;

    function onChange() {
      // Coalesce bursts; DEFER while an edit form is dirty or being edited (the
      // manual affordance then applies it), else refresh.
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        if (!mounted.current) return;
        if (anyFormDirty() || isFocusedInControl()) {
          rtDeferred();
          setPending(true);
        } else {
          doRefresh();
        }
      }, 400);
    }

    (async () => {
      // Authenticate the Realtime socket as the CALLER so RLS authorizes each
      // Postgres Changes event against the user's own policies.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel = supabase
        .channel(`sales:${scope}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "follow_up_tasks", filter }, onChange)
        .subscribe((s) => {
          rtStatus(s);
          if (!mounted.current) return;
          if (s === "SUBSCRIBED") {
            rtAddChannel(scope);
            setStatus("live");
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
            setStatus("reconnecting");
          } else if (s === "CLOSED") {
            rtRemoveChannel(scope);
            setStatus("offline");
          }
        });
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        if (channel) supabase.removeChannel(channel);
        rtRemoveChannel(scope);
        // Sign-out tears down the workspace: clear pending timers too.
        if (debounce.current) clearTimeout(debounce.current);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        debounce.current = null;
        flashTimer.current = null;
      } else if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    // Deterministic reconnecting/paused status for tests — dev/E2E only.
    let onForceStatus: ((e: Event) => void) | null = null;
    if (REALTIME_DEBUG) {
      onForceStatus = (e: Event) => {
        const next = (e as CustomEvent<Status>).detail;
        if (mounted.current && next) setStatus(next);
      };
      window.addEventListener("sales-realtime:set-status", onForceStatus);
    }

    return () => {
      cancelled = true;
      // Clear EVERY pending timer on unmount / org / branch change.
      if (debounce.current) clearTimeout(debounce.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      debounce.current = null;
      flashTimer.current = null;
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
      rtRemoveChannel(scope);
      if (onForceStatus) window.removeEventListener("sales-realtime:set-status", onForceStatus);
    };
    // Rebuild the subscription when the active org or branch changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, branchId]);

  const label =
    status === "reconnecting" ? t("realtime.reconnecting") : status === "offline" ? t("realtime.offline") : t("realtime.live");
  const dotClass =
    status === "live" ? "bg-success" : status === "reconnecting" ? "bg-warning" : status === "offline" ? "bg-danger" : "bg-fg-muted";

  return (
    <div className="flex items-center gap-2 text-label text-fg-muted" aria-live="polite">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="sr-only">{label}. </span>
      {pending ? (
        <button
          type="button"
          data-testid="realtime-refresh"
          onClick={doRefresh}
          className="rounded-sm border border-strong px-2 py-0.5 text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("realtime.updated")} ↻
        </button>
      ) : flash ? (
        <span className="text-success">{t("realtime.updated")}</span>
      ) : (
        <span data-testid="realtime-status" aria-hidden="true">{status === "reconnecting" || status === "offline" ? label : ""}</span>
      )}
    </div>
  );
}
