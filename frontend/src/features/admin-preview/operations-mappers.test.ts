import { describe, it, expect } from "vitest";
import { parseDueAt } from "./due-at";
import { mapCases, mapDuplicates, mapFollowUps, mapNotes, mapSuspension, mapTimeline } from "./operations-mappers";
import { mapOperationsError } from "@/server/actions/admin-operations-errors";

describe("operations mappers (fail-closed)", () => {
  it("maps a suspension and rejects a malformed one", () => {
    expect(mapSuspension({ id: "s1", reason: "Fraud", suspended_at: "2026-09-30T10:00:00Z", suspended_by: { user_id: "a1", display_name: "Admin" } }))
      .toEqual({ id: "s1", reason: "Fraud", suspendedAt: "2026-09-30T10:00:00Z", suspendedBy: { userId: "a1", displayName: "Admin" } });
    expect(mapSuspension({ reason: "no id" })).toBeNull();
  });

  it("drops malformed notes", () => {
    const notes = mapNotes([{ id: "n1", body: "Called.", created_at: "2026-09-30T10:00:00Z", author: null }, { id: "n2" }, "x"]);
    expect(notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("keeps only known follow-up types and derived statuses", () => {
    const rows = mapFollowUps([
      { id: "f1", action_type: "call", outcome: "No answer", logged_at: "t", status: "overdue", due_at: "t2", assigned_to: { user_id: "a", display_name: "A" } },
      { id: "f2", action_type: "fax", outcome: "x", logged_at: "t", status: "open" },
      { id: "f3", action_type: "email", outcome: "x", logged_at: "t", status: "someday" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionType: "call", status: "overdue", assignedTo: { userId: "a", displayName: "A" } });
  });

  it("maps cases with optional contact fields", () => {
    expect(mapCases([{ id: "c1", title: "Listing", details: "d", created_at: "t", contact_email: null }])[0]).toMatchObject({
      id: "c1",
      contactEmail: null,
    });
  });

  it("keeps only known timeline kinds and string data", () => {
    const events = mapTimeline([
      { kind: "suspended", at: "t", actor: { user_id: "a", display_name: "A" }, data: { reason: "Fraud", n: 3 } },
      { kind: "hacked", at: "t" },
    ]);
    expect(events).toEqual([{ kind: "suspended", at: "t", actor: { userId: "a", displayName: "A" }, data: { reason: "Fraud" } }]);
  });

  it("maps duplicate candidates and resolutions", () => {
    const d = mapDuplicates({
      candidates: [
        { id: "o2", name: "Cairo Ceramics", org_type: "showroom_dealer", status: "active", signal: "same_name", similarity: 1 },
        { id: "o3", name: "X", signal: "guess" },
      ],
      resolutions: [{ id: "r1", resolution: "linked", role: "duplicate", reason: "same", resolved_at: "t", other: { id: "o9", name: "Main" } }],
    });
    expect(d?.candidates.map((c) => c.id)).toEqual(["o2"]);
    expect(d?.resolutions[0]).toMatchObject({ resolution: "linked", role: "duplicate", other: { id: "o9", name: "Main" } });
    expect(mapDuplicates(null)).toBeNull();
  });
});

describe("parseDueAt", () => {
  it("reads the typed date and time as Egypt time", () => {
    expect(parseDueAt("2026-10-06", "14:30")).toBe("2026-10-06 14:30 Africa/Cairo");
  });
  it("defaults the time to 09:00 and treats no date as no due time", () => {
    expect(parseDueAt("2026-10-06", "")).toBe("2026-10-06 09:00 Africa/Cairo");
    expect(parseDueAt("", "10:00")).toBeNull();
  });
  it("rejects malformed values", () => {
    expect(parseDueAt("06/10/2026", "10:00")).toBe("invalid");
    expect(parseDueAt("2026-10-06", "25:00")).toBe("invalid");
    expect(parseDueAt("2026-10-06", "9:5")).toBe("invalid");
  });
});

describe("mapOperationsError", () => {
  it("maps stable RPC messages to translation keys, never raw text", () => {
    expect(mapOperationsError({ code: "42501", message: "the last active Super Admin cannot be suspended" })).toBe("admin.preview.ops.error.lastSuperAdmin");
    expect(mapOperationsError({ code: "42501", message: "you cannot suspend your own account" })).toBe("admin.preview.ops.error.self");
    expect(mapOperationsError({ code: "42501", message: "you cannot suspend Admin Staff at or above your own rank" })).toBe("admin.preview.ops.error.rank");
    expect(mapOperationsError({ code: "23505", message: "this pair has already been resolved differently" })).toBe("admin.preview.ops.error.alreadyResolved");
    expect(mapOperationsError({ code: "22023", message: "the chosen existing organization is itself linked to another record" })).toBe("admin.preview.ops.error.chain");
    expect(mapOperationsError({ code: "42501", message: "admin permission notes.create required" })).toBe("admin.preview.ops.error.denied");
    expect(mapOperationsError({ code: "XX000", message: "boom" })).toBe("states.genericRetry");
  });
});
