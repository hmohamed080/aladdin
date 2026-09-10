import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpandCollapse } from "./expand-collapse";

describe("ExpandCollapse", () => {
  it("starts collapsed, showing the 'more' label and hiding its content from the tab order", () => {
    render(
      <ExpandCollapse moreLabel="عرض المزيد" lessLabel="عرض أقل">
        <button>hidden action</button>
      </ExpandCollapse>,
    );
    const trigger = screen.getByRole("button", { name: "عرض المزيد" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const hidden = screen.getByRole("button", { name: "hidden action" });
    expect(hidden.closest("[inert]")).not.toBeNull();
  });

  it("expands on click: label flips, aria-expanded flips, content is no longer inert", () => {
    render(
      <ExpandCollapse moreLabel="عرض المزيد" lessLabel="عرض أقل">
        <button>hidden action</button>
      </ExpandCollapse>,
    );
    fireEvent.click(screen.getByRole("button", { name: "عرض المزيد" }));

    const trigger = screen.getByRole("button", { name: "عرض أقل" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const revealed = screen.getByRole("button", { name: "hidden action" });
    expect(revealed.closest("[inert]")).toBeNull();
  });

  it("collapses again on a second click", () => {
    render(
      <ExpandCollapse moreLabel="Show more" lessLabel="Show less">
        <span>content</span>
      </ExpandCollapse>,
    );
    const trigger = () => screen.getByRole("button", { name: /show (more|less)/i });
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("wires aria-controls to the region it expands", () => {
    render(
      <ExpandCollapse moreLabel="Show more" lessLabel="Show less">
        <span>content</span>
      </ExpandCollapse>,
    );
    const trigger = screen.getByRole("button", { name: "Show more" });
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId!)).not.toBeNull();
  });
});
