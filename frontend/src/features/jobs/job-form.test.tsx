import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

type State = { ok: boolean; code?: string; fieldErrors?: Record<string, string> };
const sent: FormData[] = [];

vi.mock("@/server/actions/job-forms", () => ({
  createJobAction: async (_p: State, fd: FormData): Promise<State> => {
    sent.push(fd);
    return { ok: true };
  },
  updateJobAction: async (_p: State, fd: FormData): Promise<State> => {
    sent.push(fd);
    return { ok: true };
  },
}));

import { JobForm } from "./job-form";
import type { JobListRow } from "@/server/queries/jobs";

const trades = [
  { id: "t1", key: "kitchens_doors" },
  { id: "t2", key: "plumbing" },
  { id: "t3", key: "marble_granite" },
];

/** The catalog as it looks after `marble_granite` is retired: without it. */
const tradesWithoutMarble = trades.filter((t) => t.key !== "marble_granite");

const options = (c: HTMLElement) =>
  [...c.querySelectorAll("#tradeKey option")].map((o) => (o as HTMLOptionElement).value);

const job = (over: Partial<JobListRow> = {}): JobListRow =>
  ({
    id: "j1",
    poster_org_id: "o1",
    poster_branch_id: null,
    title: "Marble staircase cladding",
    description: "Ground to first floor.",
    trade_id: "t3",
    offered_amount: 8500,
    offered_currency: "EGP",
    governorate: "Cairo",
    city: "New Cairo",
    site_address: "12 Street 90",
    expected_duration_days: 10,
    starts_on: null,
    ends_by: null,
    status: "draft",
    version: 1,
    published_at: null,
    closed_at: null,
    created_by: "u1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    tradeKey: "marble_granite",
    tradeRetired: false,
    applicationCount: 0,
    ...over,
  }) as JobListRow;

beforeEach(() => {
  sent.length = 0;
});

describe("JobForm and a retired trade", () => {
  /**
   * THE DISTINCTION `job_update` now draws, on screen. Retirement stops a trade
   * being CHOSEN; it does not freeze the job that already holds one. Without the
   * option, the select has nothing matching its own value, submits blank, and
   * the whole edit is refused over a field the poster never touched.
   */
  it("keeps the job's own retired trade selectable so an unrelated edit can be saved", () => {
    const { container } = renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={tradesWithoutMarble}
        job={job({ tradeRetired: true })}
      />,
      "en",
    );
    expect(options(container)).toContain("marble_granite");
    expect((container.querySelector("#tradeKey") as HTMLSelectElement).value).toBe(
      "marble_granite",
    );
  });

  it("marks it as history rather than presenting it as a current choice", () => {
    renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={tradesWithoutMarble}
        job={job({ tradeRetired: true })}
      />,
      "en",
    );
    expect(screen.getByRole("option", { name: /Marble & granite.*no longer offered/i })).toBeTruthy();
  });

  /**
   * THE NON-WIDENING, in the component. The extra option comes from THIS job's
   * own value, never from a looser catalog — so posting a new job still cannot
   * reach a retired trade, and neither can editing a job that holds a current one.
   */
  it("offers no retired trade when creating", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={tradesWithoutMarble} />,
      "en",
    );
    expect(options(container)).toEqual(["", "kitchens_doors", "plumbing"]);
  });

  it("adds nothing when the job's own trade is still current", () => {
    const { container } = renderWithI18n(
      <JobForm mode="edit" orgId="o1" trades={trades} job={job()} />,
      "en",
    );
    expect(options(container)).toEqual(["", "kitchens_doors", "plumbing", "marble_granite"]);
  });

  /**
   * Frozen by applications AND retired at once: the select is disabled, so the
   * value travels in the hidden input — and the option still has to exist or the
   * disabled control renders blank where the trade should be.
   */
  it("still shows the trade on a job that is both frozen and retired", () => {
    const { container } = renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={tradesWithoutMarble}
        job={job({ tradeRetired: true })}
        applicationCount={2}
      />,
      "en",
    );
    const select = container.querySelector("#tradeKey") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("marble_granite");
    expect(
      container.querySelector('input[type="hidden"][name="tradeKey"]')?.getAttribute("value"),
    ).toBe("marble_granite");
  });
});

describe("JobForm", () => {
  it("offers the canonical trades from the database, translated", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={trades} />,
      "en",
    );
    const options = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("Kitchens & doors");
    expect(options).toContain("Marble & granite");
  });

  /**
   * The VALUE is the trade key, never the uuid. Ids differ per environment and
   * mean nothing to a reader; the key is also what `job_create` takes.
   */
  it("submits trade KEYS and never a database id", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={trades} />,
      "en",
    );
    const values = Array.from(container.querySelectorAll("option"))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values).toEqual(["kitchens_doors", "plumbing", "marble_granite"]);
    expect(container.textContent).not.toMatch(/\bt1\b|\bt2\b/);
  });

  it("shows no raw trade key to the reader", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={trades} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|kitchens_doors/);
    expect(container.textContent).not.toMatch(/onboarding\.|jobs\./);
  });

  /**
   * EGP is a database constraint, so offering a choice would be offering a
   * refusal. The currency is shown, and there is no control to change it.
   */
  it("pins the currency to EGP with no way to choose another", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={trades} />,
      "en",
    );
    expect(container.textContent).toContain("EGP");
    expect(container.querySelector('[name="offeredCurrency"]')).toBeNull();
    expect(container.querySelector('select[name*="urrency"]')).toBeNull();
  });

  it("carries the org id on create and the version on edit", () => {
    const create = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(create.container.querySelector('input[name="orgId"]')).toBeTruthy();
    expect(create.container.querySelector('input[name="expectedVersion"]')).toBeNull();
    create.unmount();

    const edit = renderWithI18n(
      <JobForm mode="edit" orgId="o1" trades={trades} job={job({ version: 7 })} />,
      "en",
    );
    const v = edit.container.querySelector<HTMLInputElement>('input[name="expectedVersion"]');
    expect(v?.value).toBe("7");
  });

  it("prefills every content field when editing", () => {
    const { container } = renderWithI18n(
      <JobForm mode="edit" orgId="o1" trades={trades} job={job()} />,
      "en",
    );
    expect(container.querySelector<HTMLInputElement>("#title")?.value).toBe(
      "Marble staircase cladding",
    );
    expect(container.querySelector<HTMLInputElement>("#offeredAmount")?.value).toBe("8500");
    expect(container.querySelector<HTMLInputElement>("#siteAddress")?.value).toBe("12 Street 90");
    expect(container.querySelector<HTMLSelectElement>("#tradeKey")?.value).toBe("marble_granite");
  });

  /**
   * O7 on screen. Not authority — `job_update` and the immutability trigger
   * refuse the change regardless — but a form that invites an edit the database
   * will reject is a worse experience than one that does not offer it.
   */
  it("freezes the trade and the amount once someone has applied", () => {
    const { container } = renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={trades}
        job={job({ status: "open" })}
        applicationCount={3}
      />,
      "en",
    );
    expect(container.querySelector<HTMLSelectElement>("#tradeKey")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#offeredAmount")?.disabled).toBe(true);
    expect(screen.getByText(/cannot change/i)).toBeTruthy();
  });

  /**
   * A disabled control submits nothing, so both values still have to reach the
   * server — otherwise an unrelated edit would arrive with an empty trade and be
   * refused for the wrong reason.
   */
  it("still submits the frozen values so an unrelated edit can save", () => {
    const { container } = renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={trades}
        job={job({ status: "open" })}
        applicationCount={1}
      />,
      "en",
    );
    const hidden = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.find((i) => i.name === "tradeKey")?.value).toBe("marble_granite");
    expect(hidden.find((i) => i.name === "offeredAmount")?.value).toBe("8500");
  });

  it("leaves both editable while no one has applied", () => {
    const { container } = renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={trades}
        job={job({ status: "open" })}
        applicationCount={0}
      />,
      "en",
    );
    expect(container.querySelector<HTMLSelectElement>("#tradeKey")?.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>("#offeredAmount")?.disabled).toBe(false);
  });

  /** No payment vocabulary anywhere near the amount (§5.2/§5.4). */
  it("never calls the amount paid, earned, due or a balance", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={trades} />,
      "en",
    );
    expect(container.textContent).not.toMatch(
      /\b(paid|earned|payout|escrow|wallet|invoice|balance|commission)\b/i,
    );
  });

  it("tells the poster who will see the site address", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(screen.getByText(/only the professional you award/i)).toBeTruthy();
  });
});
