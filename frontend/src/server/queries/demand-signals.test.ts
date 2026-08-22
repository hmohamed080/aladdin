import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { demandSignals } from "./commerce";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Rfq = {
  id: string;
  title: string;
  status: string;
  requester_name: string;
  required_date: string | null;
  /** Days ago. Turned into an ISO timestamp by the fake, so tests read in windows. */
  ago: number;
};
type Item = { rfq_id: string; product_name: string; quantity: number; unit: string };

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

/**
 * Chainable stand-in for the Supabase builder.
 *
 * `rfq_list` yields the org's requests already ordered newest-first (the real
 * query asks the database for that order, so the fake must honour it or the
 * `open` cap would be tested against an order production never produces).
 * `rfq_items` yields only the lines whose `rfq_id` is in the batch it was asked
 * for, which also proves the batching drops and doubles nothing.
 */
function makeClient(rfqs: Rfq[], items: Item[]) {
  const build = (table: string) => {
    let inList: string[] | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      in(_col: string, vals: string[]) {
        inList = vals;
        return b;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        const data =
          table === "rfq_list"
            ? [...rfqs]
                .sort((x, y) => x.ago - y.ago)
                .map((r) => ({
                  id: r.id,
                  title: r.title,
                  status: r.status,
                  requester_name: r.requester_name,
                  required_date: r.required_date,
                  created_at: iso(r.ago),
                }))
            : items.filter((i) => !inList || inList.includes(i.rfq_id));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => build(t) } as any;
}

const rfq = (id: string, ago: number, status = "submitted"): Rfq => ({
  id,
  title: `Request ${id}`,
  status,
  requester_name: `Buyer ${id}`,
  required_date: null,
  ago,
});
const item = (rfqId: string, product: string, quantity = 10): Item => ({
  rfq_id: rfqId,
  product_name: product,
  quantity,
  unit: "square_meter",
});

describe("demandSignals — movement counts DISTINCT requests per product", () => {
  it("counts a request once even when it itemises the same product twice", async () => {
    // One business asked once, on a request that names SPC on two lines (two
    // finishes). Counting lines would tell the seller demand doubled.
    const client = makeClient(
      [rfq("a", 3), rfq("b", 5)],
      [item("a", "SPC"), item("a", "SPC"), item("b", "SPC")],
    );

    const { movement } = await demandSignals(client, ORG, 30);

    expect(movement).toHaveLength(1);
    expect(movement[0]).toMatchObject({ name: "SPC", requests: 2, previous: 0 });
  });

  it("splits the window from the one before it, and drops anything older", async () => {
    const client = makeClient(
      [
        rfq("now1", 2), // inside the 30-day window
        rfq("now2", 20), // inside
        rfq("prev1", 40), // previous window (30–60 days)
        rfq("prev2", 55), // previous window
        rfq("old", 200), // older than both — counted nowhere
      ],
      [
        item("now1", "HPL"),
        item("now2", "HPL"),
        item("prev1", "HPL"),
        item("prev2", "HPL"),
        item("old", "HPL"),
      ],
    );

    const { movement, windowRequests } = await demandSignals(client, ORG, 30);

    expect(movement[0]).toMatchObject({ name: "HPL", requests: 2, previous: 2 });
    // The window's own denominator counts requests, not lines.
    expect(windowRequests).toBe(2);
  });

  it("ranks by request count, busiest first", async () => {
    const client = makeClient(
      [rfq("a", 1), rfq("b", 2), rfq("c", 3)],
      [
        item("a", "SPC"),
        item("b", "SPC"),
        item("c", "SPC"),
        item("a", "WPC"),
        item("b", "WPC"),
        item("c", "Marble"),
      ],
    );

    const { movement } = await demandSignals(client, ORG, 30);

    expect(movement.map((r) => [r.name, r.requests])).toEqual([
      ["SPC", 3],
      ["WPC", 2],
      ["Marble", 1],
    ]);
  });
});

describe("demandSignals — the opportunities list reads only UNPRICED requests", () => {
  it("ignores requests that are no longer awaiting a price", async () => {
    const client = makeClient(
      [rfq("open", 1, "submitted"), rfq("done", 2, "quoted"), rfq("shut", 3, "closed")],
      [item("open", "SPC"), item("done", "WPC"), item("shut", "HPL")],
    );

    const { open, openRequests } = await demandSignals(client, ORG, 30);

    expect(openRequests).toBe(1);
    expect(open.map((l) => l.productName)).toEqual(["SPC"]);
  });

  it("reports the request's OTHER lines as siblings, so a card can say '+2 more'", async () => {
    const client = makeClient(
      [rfq("a", 1)],
      [item("a", "SPC"), item("a", "WPC"), item("a", "HPL")],
    );

    const { open } = await demandSignals(client, ORG, 30);

    expect(open).toHaveLength(3);
    // Three lines on one request: each names the two beside it, never itself.
    expect(open.every((l) => l.siblings === 2)).toBe(true);
  });

  it("honours the line cap without splitting a request's identity", async () => {
    const client = makeClient(
      [rfq("a", 1), rfq("b", 2)],
      [item("a", "SPC"), item("a", "WPC"), item("b", "HPL"), item("b", "Marble")],
    );

    const { open, openRequests } = await demandSignals(client, ORG, 30, 3);

    expect(open).toHaveLength(3);
    // The cap limits what is DISPLAYED; it must not change the count of requests
    // actually waiting, which the panel reports separately.
    expect(openRequests).toBe(2);
  });

  it("returns empty structures rather than throwing when nothing has ever arrived", async () => {
    const { open, openRequests, movement, windowRequests } = await demandSignals(
      makeClient([], []),
      ORG,
      30,
    );

    expect(open).toEqual([]);
    expect(movement).toEqual([]);
    expect(openRequests).toBe(0);
    expect(windowRequests).toBe(0);
  });
});
