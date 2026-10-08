import { createRef, useState, Fragment } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LabeledField, Select } from "./controls";

/**
 * THE SHARED `Select` — a drop-in for <select><option/></select> that is drawn in the design system.
 *
 * What the PERSON operates is a button + a listbox on the shared floating surface. What the FORM sees is still a real
 * native <select> (hidden): it carries name / id / value / required / the ref and the change event, so every call site
 * written as `<Select name=… defaultValue=… onChange={(e) => …}>` keeps working unchanged. These tests pin both halves.
 * (Geometry — flip, shift, clipping — is Floating UI's and is proven in a real browser; see the cross-browser pass.)
 */

const cities = (
  <>
    <option value="">Choose…</option>
    <option value="cairo">Cairo</option>
    <option value="giza">Giza</option>
    <option value="luxor" disabled>
      Luxor
    </option>
  </>
);

const nativeOf = (container: HTMLElement) => container.querySelector("select[data-ui-select-native]") as HTMLSelectElement;
// The button names itself with hidden text — "City: Giza": the field's label, then its value.
const trigger = (name: string) => screen.getByRole("button", { name: new RegExp("^" + name + "\\b") });
/** The VISIBLE value (the hidden "City: " name prefix is not part of what the person sees). */
const valueSpan = (name: string) => trigger(name).querySelector("span:not(.sr-only)")!;
const shown = (name: string) => valueSpan(name).textContent;

describe("Select — what the person sees and operates", () => {
  it("is a button that names itself from the <label for>, announces a listbox, and shows the chosen label", () => {
    render(
      <LabeledField label="City" htmlFor="city">
        <Select id="city" name="city" defaultValue="giza">
          {cities}
        </Select>
      </LabeledField>,
    );
    const button = trigger("City");
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(shown("City")).toBe("Giza");
  });

  it("opens a listbox on the shared floating surface (portaled), focuses the chosen option and lists every option", () => {
    render(
      <Select aria-label="City" defaultValue="giza">
        {cities}
      </Select>,
    );
    fireEvent.click(trigger("City"));
    const list = screen.getByRole("listbox", { name: "City" });
    expect(list.closest("#overlay-root")).not.toBeNull(); // not inside the form's own DOM: nothing can clip it
    expect(list).toHaveAttribute("data-floating-menu");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Cairo", "Giza", "Luxor"]);
    expect(within(list).getByRole("option", { name: "Luxor" })).toBeDisabled();
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Giza" }));
  });

  it("opens with Arrow Down from the keyboard, chooses with a click, closes and returns focus to the button", () => {
    render(
      <Select aria-label="City" defaultValue="">
        {cities}
      </Select>,
    );
    const button = trigger("City");
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Cairo" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(shown("City")).toBe("Cairo");
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape and returns focus; Arrow keys move between options and skip the disabled one", () => {
    render(
      <Select aria-label="City" defaultValue="giza">
        {cities}
      </Select>,
    );
    const button = trigger("City");
    fireEvent.click(button);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Choose…" })); // wraps; Luxor is skipped
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Giza" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("a DISABLED prompt that is the current value does not strand the keyboard: focus lands on the first enabled option", () => {
    render(
      <Select aria-label="Type" defaultValue="">
        <option value="" disabled>
          Choose a type
        </option>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    fireEvent.click(trigger("Type"));
    const list = screen.getByRole("listbox");
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Alpha" }));
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Beta" }));
  });

  it("type-ahead jumps to the option that starts with what was typed", () => {
    render(
      <Select aria-label="City" defaultValue="cairo">
        {cities}
      </Select>,
    );
    fireEvent.click(trigger("City"));
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "g" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Giza" }));
  });

  it("an empty-valued option is a prompt: it reads as muted text, like a placeholder", () => {
    render(
      <Select aria-label="City" defaultValue="">
        {cities}
      </Select>,
    );
    const label = valueSpan("City");
    expect(label.textContent).toBe("Choose…");
    expect(label.className).toContain("text-fg-muted");
  });

  it("lists <optgroup> children under their heading, through fragments and arrays", () => {
    render(
      <Select aria-label="Place" defaultValue="maadi">
        <option value="">Any</option>
        <optgroup label="Cairo">
          <option value="maadi">Maadi</option>
          <Fragment>
            <option value="zamalek">Zamalek</option>
          </Fragment>
        </optgroup>
        <optgroup label="Giza">{["dokki", "haram"].map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
      </Select>,
    );
    fireEvent.click(trigger("Place"));
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Cairo", "Giza"]);
    expect(within(within(list).getByRole("group", { name: "Cairo" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Maadi", "Zamalek"]);
    expect(within(within(list).getByRole("group", { name: "Giza" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["dokki", "haram"]);
  });

  it("a disabled select is a disabled button and never opens", () => {
    const { container } = render(
      <Select aria-label="City" disabled defaultValue="cairo">
        {cities}
      </Select>,
    );
    expect(trigger("City")).toBeDisabled();
    expect(nativeOf(container)).toBeDisabled();
    fireEvent.click(trigger("City"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("compact is the toolbar height, field matches Input", () => {
    const { rerender } = render(<Select aria-label="City" size="compact">{cities}</Select>);
    expect(trigger("City").className).toContain("h-7");
    rerender(<Select aria-label="City">{cities}</Select>);
    expect(trigger("City").className).toContain("min-h-11");
    expect(trigger("City").className).toContain("rounded-md");
  });
});

describe("Select — what the form and every existing call site still see", () => {
  it("keeps a REAL native <select>: aria-hidden, not tabbable, same name / id, same options", () => {
    const { container } = render(
      <Select id="c" name="city" defaultValue="cairo">
        {cities}
      </Select>,
    );
    const native = nativeOf(container);
    expect(native.tagName).toBe("SELECT");
    expect(native).toHaveAttribute("aria-hidden", "true");
    expect(native).toHaveAttribute("tabindex", "-1");
    expect(native.id).toBe("c");
    expect(native.name).toBe("city");
    expect(Array.from(native.options).map((o) => o.value)).toEqual(["", "cairo", "giza", "luxor"]);
    expect(native.value).toBe("cairo");
  });

  it("choosing an option sets the native value and fires a genuine change event the caller's onChange receives", () => {
    const onChange = vi.fn((event: React.ChangeEvent<HTMLSelectElement>) => event.target.value);
    const { container } = render(
      <Select aria-label="City" name="city" defaultValue="" onChange={onChange}>
        {cities}
      </Select>,
    );
    fireEvent.click(trigger("City"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Giza" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0]!.value).toBe("giza");
    expect(nativeOf(container).value).toBe("giza");
    expect(shown("City")).toBe("Giza");
  });

  it("is submitted by the form exactly like a native select (FormData)", () => {
    const { container } = render(
      <form>
        <Select aria-label="City" name="city" defaultValue="cairo">
          {cities}
        </Select>
      </form>,
    );
    expect(new FormData(container.querySelector("form")!).get("city")).toBe("cairo");
    fireEvent.click(trigger("City"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Giza" }));
    expect(new FormData(container.querySelector("form")!).get("city")).toBe("giza");
  });

  it("controlled: shows the `value` it is given, reports the choice, and only moves when the parent says so", () => {
    function Controlled({ onPick }: { onPick: (v: string) => void }) {
      const [value, setValue] = useState("cairo");
      return (
        <Select aria-label="City" value={value} onChange={(e) => { onPick(e.target.value); if (e.target.value !== "giza") setValue(e.target.value); }}>
          {cities}
        </Select>
      );
    }
    const onPick = vi.fn();
    render(<Controlled onPick={onPick} />);
    fireEvent.click(trigger("City"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Giza" }));
    expect(onPick).toHaveBeenCalledWith("giza");
    expect(shown("City")).toBe("Cairo"); // the parent refused: the control did not drift from its state
  });

  it("forwards its ref to the native select, so `ref.current.value` and form libraries keep working", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select aria-label="City" ref={ref} defaultValue="giza">
        {cities}
      </Select>,
    );
    expect(ref.current?.tagName).toBe("SELECT");
    expect(ref.current?.value).toBe("giza");
  });

  it("the <label for> still reaches the control: the label resolves to the native select, and focus is sent to the button", () => {
    render(
      <LabeledField label="City" htmlFor="city">
        <Select id="city" name="city" defaultValue="cairo">
          {cities}
        </Select>
      </LabeledField>,
    );
    const native = screen.getByLabelText("City") as HTMLSelectElement;
    expect(native.tagName).toBe("SELECT");
    native.focus();
    expect(document.activeElement).toBe(trigger("City"));
  });

  it("`required` validates on the native select, so an empty required choice blocks the form and focuses the visible control", () => {
    const { container } = render(
      <form>
        <Select aria-label="City" name="city" required defaultValue="">
          {cities}
        </Select>
      </form>,
    );
    const native = nativeOf(container);
    expect(native.required).toBe(true);
    expect(native.checkValidity()).toBe(false);
    fireEvent.click(trigger("City"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Cairo" }));
    expect(native.checkValidity()).toBe(true);
  });

  it("a form reset returns an uncontrolled select to its default", async () => {
    const { container } = render(
      <form>
        <Select aria-label="City" name="city" defaultValue="cairo">
          {cities}
        </Select>
      </form>,
    );
    fireEvent.click(trigger("City"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Giza" }));
    expect(shown("City")).toBe("Giza");
    // jsdom resets from the `selected` ATTRIBUTE and React's defaultValue sets a property, so it cannot restore the
    // default itself; a real browser can (verified in the cross-browser pass). What is ours — following the browser —
    // is what is asserted: once the form's `reset` event has fired and the native value is back, the button follows.
    nativeOf(container).value = "cairo";
    container.querySelector("form")!.dispatchEvent(new Event("reset"));
    await waitFor(() => expect(shown("City")).toBe("Cairo"));
  });

  it("follows a change that did not come from the list (a test, a script, a browser extension)", () => {
    const { container } = render(
      <Select aria-label="City" defaultValue="cairo">
        {cities}
      </Select>,
    );
    fireEvent.change(nativeOf(container), { target: { value: "giza" } });
    expect(shown("City")).toBe("Giza");
  });

  it("follows the browser when the options change under it (a dependent city list)", () => {
    const { container, rerender } = render(
      <Select aria-label="City" defaultValue="cairo">
        <option value="cairo">Cairo</option>
        <option value="giza">Giza</option>
      </Select>,
    );
    expect(shown("City")).toBe("Cairo");
    rerender(
      <Select aria-label="City" defaultValue="cairo">
        <option value="mansoura">Mansoura</option>
        <option value="damietta">Damietta</option>
      </Select>,
    );
    // cairo no longer exists; the native select falls to its first option and the button follows
    expect(nativeOf(container).value).toBe("mansoura");
    expect(shown("City")).toBe("Mansoura");
  });

  it("is invalid-aware: aria-invalid on the select marks the visible control, where the danger border is drawn", () => {
    const { container } = render(
      <Select aria-label="City" aria-invalid="true">
        {cities}
      </Select>,
    );
    expect(trigger("City")).toHaveAttribute("data-invalid", "true");
    expect(trigger("City").className).toContain("data-[invalid=true]:border-danger");
    expect(nativeOf(container)).toHaveAttribute("aria-invalid", "true");
  });
});
