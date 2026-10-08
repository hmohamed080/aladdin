import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
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

/** The trade control is the shared listbox: open it and read what it offers (labels), or read the value it submits. */
const tradeOptions = () => {
  fireEvent.click(document.querySelector("#tradeKey")!);
  const labels = within(screen.getByRole("listbox", { name: "Trade" })).getAllByRole("option").map((o) => o.textContent);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  return labels;
};
const submitted = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;
const choose = (control: string, label: string) => {
  fireEvent.click(document.querySelector(control)!);
  fireEvent.click(screen.getByRole("option", { name: label }));
};

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
    governorate_key: "cairo",
    city_key: "new-cairo",
    required_specialty_id: null,
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
    expect(tradeOptions().some((label) => /Marble & granite/.test(label ?? ""))).toBe(true);
    expect(submitted(container, "tradeKey")).toBe("marble_granite");
    expect(document.querySelector("#tradeKey")!.textContent).toMatch(/Marble & granite/);
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
    fireEvent.click(document.querySelector("#tradeKey")!);
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
    expect(tradeOptions()).toEqual(["Kitchens & doors", "Plumbing"]);
    expect(submitted(container, "tradeKey")).toBe("");
  });

  it("adds nothing when the job's own trade is still current", () => {
    const { container } = renderWithI18n(
      <JobForm mode="edit" orgId="o1" trades={trades} job={job()} />,
      "en",
    );
    expect(tradeOptions()).toEqual(["Kitchens & doors", "Plumbing", "Marble & granite"]);
    expect(submitted(container, "tradeKey")).toBe("marble_granite");
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
    const select = container.querySelector("#tradeKey") as HTMLButtonElement;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toMatch(/Marble & granite/);
    expect(submitted(container, "tradeKey")).toBe("marble_granite");
  });
});

describe("JobForm", () => {
  it("offers the canonical trades from the database, translated", () => {
    const { container } = renderWithI18n(
      <JobForm mode="create" orgId="o1" trades={trades} />,
      "en",
    );
    void container;
    const options = tradeOptions();
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
    choose("#tradeKey", "Plumbing");
    expect(submitted(container, "tradeKey")).toBe("plumbing");
    choose("#tradeKey", "Marble & granite");
    expect(submitted(container, "tradeKey")).toBe("marble_granite");
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
    expect(container.querySelector('button[name*="urrency"]')).toBeNull();
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
    expect(submitted(container, "tradeKey")).toBe("marble_granite");
    // the place is the job's own canonical keys
    expect(submitted(container, "governorateKey")).toBe("cairo");
    expect(submitted(container, "cityKey")).toBe("new-cairo");
    expect(container.querySelector("#governorateKey")!.textContent).toBe("Cairo");
    expect(container.querySelector("#cityKey")!.textContent).toBe("New Cairo");
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
    expect(container.querySelector<HTMLButtonElement>("#tradeKey")?.disabled).toBe(true);
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
    expect(container.querySelector<HTMLButtonElement>("#tradeKey")?.disabled).toBe(false);
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

describe("JobForm — work contact section", () => {
  it("is an optional, clearly labelled section (English)", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(screen.getByText("Work contact")).toBeTruthy();
    expect(screen.getByLabelText("Contact name")).toBeTruthy();
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
    expect(screen.getByText(/not taken from anyone's personal profile/i)).toBeTruthy();
  });

  it("and in Arabic, with the requested labels", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "ar");
    expect(screen.getByText("بيانات التواصل الخاصة بالعمل")).toBeTruthy();
    expect(screen.getByLabelText("اسم جهة التواصل")).toBeTruthy();
    expect(screen.getByLabelText("رقم الهاتف")).toBeTruthy();
    expect(screen.getByLabelText("البريد الإلكتروني")).toBeTruthy();
  });

  it("uses the shared phone picker, Egypt first", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(screen.getByRole("button", { name: /country/i })).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("starts empty when creating, and submits canonical values as hidden fields", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect((container.querySelector("#contactName") as HTMLInputElement).value).toBe("");
    expect((container.querySelector("input[name=contactPhone]") as HTMLInputElement).value).toBe("");
    fireEvent.change(container.querySelector("#contactPhone-national")!, { target: { value: "01001112222" } });
    expect((container.querySelector("input[name=contactPhone]") as HTMLInputElement).value).toBe("+201001112222");
    expect(container.querySelector("input[name=contactPhoneInvalid]")).toBeNull();
  });

  it("flags digits that are not a valid number so the server refuses instead of dropping them", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    fireEvent.change(container.querySelector("#contactPhone-national")!, { target: { value: "123" } });
    expect((container.querySelector("input[name=contactPhone]") as HTMLInputElement).value).toBe("");
    expect((container.querySelector("input[name=contactPhoneInvalid]") as HTMLInputElement).value).toBe("1");
  });

  it("editing a job prefills its existing work contact", () => {
    const { container } = renderWithI18n(
      <JobForm
        mode="edit"
        orgId="o1"
        trades={trades}
        job={job()}
        contact={{ name: "Site coordinator", phoneE164: "+201001112222", email: "work@horizon.example.test" }}
      />,
      "en",
    );
    expect((container.querySelector("#contactName") as HTMLInputElement).value).toBe("Site coordinator");
    expect((container.querySelector("#contactEmail") as HTMLInputElement).value).toBe("work@horizon.example.test");
    expect((container.querySelector("#contactPhone-national") as HTMLInputElement).value).toBe("1001112222");
    expect((container.querySelector("input[name=contactPhone]") as HTMLInputElement).value).toBe("+201001112222");
  });

  it("shows the server's field errors beside the contact fields", async () => {
    // The mocked action returns ok; field errors arrive via state, so render the error path directly.
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} initialError="jobs.errors.contactNotSaved" />, "en");
    expect(screen.getByText(/work contact could not be/i)).toBeTruthy();
  });

  it("does not use any profile data: the form has no profile prop and no profile-sourced default", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(container.querySelectorAll("input[name^=contact]").length).toBeGreaterThanOrEqual(3);
    expect((container.querySelector("#contactEmail") as HTMLInputElement).value).toBe("");
  });

  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: the work-contact phone takes the full row — a narrow country picker and a wide number input`, () => {
      const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, locale);
      const number = container.querySelector("#contactPhone-national") as HTMLInputElement;
      expect(number.className).toContain("flex-1");
      expect(number.className).toContain("min-w-0");
      const picker = screen.getByRole("button", { name: locale === "en" ? /country/i : /الدولة/ });
      expect(picker.parentElement!.className).toContain("w-[7rem]");
      expect(picker.className).not.toContain("w-[9.5rem]");
      expect(number.closest("[class*=\"col-span-2\"]")).toBeTruthy();
      expect(number.getAttribute("dir")).toBe("ltr"); // digits stay left-to-right inside an RTL form
    });

    it(`${locale}: the edit form uses the same compact phone layout`, () => {
      const { container } = renderWithI18n(
        <JobForm mode="edit" orgId="o1" trades={trades} job={job()} contact={{ name: "Site", phoneE164: "+201001112222", email: null }} />,
        locale,
      );
      expect(container.querySelector("#contactPhone-national")!.className).toContain("min-w-0");
      expect(container.querySelector("div[class*='w-[7rem]'] button[aria-haspopup='listbox']")).toBeTruthy();
    });
  }
});

describe("JobForm — the place is chosen from the catalogue", () => {
  it("offers a governorate list and a city list, and no free-text place input", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(container.querySelector("input#governorate")).toBeNull();
    expect(container.querySelector("input#city")).toBeNull();
    expect(screen.getByRole("button", { name: "Governorate" })).toHaveAttribute("aria-haspopup", "listbox");
    expect(screen.getByRole("button", { name: "City" })).toBeDisabled(); // a city belongs to a governorate
  });

  it("the city list follows the governorate and submits the KEYS", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    choose("#governorateKey", "Giza");
    expect(screen.getByRole("button", { name: "City" })).not.toBeDisabled();
    fireEvent.click(document.querySelector("#cityKey")!);
    const cities = within(screen.getByRole("listbox", { name: "City" })).getAllByRole("option").map((o) => o.textContent);
    expect(cities).toContain("Dokki");
    expect(cities).not.toContain("Maadi"); // that is a Cairo city
    fireEvent.click(screen.getByRole("option", { name: "Dokki" }));
    expect(submitted(container, "governorateKey")).toBe("giza");
    expect(submitted(container, "cityKey")).toBe("dokki");
  });

  it("changing the governorate clears the city (a city of the old governorate must not travel with the new one)", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    choose("#governorateKey", "Cairo");
    choose("#cityKey", "Maadi");
    expect(submitted(container, "cityKey")).toBe("maadi");
    choose("#governorateKey", "Giza");
    expect(submitted(container, "cityKey")).toBe("");
  });

  it("reads in Arabic from the same catalogue", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "ar");
    fireEvent.click(document.querySelector("#governorateKey")!);
    const names = within(screen.getByRole("listbox", { name: "المحافظة" })).getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("القاهرة");
    expect(names).toContain("الجيزة");
  });

  it("a legacy job whose old text never resolved shows what it says and may keep it by choosing nothing", () => {
    const { container } = renderWithI18n(
      <JobForm mode="edit" orgId="o1" trades={trades} job={job({ governorate: "Atlantis", city: "Nowhere", governorate_key: null, city_key: null })} />,
      "en",
    );
    expect(screen.getByText(/entered before places were standardised: Nowhere, Atlantis/)).toBeTruthy();
    expect(submitted(container, "keepLegacyLocation")).toBe("1");
    choose("#governorateKey", "Cairo");
    expect(container.querySelector('input[name="keepLegacyLocation"]')).toBeNull(); // a new choice replaces it
  });

  it("a job with canonical keys carries no legacy flag", () => {
    const { container } = renderWithI18n(<JobForm mode="edit" orgId="o1" trades={trades} job={job()} />, "en");
    expect(container.querySelector('input[name="keepLegacyLocation"]')).toBeNull();
  });
});

describe("JobForm — the optional required specialty", () => {
  const specialties = [
    { id: "s1", key: "spec_a", tradeKey: "plumbing" },
    { id: "s2", key: "spec_b", tradeKey: "plumbing" },
    { id: "s3", key: "spec_c", tradeKey: "kitchens_doors" },
  ];

  it("shows NOTHING when the catalogue is empty (the schema exists, the names are approved separately)", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} />, "en");
    expect(document.querySelector("#requiredSpecialtyId")).toBeNull();
    expect(screen.queryByText("Required specialty (optional)")).toBeNull();
  });

  it("shows no empty selector for a trade that has no specialties", () => {
    renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} specialties={specialties} />, "en");
    choose("#tradeKey", "Marble & granite");
    expect(document.querySelector("#requiredSpecialtyId")).toBeNull();
  });

  it("appears once the chosen trade has specialties, offers only THAT trade's, and submits the id", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} specialties={specialties} />, "en");
    choose("#tradeKey", "Plumbing");
    fireEvent.click(document.querySelector("#requiredSpecialtyId")!);
    const labels = within(screen.getByRole("listbox", { name: "Required specialty (optional)" })).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Any specialty in this trade", "spec_a", "spec_b"]); // no name is invented: the key is shown until a name is approved
    fireEvent.click(screen.getByRole("option", { name: "spec_b" }));
    expect(submitted(container, "requiredSpecialtyId")).toBe("s2");
  });

  it("changing the trade clears the specialty — it belongs to one trade", () => {
    const { container } = renderWithI18n(<JobForm mode="create" orgId="o1" trades={trades} specialties={specialties} />, "en");
    choose("#tradeKey", "Plumbing");
    choose("#requiredSpecialtyId", "spec_a");
    expect(submitted(container, "requiredSpecialtyId")).toBe("s1");
    choose("#tradeKey", "Kitchens & doors");
    expect(submitted(container, "requiredSpecialtyId")).toBe("");
  });

  it("an edit starts from the job's own requirement", () => {
    const { container } = renderWithI18n(
      <JobForm mode="edit" orgId="o1" trades={trades} specialties={specialties} job={job({ tradeKey: "plumbing", required_specialty_id: "s2" })} />,
      "en",
    );
    expect(submitted(container, "requiredSpecialtyId")).toBe("s2");
  });
});
