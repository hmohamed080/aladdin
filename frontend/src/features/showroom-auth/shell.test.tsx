import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowroomAuthShell } from "./shell";

describe("ShowroomAuthShell footer", () => {
  it("sign-in sends 'Create account' to the general registration, where the account type is chosen", () => {
    render(<ShowroomAuthShell variant="signIn"><div /></ShowroomAuthShell>);
    expect(screen.getByRole("link", { name: "إنشاء حساب" })).toHaveAttribute("href", "/auth/sign-up");
  });

  it("showroom sign-up links back to sign-in", () => {
    render(<ShowroomAuthShell variant="signUp"><div /></ShowroomAuthShell>);
    expect(screen.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute("href", "/sign-in");
  });
});
