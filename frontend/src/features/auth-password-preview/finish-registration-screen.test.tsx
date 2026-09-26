import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("@/server/actions/registration", () => ({
  chooseAccountTypeAction: vi.fn(async () => ({ ok: false })),
  chooseUsernameAction: vi.fn(async () => ({ ok: false })),
}));

import { FinishRegistrationScreen } from "./finish-registration-screen";

const LATIN = /[A-Za-z]{3,}/;
const ARABIC = /[؀-ۿ]/;

describe("FinishRegistrationScreen — username recovery copy", () => {
  it("explains a lost username claim in English, with no Arabic", () => {
    const { container } = renderWithI18n(<FinishRegistrationScreen needsAccountType={false} usernameUnavailable />, "en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The username you selected is no longer available.");
    expect(screen.getByText("Choose another username to continue.")).toBeTruthy();
    expect(container.textContent).not.toMatch(ARABIC);
    // Never says why (reserved vs taken).
    expect(container.textContent).not.toMatch(/reserved|taken/i);
  });

  it("explains it in Arabic with no English in the new copy", () => {
    renderWithI18n(<FinishRegistrationScreen needsAccountType={false} usernameUnavailable />, "ar");
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toBe("اسم المستخدم الذي اخترته لم يعد متاحًا");
    expect(heading).not.toMatch(LATIN);
    const subtitle = screen.getByText("اختر اسمًا آخر للمتابعة.");
    expect(subtitle.textContent).not.toMatch(LATIN);
  });

  it("keeps the generic copy when no collision was reported (e.g. a lost pending write)", () => {
    renderWithI18n(<FinishRegistrationScreen needsAccountType={false} />, "en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Choose a username");
  });

  it("still asks for the account type — not the username — when that is what is missing", () => {
    renderWithI18n(<FinishRegistrationScreen needsAccountType usernameUnavailable />, "en");
    expect(screen.queryByText("The username you selected is no longer available.")).toBeNull();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
