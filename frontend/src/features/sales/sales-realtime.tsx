"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { rtAddChannel, rtRemoveChannel, rtRefresh, rtDeferred, rtStatus } from "@/features/sales/realtime-debug";

/**
 * Scoped sales Realtime (Sprint 6 / 6.1). Mounted once in the B2B shell for the
 * ACTIVE organization + branch. It subscribes — through the caller's normal anon
 * browser client, never service_role — to Postgres Changes on the two approved
 * tables (`leads`, `follow_up_tasks`), narrowed to **exactly what the current
 * pages display**:
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
 * and it is removed on unmount and on `SIGNED_OUT` — no leak, no duplicate. While
 * a form field is focused the refresh is DEFERRED to a manual affordance so
 * incoming data never overwrites an open edit or moves focus.
 */
type Status = "connecting" | "live" | "reconnecting" | "offline";

function isEditing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable === true
  );
}

export function SalesRealtime({ orgId, branchId }: { orgId: string; branchId: string | null }) {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("connecting");
  const [flash, setFlash] = useState(false);
  const [pending, setPending] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeRef = useRef<string>("");

  function doRefresh() {
    router.refresh();
    rtRefresh(scopeRef.current);
    setPending(false);
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2500);
  }

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    // Scope matches the visible data: a selected branch filters by branch_id
    // (excluding org-wide NULL-branch rows, like the list queries); "all" uses
    // the validated organization scope.
    const scope = branchId ? `branch:${branchId}` : `org:${orgId}`;
    const filter = branchId ? `branch_id=eq.${branchId}` : `organization_id=eq.${orgId}`;
    scopeRef.current = scope;

    function onChange() {
      // Coalesce bursts; never refresh mid-edit (defer to the manual affordance).
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        if (isEditing()) {
          rtDeferred();
          setPending(true);
        } else {
          doRefresh();
        }
      }, 400);
    }

    (async () => {
      // Authenticate the Realtime socket as the CALLER so RLS authorizes each
      // Postgres Changes event against the user's own policies (an anon socket
      // would be authorized as anon and receive nothing).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel = supabase
        .channel(`sales:${scope}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "follow_up_tasks", filter }, onChange)
        .subscribe((s) => {
          rtStatus(s);
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
      } else if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      cancelled = true;
      if (debounce.current) clearTimeout(debounce.current);
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
      rtRemoveChannel(scope);
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
        <span aria-hidden="true">{status === "reconnecting" || status === "offline" ? label : ""}</span>
      )}
    </div>
  );
}
