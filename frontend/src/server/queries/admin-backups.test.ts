import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadBackupRuns, type BackupRunsFilter } from "./admin-backups";

const row = {
  id: "r1", kind: "backup", trigger: "schedule", status: "succeeded", requested_by: null, reason: "x",
  github_run_id: 7, github_run_url: null, github_conclusion: "success", summary: {}, error_code: null,
  requested_at: "2026-11-26T00:00:00Z", dispatched_at: null, started_at: null, finished_at: null, reported_at: null,
};
const payload = { runs: [row], total: 21, page: 2, page_size: 20, skipped_total: 4 };
const filter: BackupRunsFilter = { page: 2, kind: "backup", status: null, includeSkipped: false };

const client = (data: unknown, error: unknown = null) => {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, supabase: { rpc } as unknown as Parameters<typeof loadBackupRuns>[0] };
};

describe("loadBackupRuns", () => {
  it("asks the database for one page with the filters and parses it", async () => {
    const { rpc, supabase } = client(payload);
    const result = await loadBackupRuns(supabase, filter);
    expect(rpc).toHaveBeenCalledWith("admin_backup_runs", { p_page: 2, p_kind: "backup", p_status: undefined, p_include_skipped: false });
    expect(result).toMatchObject({ total: 21, page: 2, pageSize: 20, skippedTotal: 4 });
    expect(result?.runs.map((r) => r.id)).toEqual(["r1"]);
  });
  it("is null when the read fails, so a failure never looks like an empty history", async () => {
    expect(await loadBackupRuns(client(null, { message: "no" }).supabase, filter)).toBeNull();
  });
  it("is null when the payload is not a page", async () => {
    expect(await loadBackupRuns(client({ runs: [] }).supabase, filter)).toBeNull();
    expect(await loadBackupRuns(client(null).supabase, filter)).toBeNull();
  });
});
