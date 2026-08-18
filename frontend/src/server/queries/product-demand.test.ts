import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { productDemand } from "./commerce";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RFQ_A = "11111111-1111-4111-8111-111111111111";
const RFQ_B = "22222222-2222-4222-8222-222222222222";
const PRODUCT_X = "33333333-3333-4333-8333-333333333333";
const PRODUCT_Y = "44444444-4444-4444-8444-444444444444";

type Item = { rfq_id: string | null; product_id: string | null };

/**
 * Chainable stand-in for the Supabase builder. `rfq_list` yields the org's RFQ
 * ids; `rfq_items` yields only the lines whose rfq_id is in the batch it was
 * asked for, so the fake also proves the batching drops and doubles nothing.
 */
function makeClient(rfqIds: string[], items: Item[]) {
  const batchSizes: number[] = [];
  const build = (table: string) => {
    let inList: string[] | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in(_col: string, vals: string[]) {
        inList = vals;
        batchSizes.push(vals.length);
        return b;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        const data =
          table === "rfq_list"
            ? rfqIds.map((id) => ({ id }))
            : items.filter((i) => !inList || (i.rfq_id !== null && inList.includes(i.rfq_id)));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from: (t: string) => build(t) } as any, batchSizes };
}

describe("productDemand counts DISTINCT RFQs, not line items", () => {
  it("counts one RFQ once even when it lists the same product on several lines", async () => {
    // RFQ A asks for X twice (two finishes); RFQ B asks for X once.
    const { client } = makeClient(
      [RFQ_A, RFQ_B],
      [
        { rfq_id: RFQ_A, product_id: PRODUCT_X },
        { rfq_id: RFQ_A, product_id: PRODUCT_X },
        { rfq_id: RFQ_B, product_id: PRODUCT_X },
      ],
    );

    const demand = await productDemand(client, ORG);

    // Two businesses asked. Not 3 (one per line), not 5 (a double increment).
    expect(demand.get(PRODUCT_X)?.requests).toBe(2);
  });

  it("keeps products independent and ignores free-text lines with no product", async () => {
    const { client } = makeClient(
      [RFQ_A, RFQ_B],
      [
        { rfq_id: RFQ_A, product_id: PRODUCT_X },
        { rfq_id: RFQ_A, product_id: PRODUCT_Y },
        { rfq_id: RFQ_A, product_id: PRODUCT_Y },
        { rfq_id: RFQ_B, product_id: null },
      ],
    );

    const demand = await productDemand(client, ORG);

    expect(demand.get(PRODUCT_X)?.requests).toBe(1);
    expect(demand.get(PRODUCT_Y)?.requests).toBe(1);
    expect(demand.size).toBe(2);
  });

  it("reports no demand rather than a zero row when the org has no RFQs", async () => {
    const { client } = makeClient([], []);
    expect((await productDemand(client, ORG)).size).toBe(0);
  });

  it("splits a long id list into URL-safe batches without changing the count", async () => {
    // 250 RFQs, every one asking for X twice: still 250 distinct requests.
    const ids = Array.from({ length: 250 }, (_, i) => `rfq-${i}`);
    const items = ids.flatMap((id) => [
      { rfq_id: id, product_id: PRODUCT_X },
      { rfq_id: id, product_id: PRODUCT_X },
    ]);
    const { client, batchSizes } = makeClient(ids, items);

    const demand = await productDemand(client, ORG);

    expect(demand.get(PRODUCT_X)?.requests).toBe(250);
    expect(batchSizes).toEqual([100, 100, 50]);
  });
});
