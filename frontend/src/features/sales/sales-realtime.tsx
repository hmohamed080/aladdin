"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";

/**
 * Scoped sales Realtime (Sprint 6). Mounted once in the B2B shell for the ACTIVE
 * organization. It subscribes — through the caller's normal anon browser client,
 * never service_role — to Postgres Changes on the two approved tables (`leads`,
 * `follow_up_tasks`), narrowed to this organization. RLS is the real boundary;
 * this component NEVER renders a Realtime payload. An event is only a hint: it
 * triggers `router.refresh()`, which re-fetches everything through RLS on the
 * server, so the client can never surface a row it isn't authorized to see, and a
 * duplicate or out-of-order event can never corrupt local state (there is no
 * local card state — the server is the single source of truth).
 *
 * Safety details:
 *  - The org id is SERVER-DERIVED (validated against real membership), not a raw
 *    cookie, so a forged cookie can't widen the subscription.
 *  - The channel is removed on unmount and rebuilt when the active org/branch
 *    changes (deps), so switching context tears down the old scope and sign-out
 *    (navigation away / SIGNED_OUT) removes every channel — no leak, no duplicate.
 *  - While the user is typing in a form, the refresh is DEFERRED to a manual
 *    "refresh" affordance so incoming data never overwrites an open edit or moves
 *    focus. Reconnecting/paused states are shown; raw channel errors never are.
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

  function doRefresh() {
    router.refresh();
    setPending(false);
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2500);
  }

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    function onChange() {
      // Coalesce bursts; never refresh mid-edit (defer to the manual affordance).
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        if (isEditing()) setPending(true);
        else doRefresh();
      }, 400);
    }

    const filter = `organization_id=eq.${orgId}`;
    const channel: RealtimeChannel = supabase
      .channel(`sales:${orgId}:${branchId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "follow_up_tasks", filter }, onChange)
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("reconnecting");
        else if (s === "CLOSED") setStatus("offline");
      });

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") supabase.removeChannel(channel);
    });

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
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
