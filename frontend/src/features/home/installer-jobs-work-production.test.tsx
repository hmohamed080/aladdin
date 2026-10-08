import { fireEvent, screen, within } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import { countAssignmentsByStatus } from "@/lib/work/assignment-state";
import { InstallerWorkBoard } from "./installer-work-board";
import { InstallerWorkRail } from "./installer-work-rail";
import { toActiveWorkVM, toWorkRowVMs, toWorkTabs } from "./installer-work-data";

const nav = vi.hoisted(() => ({ replace: vi.fn(), path: "/home/jobs" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill; void _priority; void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

const t = createTranslator("en");

beforeEach(() => {
  nav.replace.mockClear();
  nav.path = "/home/jobs";
});

/* ----------------------------------------------------------------------------- */

function assignment(over: Partial<MyAssignmentRow> = {}): MyAssignmentRow {
  return {
    id: "a1", job_id: "j1", application_id: "ap1", job_title: "Interior painting", job_description: null,
    job_status: "awarded" as never, trade_key: "painting", poster_org_name: "Al Alwan Showroom", governorate: "Cairo",
    city: "Madinaty", site_address: null, agreed_amount: 3200, agreed_currency: "EGP", expected_duration_days: 4,
    starts_on: "2026-10-01", ends_by: "2026-10-10", status: "in_progress", latest_progress_percent: 60,
    last_progress_at: "2026-10-05T09:00:00Z", created_at: "2026-09-28T09:00:00Z", started_at: "2026-10-01T09:00:00Z",
    completed_at: null, cancelled_at: null, cancellation_reason: null, published_at: "2026-09-20T09:00:00Z",
    trade_is_active: true, version: 1, ...over,
  };
}

const NOW = new Date("2026-10-05T12:00:00Z");

function work(rows: MyAssignmentRow[], activeTab = "all", stage: string | null = "Floor installation") {
  const counts = countAssignmentsByStatus(rows);
  const featured = rows.find((r) => r.status === "in_progress") ?? rows[0] ?? null;
  return (
    <InstallerWorkBoard
      activeWork={featured ? toActiveWorkVM(featured, stage, t, "en", NOW) : null}
      rows={toWorkRowVMs(rows, t, "en", NOW)}
      tabs={toWorkTabs(counts, t)}
      activeTab={activeTab}
      rail={<InstallerWorkRail counts={counts} locale="en" t={t} />}
      subtitle="Track your work."
      headerAction={<Link href="/home/jobs">Browse jobs</Link>}
    />
  );
}

describe("production My Work — one approved presentation, only real capabilities", () => {
  const rows = [
    assignment(),
    assignment({ id: "a2", job_title: "Marble bathroom", status: "scheduled", latest_progress_percent: null, last_progress_at: null, poster_org_name: "Marble Pro", starts_on: "2026-11-01", ends_by: "2026-11-05" }),
    assignment({ id: "a3", job_title: "Gypsum ceiling", status: "completed", poster_org_name: "Elegant Decor", starts_on: "2026-06-01", ends_by: "2026-06-20" }),
    assignment({ id: "a4", job_title: "Old villa job", status: "cancelled", poster_org_name: "Stone Art", starts_on: null, ends_by: null }),
  ];

  beforeEach(() => {
    nav.path = "/home/work";
  });

  it("exposes no contact, rating, documents, tools, export or saved searches", () => {
    renderWithI18n(work(rows), "en");
    expect(screen.queryByRole("columnheader", { name: "Contact" })).toBeNull();
    expect(screen.queryByRole("button", { name: /show full (phone|email)/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Documents and files" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Quick tools" })).toBeNull();
    expect(screen.queryByText(/upload current-work photos|request materials|message the showroom|deadline extension/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Export report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saved searches" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("shows the real status summary in the rail, linked to the real tabs", () => {
    renderWithI18n(work(rows), "en");
    const rail = screen.getByRole("complementary", { name: t("work.summary.title") });
    expect(within(rail).getByRole("link", { name: new RegExp(t("work.summary.scheduled")) })).toHaveAttribute("href", "/home/work?state=scheduled");
    expect(within(rail).getByRole("link", { name: new RegExp(t("work.summary.completed")) })).toHaveAttribute("href", "/home/work?state=completed");
    expect(within(rail).queryByText(/this month/i)).toBeNull();
  });

  it("featured panel: real progress, current stage from a real update, no next stage, no +10% button", () => {
    renderWithI18n(work(rows), "en");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("Floor installation")).toBeTruthy();
    expect(screen.queryByText("Next stage")).toBeNull();
    const panel = document.querySelector('section[aria-labelledby="active-work-title"]') as HTMLElement;
    const update = within(panel).getByRole("link", { name: "Update progress" });
    expect(update).toHaveAttribute("href", "/home/work/a1");
    // Clicking it navigates; it never changes the percentage locally.
    fireEvent.click(update);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
  });

  it("without a stage there is no stage block", () => {
    renderWithI18n(work(rows, "all", null), "en");
    expect(screen.queryByText("Current stage")).toBeNull();
  });

  it("an empty book of work keeps its structure with a designed empty state", () => {
    renderWithI18n(work([]), "en");
    expect(screen.getByText("No current work")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "All your work" })).toBeTruthy();
    const card = screen.getByText("No current work").closest("div")!.parentElement!;
    expect(within(card).getByRole("link", { name: "Browse job opportunities" })).toHaveAttribute("href", "/home/jobs");
  });

  it("rows offer Start work only for scheduled and Update progress only for in progress", () => {
    renderWithI18n(work(rows), "en");
    const table = screen.getAllByRole("table")[0]!;
    const start = within(table).getAllByRole("link", { name: "Start work" });
    expect(start.map((l) => l.getAttribute("href"))).toEqual(["/home/work/a2"]);
    expect(within(table).getAllByRole("link", { name: "Update progress" }).map((l) => l.getAttribute("href"))).toEqual(["/home/work/a1"]);
    expect(within(table).getAllByRole("link", { name: "View" }).map((l) => l.getAttribute("href")).sort()).toEqual(["/home/work/a3", "/home/work/a4"]);
  });

  it("the status filter offers only the real vocabulary", () => {
    renderWithI18n(work(rows), "en");
    fireEvent.click(screen.getByRole("button", { name: "All filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      t("work.tab.current"),
      t("jobs.assignmentStatus.scheduled" as never),
      t("jobs.assignmentStatus.in_progress" as never),
      t("jobs.assignmentStatus.completed" as never),
      t("jobs.assignmentStatus.cancelled" as never),
    ]);
    expect(options.join("|")).not.toMatch(/paused|review|archiv|accepted/i);
  });

  it("the tab narrows the list by real status", () => {
    renderWithI18n(work(rows, "completed"), "en");
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByText("Gypsum ceiling")).toBeTruthy();
    expect(within(table).queryByText("Interior painting")).toBeNull();
  });

  it("the date range filters on the PLANNED WINDOW and excludes undated work only when active", () => {
    renderWithI18n(work(rows), "en");
    const inTable = () => within(screen.getAllByRole("table")[0]!);
    expect(inTable().getByText("Old villa job")).toBeTruthy(); // undated, no filter -> included

    fireEvent.click(screen.getByRole("button", { name: "Planned period" }));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(inTable().getByText("Interior painting")).toBeTruthy(); // 10-01 → 10-10 overlaps
    expect(inTable().queryByText("Marble bathroom")).toBeNull(); // 11-01 → 11-05 after
    expect(inTable().queryByText("Gypsum ceiling")).toBeNull(); // June, before
    expect(inTable().queryByText("Old villa job")).toBeNull(); // undated, filter active -> excluded
  });

  it("changing the tab navigates to the real ?state= URL", () => {
    renderWithI18n(work(rows), "en");
    fireEvent.click(screen.getByRole("button", { name: "All filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: t("jobs.assignmentStatus.completed" as never) }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(nav.replace).toHaveBeenCalledWith("/home/work?state=completed");
  });

  it("formats an exact fractional agreed amount", () => {
    renderWithI18n(work([assignment({ agreed_amount: 4500.5 })]), "en");
    expect(screen.getAllByText("4,500.50 EGP").length).toBeGreaterThan(0);
  });
});