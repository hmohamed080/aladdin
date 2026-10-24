import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ColorField, Swatch, SwatchRow } from "./color-swatches";
import type { ProductColor } from "./color-items";

const wrap = (node: React.ReactNode, locale: "en" | "ar" = "en") => render(<I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{node}</I18nProvider>);
const red: ProductColor = { name: "Dark Red", hex: "#8B1A1A", code: "dark_red" };
const sand: ProductColor = { name: "Sand", hex: "#D8C7A6", code: "sand" };

describe("Swatch tooltip — owned by the swatch alone", () => {
  it("is not shown when the pointer is over the CARD around the swatches (the old group-hover bug)", () => {
    wrap(
      <div className="group" data-testid="card">
        <SwatchRow colors={[red, sand]} />
        <p data-testid="meta">metadata line</p>
      </div>,
    );
    fireEvent.pointerEnter(screen.getByTestId("card"));
    fireEvent.mouseEnter(screen.getByTestId("card"));
    fireEvent.pointerEnter(screen.getByTestId("meta"));
    fireEvent.pointerEnter(screen.getByTestId("card-colors"));
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
  });

  it("shows ONLY the hovered swatch name and hides it when the pointer leaves", () => {
    wrap(<SwatchRow colors={[red, sand]} />);
    const [a, b] = screen.getAllByTestId("color-swatch");
    fireEvent.pointerEnter(a!);
    expect(screen.getAllByTestId("color-tooltip").map((t) => t.textContent)).toEqual(["Dark Red"]);
    fireEvent.pointerLeave(a!);
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
    fireEvent.pointerEnter(b!);
    expect(screen.getAllByTestId("color-tooltip").map((t) => t.textContent)).toEqual(["Sand"]);
  });

  it("shows on keyboard focus and is described by the tooltip", () => {
    wrap(<SwatchRow colors={[red]} />);
    const sw = screen.getByTestId("color-swatch");
    act(() => sw.focus());
    const tip = screen.getByTestId("color-tooltip");
    expect(tip.textContent).toBe("Dark Red");
    expect(sw.getAttribute("aria-describedby")).toBe(tip.id);
    expect(sw.getAttribute("aria-label")).toBe("Dark Red");
    act(() => sw.blur());
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
  });

  it("click pins the name until clicked again, Escape or a click elsewhere", () => {
    wrap(
      <>
        <SwatchRow colors={[red]} />
        <button type="button" data-testid="elsewhere">x</button>
      </>,
    );
    const sw = screen.getByTestId("color-swatch");
    fireEvent.click(sw);
    expect(screen.getByTestId("color-tooltip")).toBeTruthy();
    fireEvent.click(sw);
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
    fireEvent.click(sw);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
    fireEvent.click(sw);
    fireEvent.pointerDown(screen.getByTestId("elsewhere"));
    expect(screen.queryByTestId("color-tooltip")).toBeNull();
  });

  it("renders in a portal on the shared popup layer, never inside the card or row", () => {
    wrap(<div data-testid="card" className="overflow-hidden"><SwatchRow colors={[red]} /></div>);
    fireEvent.pointerEnter(screen.getByTestId("color-swatch"));
    const tip = screen.getByTestId("color-tooltip");
    expect(screen.getByTestId("card").contains(tip)).toBe(false);
    expect(tip.parentElement).toBe(document.body);
    expect(tip.className).toMatch(/z-popover/);
    expect(tip.className).toMatch(/pointer-events-none/);
  });

  it("names a colour in the reader language, direction included", () => {
    wrap(<SwatchRow colors={[red, { name: "Custom color #3A5F8A", hex: "#3A5F8A", code: "custom" }]} />, "ar");
    const [lib, custom] = screen.getAllByTestId("color-swatch");
    expect(lib!.getAttribute("aria-label")).toBe("أحمر داكن");
    expect(custom!.getAttribute("aria-label")).toBe("لون مخصص #3A5F8A");
    fireEvent.pointerEnter(lib!);
    expect(screen.getByTestId("color-tooltip").getAttribute("dir")).toBe("rtl");
  });

  it("still runs an action swatch click handler", () => {
    const onClick = vi.fn();
    wrap(<Swatch color={sand} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("color-swatch"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ColorField — searchable colour name", () => {
  const mount = (initial: ProductColor[] = [], locale: "en" | "ar" = "en") => {
    const onChange = vi.fn();
    const utils = wrap(<ColorField colors={initial} onChange={onChange} />, locale);
    return { onChange, ...utils };
  };
  const open = () => fireEvent.click(screen.getByTestId("add-color"));
  const type = (q: string) => {
    const input = screen.getByTestId("color-name");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: q } });
  };

  it("is a combobox over the library, not a free-text naming field", () => {
    mount();
    open();
    const input = screen.getByTestId("color-name");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    type("blu");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const texts = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent ?? "");
    for (const wanted of ["Blue", "Sky Blue", "Navy"]) expect(texts.some((t) => t.includes(wanted))).toBe(true);
  });

  it("filters Arabic as you type and fills the code and preview when a suggestion is chosen", () => {
    const { onChange } = mount([], "ar");
    open();
    type("احمر");
    const options = screen.getAllByRole("option");
    expect(options.slice(0, 3).map((o) => o.getAttribute("data-code"))).toEqual(["red", "dark_red", "light_red"]);
    fireEvent.click(options[1]!);
    expect((screen.getByTestId("color-hex") as HTMLInputElement).value).toBe("#8B1A1A");
    expect(screen.getByTestId("color-preview-name").textContent).toBe("أحمر داكن");
    expect(screen.getByTestId("color-preview-swatch").getAttribute("style") ?? "").toMatch(/background/);
    fireEvent.click(screen.getByTestId("color-save"));
    expect(onChange).toHaveBeenCalledWith([{ name: "أحمر داكن", hex: "#8B1A1A", code: "dark_red" }]);
  });

  it("supports the keyboard: arrows move, Enter picks, Escape closes only the list", () => {
    mount();
    open();
    const input = screen.getByTestId("color-name");
    type("red");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id);
    expect(screen.getAllByRole("option")[1]!.getAttribute("data-active")).not.toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((screen.getByTestId("color-hex") as HTMLInputElement).value).toBe("#8B1A1A");
    type("zz");
    expect(screen.getByTestId("color-no-match")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByTestId("color-popover")).toBeTruthy();
  });

  it("re-resolves a typed code to its library name only when it matches exactly, otherwise stays custom", () => {
    const { onChange } = mount();
    open();
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "#c62828" } });
    expect(screen.getByTestId("color-preview-name").textContent).toBe("Red");
    expect((screen.getByTestId("color-name") as HTMLInputElement).value).toBe("Red");
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "#C62829" } });
    expect(screen.getByTestId("color-preview-name").textContent).toBe("Custom color #C62829");
    expect((screen.getByTestId("color-name") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByTestId("color-save"));
    expect(onChange).toHaveBeenCalledWith([{ name: "#C62829", hex: "#C62829", code: "custom" }]);
  });

  it("offers an OPTIONAL name only for a custom value, never for a library colour", () => {
    mount();
    open();
    expect(screen.queryByTestId("color-custom-name")).toBeNull(); // nothing chosen yet
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "#AF725A" } });
    expect(screen.getByTestId("color-custom-name")).toBeTruthy();
    expect(screen.getByLabelText(/Color name \(optional\)/)).toBeTruthy();
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "#C62828" } }); // exactly the library "Red"
    expect(screen.queryByTestId("color-custom-name")).toBeNull();
    expect(screen.getByTestId("color-preview-name").textContent).toBe("Red");
  });

  it("stores the owner's own name for a custom value and shows it in the preview and the swatch tooltip", () => {
    const { onChange } = mount();
    open();
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "#AF725A" } });
    expect(screen.getByTestId("color-preview-name").textContent).toBe("Custom color #AF725A");
    fireEvent.change(screen.getByTestId("color-custom-name"), { target: { value: "Brick brown" } });
    expect(screen.getByTestId("color-preview-name").textContent).toBe("Brick brown");
    fireEvent.click(screen.getByTestId("color-save"));
    expect(onChange).toHaveBeenCalledWith([{ name: "Brick brown", hex: "#AF725A", code: "custom" }]);
  });

  it("a blank custom name falls back to Custom colour + hex (no naming is forced)", () => {
    const { onChange } = mount();
    open();
    fireEvent.change(screen.getByTestId("color-hex"), { target: { value: "#AF725A" } });
    fireEvent.change(screen.getByTestId("color-custom-name"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("color-save"));
    expect(onChange).toHaveBeenCalledWith([{ name: "#AF725A", hex: "#AF725A", code: "custom" }]);
  });

  it("re-opening a named custom colour restores its name; the Arabic UI keeps the owner's name and reads auto labels in Arabic", () => {
    const named: ProductColor = { name: "بني طوبي", hex: "#AF725A", code: "custom" };
    const auto: ProductColor = { name: "#3A5F8A", hex: "#3A5F8A", code: "custom" };
    const { onChange } = mount([named, auto], "ar");
    const [first, second] = screen.getAllByTestId("color-swatch");
    expect(first!.getAttribute("aria-label")).toBe("بني طوبي");
    expect(second!.getAttribute("aria-label")).toBe("لون مخصص #3A5F8A");
    fireEvent.click(first!);
    expect((screen.getByTestId("color-custom-name") as HTMLInputElement).value).toBe("بني طوبي");
    fireEvent.click(screen.getByTestId("color-save"));
    expect(onChange).toHaveBeenCalledWith([named, auto]);
  });

  it("the Add / Cancel actions put the primary action first, so it is on the right in Arabic", () => {
    mount([], "ar");
    open();
    const save = screen.getByTestId("color-save");
    expect(save.nextElementSibling?.textContent).toBe("إلغاء");
  });

  it("updates the preview from the native picker", () => {
    mount();
    open();
    fireEvent.change(screen.getByTestId("color-picker"), { target: { value: "#3a5f8a" } });
    expect((screen.getByTestId("color-hex") as HTMLInputElement).value).toBe("#3A5F8A");
    expect(screen.getByTestId("color-preview-name").textContent).toBe("Custom color #3A5F8A");
  });

  it("never asks the owner to invent a name: nothing chosen asks for a colour, not a name", () => {
    const { onChange } = mount();
    open();
    fireEvent.click(screen.getByTestId("color-save"));
    expect(screen.getByRole("alert").textContent).toMatch(/Pick a color from the list or enter a color code/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps several colours, ordered, and re-opens one with its name resolved", () => {
    const { onChange } = mount([red, sand]);
    fireEvent.click(screen.getAllByTestId("color-swatch")[0]!);
    expect((screen.getByTestId("color-name") as HTMLInputElement).value).toBe("Dark Red");
    expect((screen.getByTestId("color-hex") as HTMLInputElement).value).toBe("#8B1A1A");
    fireEvent.click(screen.getByTestId("color-save"));
    expect(onChange).toHaveBeenCalledWith([red, sand]);
  });

  it("the colour search starts at the logical start: an EMPTY field inherits the page direction (an empty dir=auto resolves to LTR), text switches it to auto", () => {
    mount([], "ar");
    open();
    const input = screen.getByTestId("color-name");
    expect(input.getAttribute("dir")).toBeNull();
    expect(input.className).toMatch(/text-start/);
    type("احمر");
    expect(input.getAttribute("dir")).toBe("auto");
    type("");
    expect(input.getAttribute("dir")).toBeNull();
  });

  it("the HEX field stays left-to-right in Arabic, and the Add Color icon is the first child (right of the label in RTL, left in LTR) with no reversal", () => {
    mount([], "ar");
    const add = screen.getByTestId("add-color");
    expect(add.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(add.className).not.toMatch(/flex-row-reverse|flex-reverse/);
    open();
    expect(screen.getByTestId("color-hex").getAttribute("dir")).toBe("ltr");
  });

  it("closes the popover on an outside click, but not on a click inside the list", () => {
    mount();
    open();
    type("blue");
    fireEvent.pointerDown(screen.getAllByRole("option")[0]!);
    expect(screen.getByTestId("color-popover")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("color-popover")).toBeNull();
  });
});
