import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { createTranslator } from "@/lib/i18n/translate";
import { loadPointsPage } from "./points-page";
import { POINTS_HISTORY_LIMIT, POINTS_HISTORY_MAX } from "@/server/queries/points";

/**
 * The loader BOTH Points surfaces share.
 *
 * It exists so `/b2b/points` and `/home/points` cannot disagree about what the
 * ledger says. What is asserted here is therefore the part that must be identical
 * on both: which reads happen, the all-or-nothing failure contract, and the "more"
 * rule — plus the one thing that legitimately differs, the base path the
 * pagination link returns to.
 */
const t = createTranslator("en");

type Row = Record<string, unknown>;
const state: { balance: number; rows: Row[]; throwOn: string | null } = {
  balance: 0,
  rows: [],
  throwOn: null,
};
const asked = { rpc: [] as string[], from: [] as string[], limit: [] as number[] };

function client() {
  const builder: Record<string, unknown> = {
    rpc(name: string) {
      asked.rpc.push(name);
      if (state.throwOn === "balance") return Promise.reject(new Error("balance failed"));
      return Promise.resolve({ data: state.balance, error: null });
    },
    from(table: string) {
      asked.from.push(table);
      return builder;
    },
    select: () => builder,
    order: () => builder,
    in: () => builder,
    eq: () => builder,
    limit(n: number) {
      asked.limit.push(n);
      return builder;
    },
    // A thenable rejects by THROWING from `then` (or calling the reject arm) —
    // returning a rejected promise from it is never observed, and the await
    // simply hangs.
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (state.throwOn === "entries") throw new Error("entries failed");
      return Promise.resolve({ data: state.rows, error: null }).then(resolve);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return builder as any;
}

const row = (i: number): Row => ({
  id: `e${i}`,
  user_id: "u1",
  event_type: "referral.organization_approved",
  points_delta: 100,
  reverses_entry_id: null,
  reason_code: null,
  organization_id: null,
  source_type: null,
  source_id: null,
  created_at: "2026-08-30T10:00:00Z",
});

beforeEach(() => {
  state.balance = 0;
  state.rows = [];
  state.throwOn = null;
  asked.rpc.length = 0;
  asked.from.length = 0;
  asked.limit.length = 0;
});

describe("loadPointsPage", () => {
  it("reads the balance and the history, and no user id anywhere", async () => {
    state.balance = 100;
    state.rows = [row(1)];

    const data = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    });

    expect(data.ok).toBe(true);
    // `points_balance()` is called with no argument, so it defaults to auth.uid().
    expect(asked.rpc).toEqual(["points_balance"]);
    expect(asked.from).toContain("points_ledger");
  });

  it("reports a ZERO balance as a real answer, not as an absence", async () => {
    state.balance = 0;
    const data = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    });
    expect(data).toMatchObject({ ok: true, balance: 0 });
  });

  it("passes a NEGATIVE balance through unclamped (D2)", async () => {
    // A corrected balance displays negative. Clamping or flooring it here would
    // reintroduce, at the read layer, exactly the mutable-balance failure the
    // append-only ledger was shaped to avoid.
    state.balance = -40;
    const data = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    });
    expect(data).toMatchObject({ ok: true, balance: -40 });
  });

  it("never sums the balance from the fetched rows", async () => {
    // The history is capped, so a client-side total would silently disagree with
    // the ledger for anyone with more entries than the cap.
    state.balance = 500;
    state.rows = [row(1), row(2)]; // would sum to 200
    const data = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    });
    expect(data).toMatchObject({ balance: 500 });
  });

  it("offers no MORE link when the page is not full", async () => {
    state.rows = [row(1)];
    const data = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    });
    expect(data).toMatchObject({ moreHref: null });
  });

  it("offers MORE on the surface it was rendered from, never the other one", async () => {
    state.rows = Array.from({ length: POINTS_HISTORY_LIMIT }, (_, i) => row(i));

    const personal = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    });
    expect(personal).toMatchObject({ moreHref: `/home/points?show=${POINTS_HISTORY_LIMIT * 2}` });

    const workspace = await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/b2b/points",
    });
    expect(workspace).toMatchObject({ moreHref: `/b2b/points?show=${POINTS_HISTORY_LIMIT * 2}` });
  });

  it("stops offering MORE at the cap rather than linking to the same rows", async () => {
    state.rows = Array.from({ length: POINTS_HISTORY_MAX }, (_, i) => row(i));
    const data = await loadPointsPage(client(), {
      show: String(POINTS_HISTORY_MAX),
      locale: "en",
      t,
      basePath: "/home/points",
    });
    expect(data).toMatchObject({ moreHref: null });
  });

  it("fails as a WHOLE when the balance read fails", async () => {
    // A confident balance above a silently empty history would be a page that
    // lies about the ledger, so neither half is rendered without the other.
    state.throwOn = "balance";
    expect(await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    })).toEqual({ ok: false });
  });

  it("fails as a WHOLE when the history read fails", async () => {
    state.throwOn = "entries";
    expect(await loadPointsPage(client(), {
      show: undefined,
      locale: "en",
      t,
      basePath: "/home/points",
    })).toEqual({ ok: false });
  });
});
