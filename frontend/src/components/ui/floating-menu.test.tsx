import { useRef, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingMenu, resolveMenuMaxHeight } from "./floating-menu";
import { ListboxSelect } from "./listbox";

/**
 * THE SHARED FLOATING SURFACE.
 *
 * jsdom has no layout, so the geometry (flip, shift, viewport padding, scroll-ancestor tracking) belongs to Floating UI
 * and is exercised in a real browser (see the Playwright pass recorded with the review). What a unit test CAN prove, and
 * what regressed before, is the structure that makes clipping impossible and the behaviour every menu shares: it leaves
 * its trigger's DOM subtree, it is positioned `fixed`, it keeps the installer theme scope across the portal, and it
 * dismisses / returns focus / navigates the same way everywhere.
 */

function Harness({ initialOpen = false, role = "menu", onClose }: { initialOpen?: boolean; role?: "menu" | "listbox" | "dialog"; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <p data-testid="outside">outside</p>
      <div data-testid="clipper" style={{ overflow: "hidden", height: 10 }}>
        <div className="installer-surface" data-installer-theme="flat" dir="rtl">
          <button ref={trigger} type="button" aria-haspopup={role} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            trigger
          </button>
          <FloatingMenu
            open={open}
            onClose={() => {
              setOpen(false);
              onClose?.();
            }}
            anchorRef={trigger}
            role={role}
            aria-label="Things"
            placement="bottom-end"
            data-testid="menu"
          >
            <button type="button" role={role === "listbox" ? "option" : "menuitem"} aria-selected={role === "listbox" ? false : undefined}>One</button>
            <button type="button" role={role === "listbox" ? "option" : "menuitem"} aria-selected={role === "listbox" ? false : undefined}>Two</button>
            <button type="button" role={role === "listbox" ? "option" : "menuitem"} aria-selected={role === "listbox" ? false : undefined} disabled>Skipped</button>
            <button type="button" role={role === "listbox" ? "option" : "menuitem"} aria-selected={role === "listbox" ? false : undefined}>Three</button>
          </FloatingMenu>
        </div>
      </div>
    </div>
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "trigger" }));

describe("FloatingMenu — it cannot be clipped by the thing it hangs from", () => {
  it("renders in the shared overlay root on <body>, outside every ancestor of its trigger", () => {
    render(<Harness />);
    open();
    const menu = screen.getByTestId("menu");
    expect(menu.closest("[data-testid=clipper]")).toBeNull(); // not inside the overflow-hidden container
    expect(menu.closest("#overlay-root")).not.toBeNull();
    expect(document.getElementById("overlay-root")?.parentElement).toBe(document.body);
    // ONE root, however many menus open.
    expect(document.querySelectorAll("#overlay-root")).toHaveLength(1);
  });

  it("is positioned `fixed` (Floating UI's fixed strategy) — never `absolute` inside a clipping ancestor — with the shared layer and a rounded themed surface", () => {
    render(<Harness />);
    open();
    const menu = screen.getByTestId("menu");
    expect(menu.style.position).toBe("fixed");
    expect(menu.className).toContain("z-popover");
    expect(menu.className).toMatch(/rounded-md/);
    expect(menu.className).toContain("bg-surface");
    expect(menu.className).toContain("shadow-lg");
    expect(menu.className).not.toMatch(/\babsolute\b/);
  });

  it("knows its placement and carries it as data (Floating UI resolves flip / shift on top of it)", () => {
    render(<Harness />);
    open();
    expect(screen.getByTestId("menu").getAttribute("data-placement")).toMatch(/end$/);
  });

  it("carries the INSTALLER theme scope and the writing direction across the portal, so it looks like one that never left", () => {
    render(<Harness />);
    open();
    const scope = screen.getByTestId("menu").parentElement!;
    expect(scope).toHaveClass("installer-surface");
    expect(scope.getAttribute("data-installer-theme")).toBe("flat");
    expect(scope.getAttribute("dir")).toBe("rtl");
  });

  it("adds no theme scope for a trigger that is not inside one", () => {
    function Plain() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [o, setO] = useState(false);
      return (
        <>
          <button ref={trigger} type="button" onClick={() => setO(true)}>plain</button>
          <FloatingMenu open={o} onClose={() => setO(false)} anchorRef={trigger} data-testid="plain-menu"><span>x</span></FloatingMenu>
        </>
      );
    }
    render(<Plain />);
    fireEvent.click(screen.getByRole("button", { name: "plain" }));
    expect(screen.getByTestId("plain-menu").parentElement).not.toHaveClass("installer-surface");
  });
});

describe("FloatingMenu — the behaviour every menu shares", () => {
  it("has the role and name it was given, and nothing in the DOM while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    expect(screen.getByRole("menu", { name: "Things" })).toBeTruthy();
  });

  it("closes on an outside press, but not on a press of its own trigger or inside itself", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    open();
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "One" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("button", { name: "trigger" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<Harness />);
    open();
    screen.getByRole("menuitem", { name: "Two" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "trigger" }));
  });

  it("Tab leaves the menu: it closes and focus is handed back so the browser continues from the trigger", () => {
    render(<Harness />);
    open();
    screen.getByRole("menuitem", { name: "One" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "trigger" }));
  });

  it("Arrow Down / Up / Home / End move between enabled items, wrapping, and skip a disabled one", () => {
    render(<Harness />);
    open();
    const menu = screen.getByRole("menu");
    const names = () => (document.activeElement as HTMLElement).textContent;
    screen.getByRole("menuitem", { name: "One" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(names()).toBe("Two");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(names()).toBe("Three"); // "Skipped" is disabled
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(names()).toBe("One"); // wraps
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(names()).toBe("Three");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(names()).toBe("One");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(names()).toBe("Three");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(4);
  });

  it("type-ahead jumps to the next item whose label starts with what was typed", () => {
    render(<Harness />);
    open();
    screen.getByRole("menuitem", { name: "One" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "t" });
    expect((document.activeElement as HTMLElement).textContent).toBe("Two");
    fireEvent.keyDown(document.activeElement!, { key: "h" }); // "th"
    expect((document.activeElement as HTMLElement).textContent).toBe("Three");
  });

  it("does not move focus twice when an item already handled the key itself", () => {
    function Own() {
      const trigger = useRef<HTMLButtonElement>(null);
      const refs = useRef<HTMLButtonElement[]>([]);
      return (
        <>
          <button ref={trigger} type="button">own</button>
          <FloatingMenu open onClose={() => undefined} anchorRef={trigger}>
            {["a", "b", "c"].map((n, i) => (
              <button
                key={n}
                ref={(el) => {
                  if (el) refs.current[i] = el;
                }}
                role="menuitem"
                type="button"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    refs.current[(i + 1) % 3]!.focus();
                  }
                }}
              >
                {n}
              </button>
            ))}
          </FloatingMenu>
        </>
      );
    }
    render(<Own />);
    screen.getByRole("menuitem", { name: "a" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).textContent).toBe("b"); // one step, not two
  });

  it("a dialog-role surface leaves arrow keys to its own content", () => {
    render(<Harness role="dialog" />);
    open();
    screen.getByRole("menuitem", { name: "One" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).textContent).toBe("One");
  });
});

describe("ListboxSelect — the shared single-choice select for controls we own", () => {
  const options = [
    { value: "", label: "All" },
    { value: "cairo", label: "Cairo" },
    { value: "giza", label: "Giza" },
    { value: "luxor", label: "Luxor", disabled: true },
  ];

  function Select({ initial = "", onChange = () => undefined, disabled = false }: { initial?: string; onChange?: (v: string) => void; disabled?: boolean }) {
    const [value, setValue] = useState(initial);
    return (
      <form data-testid="form">
        <ListboxSelect label="Governorate" name="gov" value={value} options={options} disabled={disabled} onChange={(v) => { setValue(v); onChange(v); }} />
      </form>
    );
  }

  it("is a real button with a name, announces a listbox, and shows the chosen label", () => {
    render(<Select initial="cairo" />);
    const button = screen.getByRole("button", { name: "Governorate" });
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.textContent).toBe("Cairo");
  });

  it("opens a listbox on click, focuses the chosen option, and chooses with Enter / click, returning focus to the button", () => {
    const onChange = vi.fn();
    render(<Select initial="cairo" onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Governorate" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox", { name: "Governorate" });
    expect(button).toHaveAttribute("aria-controls", list.id);
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Cairo" }));
    fireEvent.click(within(list).getByRole("option", { name: "Giza" }));
    expect(onChange).toHaveBeenCalledWith("giza");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(button.textContent).toBe("Giza");
    expect(document.activeElement).toBe(button);
  });

  it("opens with Arrow Down from the button and moves with the arrow keys", () => {
    render(<Select />);
    const button = screen.getByRole("button", { name: "Governorate" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "All" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Cairo" }));
  });

  it("marks the selected option and never offers a disabled one", () => {
    render(<Select initial="giza" />);
    fireEvent.click(screen.getByRole("button", { name: "Governorate" }));
    expect(screen.getByRole("option", { name: "Giza" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Cairo" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: "Luxor" })).toBeDisabled();
  });

  it("drops into a plain <form>: a hidden input carries the value", () => {
    render(<Select initial="cairo" />);
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("gov")).toBe("cairo");
    fireEvent.click(screen.getByRole("button", { name: "Governorate" }));
    fireEvent.click(screen.getByRole("option", { name: "Giza" }));
    expect(new FormData(form).get("gov")).toBe("giza");
  });

  it("Escape closes without choosing, and a disabled select never opens", () => {
    const onChange = vi.fn();
    const { unmount } = render(<Select onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Governorate" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    render(<Select disabled />);
    expect(screen.getByRole("button", { name: "Governorate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Governorate" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("resolveMenuMaxHeight — a long list never becomes a viewport-tall column", () => {
  it("a caller's cap wins when there is more room than the cap (28 governorates stay ~7 rows and scroll inside)", () => {
    expect(resolveMenuMaxHeight(876, 256)).toBe(256);
  });
  it("the room left wins when it is smaller than the cap (near the viewport edge)", () => {
    expect(resolveMenuMaxHeight(200, 256)).toBe(200);
  });
  it("never shrinks below ~7 rows, even with almost no room", () => {
    expect(resolveMenuMaxHeight(30, 256)).toBe(140);
  });
  it("with no cap (an action menu) the surface is limited only by the viewport, as before", () => {
    expect(resolveMenuMaxHeight(876)).toBe(876);
  });
});
