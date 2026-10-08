import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toOpportunityQuery } from "@/lib/installer/job-board-filters";
import { DEFAULT_BOARD_FILTERS } from "@/features/installer-job-opportunities-preview/view-model";

/**
 * THE OVERALL MATCH IS PRESENTATION / RECOMMENDATION ONLY.
 *
 * `app.job_match_rows` (trade 50 + specialty 20 + location 15 + availability 15) decorates a card, a dashboard tile
 * and the job page. It must never decide what is shown, opened or applied for. The database side is proved in pgTAP
 * (`74_overall_match_test.sql`, section G: no policy, view or write path references it; a 0 % job stays discoverable,
 * openable and applicable); this is the application side: a guard on where the match columns and the caller's
 * declared trades are allowed to be read, so a future change cannot quietly turn a recommendation into a gate.
 */

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && name !== "database.types.ts") out.push(full);
  }
  return out;
}

/** Comments describe the rules (and so name the very words they forbid); only CODE is checked. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const files = sourceFiles(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), text: stripComments(readFileSync(f, "utf8")) }));
const using = (needle: string | RegExp) => files.filter((f) => (typeof needle === "string" ? f.text.includes(needle) : needle.test(f.text))).map((f) => f.rel).sort();

describe("the Overall Match is never an authorization input", () => {
  it("Match V1 is gone: no code calls the retired score function or reads the retired column", () => {
    expect(using(/job_match_scores|listJobMatchScores|match_percent|open_job_opportunities_ranked/)).toEqual([]);
  });

  it("the match is read from exactly two database seams: the paged board (a column of every row) and `job_matches` (the job page)", () => {
    expect(using('"job_matches"')).toEqual(["server/queries/job-match.ts"]);
    expect(using('"job_opportunities_page"')).toEqual(["server/queries/job-opportunities.ts"]);
  });

  it("the match columns are only ever mapped onto view models and drawn — never read by a query, action or access path", () => {
    const allowed = new Set([
      "lib/installer/overall-match.ts",
      "server/queries/job-match.ts",
      "features/home/installer-dashboard-data.ts",
      "features/home/installer-jobs-data.ts",
    ]);
    const mentions = files.filter((f) => /overall_percent|trade_points|specialty_points|location_points|availability_points/.test(f.text)).map((f) => f.rel);
    expect(mentions.filter((rel) => !allowed.has(rel))).toEqual([]);
  });

  it("nothing in the query layer (apart from the two seams), the actions, the URL state or the access paths decides anything from a match", () => {
    const guarded = files.filter(
      (f) =>
        /^(server\/queries|server\/actions|lib\/installer|lib\/work|lib\/workspace)\//.test(f.rel) &&
        !["server/queries/job-match.ts", "lib/installer/overall-match.ts"].includes(f.rel),
    );
    expect(guarded.filter((f) => /matchPercent|MatchBreakdown|overallPercent|matchLevel/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("the board's query never filters or orders by the Overall Match: its only skill ordering is the database's own `best` tier (trade + specialty)", () => {
    const q = files.find((f) => f.rel === "server/queries/job-opportunities.ts")!.text;
    expect(q).not.toMatch(/overall_percent|\.order\(\s*["'`](match|overall|proximity_tier|offered_amount|published_at)|\.eq\(\s*["'`]match/);
    // `best` is a dashboard-only mode and carries no location or availability.
    expect(q).toMatch(/DashboardOpportunityMode = "best" \| "nearest" \| "newest" \| "oldest"/);
  });

  it("the caller's declared trades are never read to decide what the board shows (O5)", () => {
    // Profile editing legitimately writes `user_trades`; the BOARD, DETAIL and APPLY paths must not read it.
    const paths = [
      "app/home/jobs/page.tsx",
      "app/home/jobs/[jobId]/page.tsx",
      "server/queries/job-opportunities.ts",
      "server/queries/job-match.ts",
      "server/queries/saved-jobs.ts",
      "server/actions/jobs.ts",
      "features/home/installer-jobs-board.tsx",
      "features/home/installer-jobs-data.ts",
      "features/jobs/opportunity-detail.tsx",
    ];
    expect(using(/from\(\s*["']user_trades["']\s*\)/).filter((rel) => paths.includes(rel))).toEqual([]);
    const queries = files.find((f) => f.rel === "server/queries/job-opportunities.ts")!.text;
    expect(queries).not.toMatch(/individual_onboarding|prof_governorate|user_trades|user_service_areas|user_availability/);
  });

  it("with the default board state the query carries NO trade, location or score restriction", () => {
    const q = toOpportunityQuery(DEFAULT_BOARD_FILTERS, "newest");
    expect(q.tradeKeys).toBeUndefined();
    expect(q.governorateKey).toBeUndefined();
    expect(q.cityKey).toBeUndefined();
    expect(Object.keys(q).filter((k) => /score|match|trade/i.test(k) && q[k as keyof typeof q] !== undefined)).toEqual([]);
  });

  it("the apply action and the board loader never consult the match", () => {
    for (const rel of ["server/actions/jobs.ts", "server/actions/application-forms.ts", "server/queries/job-board-page.ts", "app/home/jobs/page.tsx"]) {
      const f = files.find((x) => x.rel === rel);
      expect(f, rel).toBeTruthy();
      expect(f!.text, rel).not.toMatch(/overall_percent|matchPercent|job_matches|getJobMatch/);
    }
  });

  it("the job page reads the match for DISPLAY only, beside — never inside — the facts that decide Apply", () => {
    const page = files.find((f) => f.rel === "app/home/jobs/[jobId]/page.tsx")!.text;
    expect(page).toMatch(/getJobMatch\(/);
    // `canApply` comes from the account type alone; the match is passed as its own prop.
    expect(page).toMatch(/canApply=\{home\.variant === "professional"\}/);
    expect(page).toMatch(/match=\{match\}/);
    const detail = files.find((f) => f.rel === "features/jobs/opportunity-detail.tsx")!.text;
    expect(detail).not.toMatch(/canApply[^\n]*match|match[^\n]*canApply|overallPercent[^\n]*(apply|disabled)/i);
  });
});
