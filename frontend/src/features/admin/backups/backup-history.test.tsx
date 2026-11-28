import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import type { BackupRun, BackupRunsFilter, BackupRunsPage } from "@/server/queries/admin-backups";
import { BackupHistory } from "./backup-history";

afterEach(cleanup);

const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: "r1", kind: "backup", trigger: "schedule", status: "succeeded", requested_by: null,
  reason: "Scheduled run reported by GitHub.", github_run_id: 7, github_run_url: null, github_conclusion: "success",
  summary: {}, error_code: null, requested_at: "2026-11-26T00:00:00Z", dispatched_at: null, started_at: null,
  finished_at: null, reported_at: null, ...over,
});
const page = (over: Partial<BackupRunsPage> = {}): BackupRunsPage => ({ runs: [run()], total: 41, page: 2, pageSize: 20, skippedTotal: 5, ...over });
const filter = (over: Partial<BackupRunsFilter> = {}): BackupRunsFilter => ({ page: 2, kind: null, status: null, includeSkipped: false, ...over });

const t = createTranslator("en");
const draw = (result: BackupRunsPage | null, value = filter()) =>
  render(<BackupHistory result={result} filter={value} t={t} who={(id) => id ?? "—"} when={(iso) => iso ?? "—"} repo="owner/repo" />);
const href = (testId: string) => screen.getByTestId(testId).getAttribute("href");

describe("BackupHistory", () => {
  it("pages with the page the server returned, not the one asked for", () => {
    draw(page(), filter({ page: 99 }));
    expect(screen.getByTestId("backup-history-page").textContent).toContain("2");
    expect(screen.getByTestId("backup-history-page").textContent).toContain("3");
    expect(href("backup-history-previous")).toBe("/admin/backups");
    expect(href("backup-history-next")).toBe("/admin/backups?page=3");
  });
  it("has no previous on the first page and no next on the last", () => {
    draw(page({ page: 1 }));
    expect(screen.queryByTestId("backup-history-previous")).toBeNull();
    cleanup();
    draw(page({ page: 3 }));
    expect(screen.queryByTestId("backup-history-next")).toBeNull();
  });
  it("shows no pager when everything fits on one page", () => {
    draw(page({ page: 1, total: 20 }));
    expect(screen.queryByTestId("backup-history-page")).toBeNull();
  });
  it("keeps the filters while paging", () => {
    draw(page(), filter({ kind: "backup", status: "failed" }));
    expect(href("backup-history-next")).toBe("/admin/backups?page=3&kind=backup&status=failed");
  });
  it("starts again at page 1 when a filter or the skipped choice changes", () => {
    draw(page(), filter({ status: "failed" }));
    expect(href("backup-filter-kind-restore_test")).toBe("/admin/backups?kind=restore_test&status=failed");
    expect(href("backup-filter-status-all")).toBe("/admin/backups");
    cleanup();
    draw(page(), filter({ kind: "backup" }));
    expect(href("backup-skipped-toggle")).toBe("/admin/backups?kind=backup&skipped=1");
  });
  it("offers skipped checks only under the all-statuses filter, where the choice changes something", () => {
    for (const status of ["failed", "succeeded", "skipped"] as const) {
      draw(page(), filter({ status }));
      expect(screen.queryByTestId("backup-skipped-toggle"), status).toBeNull();
      expect(screen.queryByText(t("backups.history.skippedHint")), status).toBeNull();
      cleanup();
    }
  });
  it("says the history could not be read instead of saying it is empty", () => {
    draw(null);
    expect(screen.getByRole("alert").textContent).toBe(t("backups.history.loadError"));
    expect(screen.queryByText(t("backups.history.empty"))).toBeNull();
  });
  it("lists the runs with their GitHub link, and says when there are none", () => {
    draw(page());
    expect(screen.getByRole("link", { name: "#7" }).getAttribute("href")).toBe("https://github.com/owner/repo/actions/runs/7");
    cleanup();
    draw(page({ runs: [], total: 0, page: 1 }));
    expect(screen.getByText(t("backups.history.empty"))).toBeTruthy();
  });
});
