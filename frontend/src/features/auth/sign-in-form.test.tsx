import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { SignInForm } from "./sign-in-form";
import { ar } from "@/lib/i18n/messages/ar";
import * as auth from "@/server/actions/auth";

// The form binds to server actions; stub them so the component renders in jsdom.
vi.mock("@/server/actions/auth", () => ({
  requestEmailOtp: vi.fn(),
  verifyEmailOtp: vi.fn(),
}));

const EMAIL = "a-owner@example.test";

/** Fill the email and submit step 1 so the component advances to the code step. */
async function advanceToVerifyStep() {
  vi.mocked(auth.requestEmailOtp).mockResolvedValue({ ok: true, code: "auth.info.codeSent", email: EMAIL });
  renderWithI18n(<SignInForm next="/b2b" />);
  const emailInput = screen.getByLabelText(ar.auth.emailLabel);
  fireEvent.change(emailInput, { target: { value: EMAIL } });
  // Submit via requestSubmit() inside act — the React-19-canonical path. A form
  // with a function `action` carries a `javascript:throw` native-submit guard;
  // a native submit-button click (and even fireEvent.submit) can race React's
  // preventDefault under full-suite timing and let jsdom execute the guard
  // ("A React form was unexpectedly submitted"). requestSubmit lets React
  // intercept and preventDefault first, deterministically invoking the action.
  await act(async () => {
    (emailInput.closest("form") as HTMLFormElement).requestSubmit();
  });
  await screen.findByLabelText(ar.auth.codeLabel);
  // Let the post-send effect (which clears the editing override) fully settle so
  // a later "change email" click can't race a trailing setEditingEmail(false).
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SignInForm (Arabic-first passwordless)", () => {
  it("renders the Arabic email step with the passwordless hint", () => {
    renderWithI18n(<SignInForm next="/b2b" />);
    expect(screen.getByText(ar.auth.title)).toBeInTheDocument();
    expect(screen.getByLabelText(ar.auth.emailLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeInTheDocument();
    expect(screen.getByText(ar.auth.passwordless)).toBeInTheDocument();
  });

  it("marks the email input as type=email with the correct autocomplete", () => {
    renderWithI18n(<SignInForm next="/b2b" />);
    const input = screen.getByLabelText(ar.auth.emailLabel) as HTMLInputElement;
    expect(input.type).toBe("email");
    expect(input.autocomplete).toBe("email");
  });

  it("has NO nested <form> at the code-verification step (valid HTML)", async () => {
    await advanceToVerifyStep();
    // The definitive invariant: no form element contains another form element.
    expect(document.querySelectorAll("form form").length).toBe(0);
    // Sanity: we really are at the verify step (a code field is present).
    expect(screen.getByLabelText(ar.auth.codeLabel)).toBeInTheDocument();
  });

  it("changing the email is a plain button (never a nested submit) and returns to step 1", async () => {
    await advanceToVerifyStep();
    const change = screen.getByRole("button", { name: ar.auth.changeEmail });
    expect((change as HTMLButtonElement).type).toBe("button");
    fireEvent.click(change);
    // Back on the email step, pre-filled and focused for correction.
    await waitFor(() => {
      const email = screen.getByLabelText(ar.auth.emailLabel) as HTMLInputElement;
      expect(email.value).toBe(EMAIL);
      expect(document.activeElement).toBe(email);
    });
  });
});
