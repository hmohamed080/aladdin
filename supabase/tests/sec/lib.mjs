// Phone-signup security regression harness (tests-first). LOCAL ISOLATED STACK ONLY.
//
// Reuses the A2 guards (loopback API, explicit non-shared DB_CONTAINER, masking) and adds the one thing a tests-first
// suite needs: a result vocabulary that separates "behaviour we want and have" from "behaviour we want and do NOT yet have".
//
//   PASS   desired behaviour holds today (a regression guard).
//   FAIL   desired behaviour is broken in a way nobody expected (suite exits non-zero).
//   XFAIL  desired behaviour is NOT met today: a CONFIRMED vulnerability or an unimplemented required behaviour. Expected,
//          recorded with evidence, never counted as passing. When remediation lands, the check flips to XPASS and the
//          suite exits non-zero until the check is promoted to a plain `check` (so a fix cannot go unnoticed or regress).
//   EVAL   an observation used to choose between designs (no verdict by itself).
//   N/A    the scenario does not apply in this GoTrue mode (e.g. "session without confirmation" when confirmations are on).
import { target, makeDb, makeHttp, phoneFactory, runTag, shortId, mask } from "../a2/lib.mjs";

export { target, makeDb, makeHttp, phoneFactory, runTag, shortId, mask };

export function makeRecorder(suite, meta = {}) {
  const results = [];
  const tags = { PASS: "ok   ", FAIL: "FAIL ", XFAIL: "XFAIL", XPASS: "XPASS", EVAL: "EVAL ", "N/A": "n/a  " };
  const add = (id, area, title, status, evidence = "") => {
    const row = { id, area, title, status, evidence: mask(evidence) };
    results.push(row);
    console.log(`${tags[status]} ${id} ${title}${status === "PASS" ? "" : ` -- ${row.evidence}`}`);
    return status;
  };
  return {
    results,
    meta,
    check: (id, area, title, ok, evidence = "") => add(id, area, title, ok ? "PASS" : "FAIL", ok ? evidence : `expected true; ${evidence}`) === "PASS",
    // `ok` = the DESIRED behaviour holds right now.
    expectFail: (id, area, title, ok, evidence = "") => add(id, area, title, ok ? "XPASS" : "XFAIL", evidence),
    evaluation: (id, area, title, evidence) => add(id, area, title, "EVAL", evidence),
    na: (id, area, title, why) => add(id, area, title, "N/A", why),
    summary() {
      const c = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0, EVAL: 0, "N/A": 0 };
      for (const r of results) c[r.status] += 1;
      return { suite, ...meta, ...c, total: results.length };
    },
  };
}
