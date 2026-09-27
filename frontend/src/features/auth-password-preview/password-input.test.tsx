import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  it("starts masked and toggles to visible via a real, keyboard-operable button", () => {
    renderWithI18n(<PasswordInput id="pw" name="password" defaultValue="secret-value" />);
    const input = screen.getByDisplayValue("secret-value") as HTMLInputElement;
    expect(input.type).toBe("password");

    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("type")).toBe("button"); // never submits the enclosing form
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(input.type).toBe("password");
  });

  it("carries the caller's autocomplete attribute through unchanged", () => {
    renderWithI18n(<PasswordInput id="pw" name="password" autoComplete="new-password" />);
    const input = document.getElementById("pw") as HTMLInputElement;
    expect(input.autocomplete).toBe("new-password");
  });
});
