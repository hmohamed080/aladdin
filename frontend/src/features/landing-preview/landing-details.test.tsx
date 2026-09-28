import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingDetails } from "./landing-details";
import { landingBlockContent } from "./landing-block-content";

vi.mock("@/lib/i18n/context", () => ({ useI18n: () => ({ locale: "ar", dir: "rtl" }) }));

// jsdom has no <dialog> modal API; the component opens it imperatively.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

describe("landing role dialog registration link", () => {
  const roles = landingBlockContent.ar.roles;
  const installer = roles.findIndex((r) => r.title === "للصنايعية والفنيين");

  it("sends the installers role to the phone sign-up", () => {
    render(<LandingDetails detail={installer} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: landingBlockContent.ar.register, hidden: true })).toHaveAttribute("href", "/installer/sign-up");
  });

  it.each(roles.map((r, i) => [r.title, i] as const).filter(([, i]) => i !== installer))(
    "keeps %s on the shared /auth/sign-up",
    (_title, index) => {
      render(<LandingDetails detail={index} onClose={() => {}} />);
      expect(screen.getByRole("link", { name: landingBlockContent.ar.register, hidden: true })).toHaveAttribute("href", "/auth/sign-up");
    },
  );
});
