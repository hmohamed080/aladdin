import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ViewAsEye } from "./view-as-eye";

afterEach(cleanup);
const show = (variant?: "icon" | "button") =>
  render(
    <I18nProvider locale="en" dir="ltr">
      <ViewAsEye userId="u1" variant={variant} />
    </I18nProvider>,
  );

describe("ViewAsEye", () => {
  it("is a POST form to the start route, never a link (a GET/prefetch can never open a session)", () => {
    const { container } = show();
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe("post");
    expect(form.getAttribute("action")).toBe("/admin/users/u1/view/start");
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByRole("button", { name: "View account (read-only)" })).toBeTruthy();
  });
  it("has a labelled button variant for the detail page", () => {
    show("button");
    expect(screen.getByRole("button", { name: /View account \(read-only\)/ })).toBeTruthy();
  });
});
