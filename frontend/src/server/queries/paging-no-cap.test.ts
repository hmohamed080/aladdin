import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE 100-ROW SAMPLE IS GONE, AND STAYS GONE.
 *
 * My Work used to read the newest 100 assignments and filter / count / "reveal" them in
 * the application; Jobs "Nearest" used to rank only the newest 100 opportunities. Both are
 * real database pages now (`my_work_page`, `open_job_opportunities_ranked`), proven in
 * pgTAP with datasets well past 100. This is the application side: a guard that the two
 * pages cannot quietly go back to reading a capped sample and deciding things from it.
 */

const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
/** The code of a file with its comments removed, so a guard checks what runs and not what is explained. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("My Work pages from the database, not from a capped read", () => {
  const page = read("app/home/work/page.tsx");

  it("asks for the first page, the exact counts and the companies from the database", () => {
    expect(page).toMatch(/loadWorkBoardPage\(/);
    expect(read("server/queries/work-board-page.ts")).toMatch(/listMyWorkPage\(/);
    expect(page).toMatch(/countMyAssignments\(/);
    expect(page).toMatch(/listWorkCompanies\(/);
  });

  it("never reads the capped list, and never derives a count from rows", () => {
    expect(page).not.toMatch(/listMyAssignments|countAssignmentsByStatus|featuredAssignment\(/);
    expect(page).not.toMatch(/WORK_READ_LIMIT|limitNote|latest \$\{|Showing your latest/);
  });

  it("the board does not slice, filter or count the rows it is given", () => {
    const board = read("features/home/installer-work-board.tsx");
    expect(board).not.toMatch(/rows\.(slice|filter|map)\(|limitNote/);
  });

  it("the View does not filter or slice in server-driven mode", () => {
    const view = read("features/installer-my-work-preview/installer-my-work-view.tsx");
    // The one memo that filters starts by returning the rows untouched when the route drives.
    expect(view).toMatch(/if \(remote\) return rows;/);
    expect(view).toMatch(/const paginatedRows = remote \? filteredRows : filteredRows\.slice\(0, visibleCount\)/);
    expect(view).not.toMatch(/limitNote/);
  });

  it("the query layer's default ceiling (100) is not what the page uses", () => {
    const q = read("server/queries/job-assignments.ts");
    expect(q).toMatch(/export async function listMyWorkPage/);
    const body = q.slice(q.indexOf("export async function listMyWorkPage"), q.indexOf("export async function countMyAssignments"));
    expect(body).not.toMatch(/LIST_LIMIT|\.limit\(/);
  });
});

describe("Jobs 'Nearest' pages from the database, not from a capped, client-ranked sample", () => {
  const page = read("app/home/jobs/page.tsx");

  it("one query path for every sort, shared by the first page and every appended page", () => {
    expect(page).toMatch(/loadJobBoardPage\(/);
    expect(read("server/queries/job-board-page.ts")).toMatch(/listJobOpportunityPage\(/);
    expect(page).not.toMatch(/listJobOpportunities\(/);
  });

  it("never ranks rows itself or states a capped window", () => {
    expect(page).not.toMatch(/rankByLocation|installerLocationFrom|OPPORTUNITY_LIST_LIMIT|nearestPageLabel/);
    expect(page).not.toMatch(/among the newest|أحدث \$\{/);
  });

  it("the data layer carries no 'newest N' copy", () => {
    const data = read("features/home/installer-jobs-data.ts");
    expect(data).not.toMatch(/Nearest among the newest|الأقرب بين أحدث/);
  });

  it("Nearest is an ORDER the database applies, from the location tier it computes — the application only names it", () => {
    const q = code("server/queries/job-opportunities.ts");
    expect(q).toMatch(/p_sort: sort/);
    expect(q).not.toMatch(/\.order\(\s*["\x27`](proximity_tier|published_at|offered_amount|match)|open_job_opportunities_ranked|proximity_tier\s*[<>]/);
    const sql = read("../../supabase/migrations/20261007090006_job_opportunities_page.sql");
    expect(sql).toMatch(/nearest\s+tier ASC, published_at DESC, id DESC/);
  });
});

describe("one location authority", () => {
  it("the board's governorate / city filters send catalogue KEYS — they do not carry a second name list", () => {
    const filters = read("lib/installer/job-board-filters.ts");
    expect(filters).not.toMatch(/GOVERNORATE_OPTIONS|namesOf|governorateNames|cityNames/);
    expect(filters).toMatch(/governorateKey/);
  });

  it("the query layer resolves nothing in TypeScript: no catalogue import, no ranking helper", () => {
    const q = read("server/queries/job-opportunities.ts");
    expect(q).not.toMatch(/location-data|opportunity-location|rankByLocation|resolveGovernorateKey/);
  });
});

describe("true paged append — there is no window and no ceiling anywhere in the flow", () => {
  it("neither board carries a window size, a window ceiling or a `shown` URL parameter", () => {
    for (const rel of [
      "lib/installer/job-board-filters.ts",
      "lib/installer/work-board-params.ts",
      "features/home/installer-jobs-board.tsx",
      "features/home/installer-work-board.tsx",
      "app/home/jobs/page.tsx",
      "app/home/work/page.tsx",
    ]) {
      expect(read(rel), rel).not.toMatch(/JOB_PAGE_MAX|WORK_PAGE_MAX|shown\s*[:=,)]|p\.set\("shown"/);
    }
  });

  it("'Show more' calls the append actions with the board's own question and the OPAQUE cursor the last page returned", () => {
    expect(read("features/home/installer-jobs-board.tsx")).toMatch(/loadMoreJobsAction\(search, cursor\)/);
    expect(read("features/home/installer-work-board.tsx")).toMatch(/loadMoreWorkAction\(search, cursor\)/);
    for (const rel of ["features/home/installer-jobs-board.tsx", "features/home/installer-work-board.tsx"]) expect(read(rel), rel).toMatch(/useCursorPages/);
  });

  it("the append actions re-validate the question exactly as the page does, take only an opaque cursor, and set no ceiling", () => {
    const jobs = read("server/actions/job-board.ts");
    const work = read("server/actions/work-board.ts");
    expect(jobs).toMatch(/parseJobBoardParams\(/);
    expect(work).toMatch(/parseWorkBoardParams\(/);
    expect(jobs).toMatch(/loadMoreJobsAction\(search: string, cursor: string\)/);
    expect(work).toMatch(/loadMoreWorkAction\(search: string, cursor: string\)/);
  });

  it("the Saved filter is a predicate, not a capped id list", () => {
    expect(read("server/queries/job-opportunities.ts")).toMatch(/p_saved: f\.saved \? true : undefined/);
    expect(read("../../supabase/migrations/20261007090006_job_opportunities_page.sql")).toMatch(/saved_jobs sj where sj\.user_id = \$9/);
    expect(read("server/queries/saved-jobs.ts")).not.toMatch(/SAVED_JOBS_LIMIT|\.limit\(/);
  });
});

describe("KEYSET paging: offset paging is gone from Jobs and My Work", () => {
  const FLOW = [
    "server/queries/job-opportunities.ts",
    "server/queries/job-board-page.ts",
    "server/queries/work-board-page.ts",
    "server/queries/job-assignments.ts",
    "server/actions/job-board.ts",
    "server/actions/work-board.ts",
    "features/home/installer-jobs-board.tsx",
    "features/home/installer-work-board.tsx",
    "features/home/use-cursor-pages.ts",
    "app/home/jobs/page.tsx",
    "app/home/work/page.tsx",
  ];

  it("no code in the flow carries an offset, a `.range(` window or a row-count position", () => {
    for (const rel of FLOW) {
      const text = code(rel);
      expect(text, rel).not.toMatch(/offset|p_offset|\.range\(|cards\.length\)|allRows\.length\)/i);
    }
  });

  it("the database function takes keys and an id, never an offset", () => {
    const sql = read("../../supabase/migrations/20261006090006_my_work_paging.sql").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/p_offset|offset/i);
    expect(sql).toMatch(/p_after_key\s+timestamptz/);
    expect(sql).toMatch(/p_after_id\s+uuid/);
  });

  it("every ordering ends on the id, in the database statement itself, and the cursor is a ROW-VALUE index condition", () => {
    const sql = read("../../supabase/migrations/20261007090006_job_opportunities_page.sql").replace(/--.*$/gm, "");
    expect(sql).toMatch(/'j\.published_at asc, j\.id asc'/);
    expect(sql).toMatch(/'j\.offered_amount desc, j\.published_at desc, j\.id desc'/);
    expect(sql).toMatch(/'j\.published_at desc, j\.id desc'/);
    // not the OR expansion: a deep page must start where the cursor is, never read and discard what precedes it
    expect(sql).toMatch(/\(j\.published_at, j\.id\) < \(\$18, \$19\)/);
    expect(sql).toMatch(/\(j\.offered_amount, j\.published_at, j\.id\) < \(\$20, \$18, \$19\)/);
    expect(sql).not.toMatch(/published_at < \$18 or/);
  });

  it("the exact total is a SEPARATE call, asked for only on the first page of a question", () => {
    expect(read("server/queries/job-opportunities.ts")).toMatch(/options\.withTotal \? supabase\.rpc\("job_opportunities_total"/);
    expect(read("server/queries/job-board-page.ts")).toMatch(/withTotal: cursor === null/);
  });

  it("only the server mints or reads a cursor: the browser modules never import the codec", () => {
    for (const rel of ["features/home/installer-jobs-board.tsx", "features/home/installer-work-board.tsx", "features/home/use-cursor-pages.ts"]) {
      expect(read(rel), rel).not.toMatch(/pagination\/cursor|decodeJobCursor|encodeJobCursor|decodeWorkCursor|encodeWorkCursor/);
    }
  });
});
