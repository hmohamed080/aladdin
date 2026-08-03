"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Select } from "@/components/ui/controls";
import { formatDate, LEAD_STAGES, PRIORITIES } from "@/lib/ui/format";
import { StageBadge, StatusBadge, PriorityBadge } from "@/features/sales/badges";
import type { LeadRow } from "@/server/queries/sales";

type Names = Record<string, string>;

/** List + pipeline (grouped cards) views with URL-driven filters. */
export function LeadsView({
  leads,
  customerNames,
  memberNames,
  branches,
  defaults,
}: {
  leads: LeadRow[];
  customerNames: Names;
  memberNames: Names;
  branches: { id: string; name: string }[];
  defaults: { view: "list" | "pipeline"; stage: string; status: string; branch: string; priority: string };
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/b2b/leads?${next.toString()}`);
  };

  const isPipeline = defaults.view === "pipeline";

  return (
    <div className="flex flex-col gap-md">
      {/* View toggle + filters */}
      <div className="flex flex-wrap items-end gap-sm">
        <div className="inline-flex rounded-sm border" role="tablist" aria-label={t("leads.title")}>
          <button
            role="tab"
            aria-selected={!isPipeline}
            onClick={() => push({ view: "" })}
            className={`min-h-9 px-md py-1.5 text-label ${!isPipeline ? "bg-surface-2 text-fg" : "text-fg-secondary"}`}
          >
            {t("leads.viewList")}
          </button>
          <button
            role="tab"
            aria-selected={isPipeline}
            onClick={() => push({ view: "pipeline" })}
            className={`min-h-9 px-md py-1.5 text-label ${isPipeline ? "bg-surface-2 text-fg" : "text-fg-secondary"}`}
          >
            {t("leads.viewPipeline")}
          </button>
        </div>

        <label>
          <span className="sr-only">{t("leads.status")}</span>
          <Select aria-label={t("leads.status")} defaultValue={defaults.status} onChange={(e) => push({ status: e.target.value })}>
            <option value="">{t("common.all")}</option>
            {["active", "won", "lost", "archived"].map((s) => (
              <option key={s} value={s}>{t(`leads.statuses.${s}`)}</option>
            ))}
          </Select>
        </label>

        {!isPipeline ? (
          <label>
            <span className="sr-only">{t("leads.stage")}</span>
            <Select aria-label={t("leads.stage")} defaultValue={defaults.stage} onChange={(e) => push({ stage: e.target.value })}>
              <option value="">{t("common.all")}</option>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>{t(`leads.stages.${s}`)}</option>
              ))}
            </Select>
          </label>
        ) : null}

        <label>
          <span className="sr-only">{t("leads.priority")}</span>
          <Select aria-label={t("leads.priority")} defaultValue={defaults.priority} onChange={(e) => push({ priority: e.target.value })}>
            <option value="">{t("common.all")}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(`priority.${p}`)}</option>
            ))}
          </Select>
        </label>

        {branches.length > 0 ? (
          <label>
            <span className="sr-only">{t("leads.branch")}</span>
            <Select aria-label={t("leads.branch")} defaultValue={defaults.branch} onChange={(e) => push({ branch: e.target.value })}>
              <option value="">{t("nav.allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>

      {leads.length === 0 ? (
        <p className="rounded-md border border-dashed bg-surface px-md py-lg text-center text-body text-fg-secondary">
          {t("leads.empty")}
        </p>
      ) : isPipeline ? (
        <Pipeline leads={leads} customerNames={customerNames} />
      ) : (
        <LeadTable leads={leads} customerNames={customerNames} memberNames={memberNames} />
      )}
    </div>
  );

  function LeadTable({
    leads,
    customerNames,
    memberNames,
  }: {
    leads: LeadRow[];
    customerNames: Names;
    memberNames: Names;
  }) {
    return (
      <>
        {/* Mobile cards */}
        <ul className="flex flex-col gap-sm tablet:hidden">
          {leads.map((l) => (
            <li key={l.id}>
              <Link href={`/b2b/leads/${l.id}`} className="block rounded-md border bg-surface p-md hover:border-strong">
                <div className="flex items-center justify-between gap-md">
                  <span className="min-w-0 flex-1 truncate text-body-lg font-medium text-fg">{l.title}</span>
                  <StatusBadge status={l.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-label text-fg-secondary">
                  <StageBadge stage={l.stage} />
                  <PriorityBadge priority={l.priority} />
                  <span>{l.customer_id ? customerNames[l.customer_id] ?? "—" : t("common.none")}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {/* Table */}
        <div className="hidden overflow-x-auto tablet:block">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b text-label text-fg-muted">
                <th scope="col" className="px-3 py-2 text-start">{t("leads.leadTitle")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("leads.customer")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("leads.stage")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("leads.status")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("leads.priority")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("leads.assignee")}</th>
                <th scope="col" className="px-3 py-2 text-start">{t("leads.nextFollowUp")}</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <Link href={`/b2b/leads/${l.id}`} className="text-fg hover:text-accent">{l.title}</Link>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{l.customer_id ? customerNames[l.customer_id] ?? "—" : "—"}</td>
                  <td className="px-3 py-2"><StageBadge stage={l.stage} /></td>
                  <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                  <td className="px-3 py-2">{l.priority === "normal" || l.priority === "low" ? <span className="text-fg-muted">{t(`priority.${l.priority}`)}</span> : <PriorityBadge priority={l.priority} />}</td>
                  <td className="px-3 py-2 text-fg-secondary">{l.assigned_membership_id ? memberNames[l.assigned_membership_id] ?? "—" : t("common.unassigned")}</td>
                  <td className="px-3 py-2 text-fg-secondary">{formatDate(l.next_follow_up_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function Pipeline({ leads, customerNames }: { leads: LeadRow[]; customerNames: Names }) {
    const active = leads.filter((l) => l.status === "active");
    return (
      <div className="grid grid-cols-1 gap-md tablet:grid-cols-3 desktop:grid-cols-5">
        {LEAD_STAGES.map((stage) => {
          const col = active.filter((l) => l.stage === stage);
          return (
            <section key={stage} aria-label={t(`leads.stages.${stage}`)} className="flex flex-col gap-sm rounded-md bg-surface-2/50 p-sm">
              <h3 className="flex items-center justify-between px-1 text-label text-fg-secondary">
                <span>{t(`leads.stages.${stage}`)}</span>
                <span className="font-mono text-fg-muted">{col.length}</span>
              </h3>
              {col.map((l) => (
                <Link key={l.id} href={`/b2b/leads/${l.id}`} className="block rounded-sm border bg-surface p-sm hover:border-strong">
                  <span className="block truncate text-body text-fg">{l.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-label text-fg-muted">
                    <PriorityBadge priority={l.priority} />
                    <span className="truncate">{l.customer_id ? customerNames[l.customer_id] ?? "" : ""}</span>
                  </span>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    );
  }
}
