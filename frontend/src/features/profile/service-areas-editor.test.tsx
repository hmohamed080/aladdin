import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

const saved: FormData[] = [];
vi.mock("@/server/actions/service-areas", () => ({
  setServiceAreasAction: async (_p: unknown, fd: FormData) => {
    saved.push(fd);
    return { ok: true };
  },
  addAvailabilityWindowAction: vi.fn(),
  removeAvailabilityWindowAction: vi.fn(),
}));

import { ServiceAreasEditor } from "./service-areas-editor";

const empty = { primaryGovernorate: null, primaryCities: [] as string[], others: [] as { governorateKey: string; cityKey: string | null }[] };
const hidden = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;
const choose = (id: string, label: string) => {
  fireEvent.click(document.querySelector(id)!);
  fireEvent.click(screen.getByRole("option", { name: label }));
};

beforeEach(() => {
  saved.length = 0;
});

describe("ServiceAreasEditor — where you work, from the catalogue", () => {
  it("starts empty and offers only a main governorate until one is chosen", () => {
    renderWithI18n(<ServiceAreasEditor value={empty} />, "en");
    expect(screen.getByRole("button", { name: "Your main governorate" }).textContent).toBe("Choose your governorate");
    expect(screen.queryByTestId("service-area-cities")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add another area" })).toBeNull();
  });

  it("choosing the main governorate reveals ITS cities (never 'other'), as toggles", () => {
    const { container } = renderWithI18n(<ServiceAreasEditor value={empty} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Your main governorate" }));
    fireEvent.click(screen.getByRole("option", { name: "Cairo" }));
    const chips = within(screen.getByTestId("service-area-cities"));
    expect(chips.getByText("New Cairo")).toBeTruthy();
    expect(chips.queryByText("Other city")).toBeNull();
    fireEvent.click(chips.getByText("New Cairo"));
    fireEvent.click(chips.getByText("Maadi"));
    expect(hidden(container, "primary")).toBe("cairo");
    expect(JSON.parse(hidden(container, "areas")!)).toEqual([
      { governorateKey: "cairo", cityKey: "new-cairo" },
      { governorateKey: "cairo", cityKey: "maadi" },
    ]);
  });

  it("another governorate can be added whole or as one city, and is posted with the complete set", () => {
    const { container } = renderWithI18n(<ServiceAreasEditor value={{ ...empty, primaryGovernorate: "cairo" }} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Add another area" }));
    const row = within(screen.getByTestId("other-service-area"));
    fireEvent.click(row.getByRole("button", { name: "Governorate" }));
    expect(screen.queryByRole("option", { name: "Cairo" })).toBeNull(); // the main one cannot also be an "other"
    fireEvent.click(screen.getByRole("option", { name: "Giza" }));
    expect(JSON.parse(hidden(container, "areas")!)).toEqual([{ governorateKey: "giza", cityKey: null }]); // the whole governorate
    fireEvent.click(row.getByRole("button", { name: "City" }));
    fireEvent.click(screen.getByRole("option", { name: "Dokki" }));
    expect(JSON.parse(hidden(container, "areas")!)).toEqual([{ governorateKey: "giza", cityKey: "dokki" }]);
  });

  it("an existing set is shown as saved, and removing a row removes it from what is posted", () => {
    const { container } = renderWithI18n(
      <ServiceAreasEditor value={{ primaryGovernorate: "cairo", primaryCities: ["new-cairo"], others: [{ governorateKey: "giza", cityKey: null }, { governorateKey: "alexandria", cityKey: "borg-el-arab" }] }} />,
      "en",
    );
    expect(screen.getAllByTestId("other-service-area")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Remove .*Giza/ }));
    expect(JSON.parse(hidden(container, "areas")!)).toEqual([
      { governorateKey: "cairo", cityKey: "new-cairo" },
      { governorateKey: "alexandria", cityKey: "borg-el-arab" },
    ]);
  });

  it("changing the main governorate clears its cities and drops that governorate from the others", () => {
    const { container } = renderWithI18n(
      <ServiceAreasEditor value={{ primaryGovernorate: "cairo", primaryCities: ["maadi"], others: [{ governorateKey: "giza", cityKey: null }] }} />,
      "en",
    );
    choose("[aria-label='Your main governorate']", "Giza");
    expect(hidden(container, "primary")).toBe("giza");
    expect(JSON.parse(hidden(container, "areas")!)).toEqual([]); // cairo/maadi gone; giza is now the main one, not an "other"
  });

  it("states what it is for — and that it never limits which jobs a person can open or apply to", () => {
    renderWithI18n(<ServiceAreasEditor value={empty} />, "en");
    expect(screen.getByText(/never limits which jobs you can open or apply to/i)).toBeTruthy();
    expect(screen.getByText(/It is not a distance/i)).toBeTruthy();
  });

  it("is Arabic from the same catalogue, with the approved wording", () => {
    renderWithI18n(<ServiceAreasEditor value={{ ...empty, primaryGovernorate: "cairo" }} />, "ar");
    expect(screen.getByText("أين تعمل")).toBeTruthy();
    expect(screen.getByRole("button", { name: "محافظتك الأساسية" }).textContent).toBe("القاهرة");
  });
});
