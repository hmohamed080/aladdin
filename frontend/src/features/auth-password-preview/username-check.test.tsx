import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";

const checkUsername = vi.fn();
vi.mock("@/server/actions/sign-up", () => ({ checkUsername: (name: string) => checkUsername(name) }));

import { useUsernameCheck, UsernameStatus } from "./username-check";

function Harness() {
  const [name, setName] = useState("");
  const check = useUsernameCheck(name);
  return (
    <>
      <input aria-label="username" value={name} onChange={(e) => setName(e.target.value)} />
      <UsernameStatus id="s" check={check} onPick={setName} />
    </>
  );
}

const s = en.authPasswordPreview.signUp;

beforeEach(() => {
  vi.useFakeTimers();
  checkUsername.mockReset();
});
afterEach(() => vi.useRealTimers());

async function type(value: string) {
  fireEvent.change(screen.getByLabelText("username"), { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
}

describe("username check while typing", () => {
  it("judges the shape in the browser without asking the server", async () => {
    renderWithI18n(<Harness />, "en");
    await type("1abc");
    expect(screen.getByText(s.usernameRules)).toBeInTheDocument();
    expect(checkUsername).not.toHaveBeenCalled();
  });

  it("asks once after a pause and shows available", async () => {
    checkUsername.mockResolvedValue({ status: "available" });
    renderWithI18n(<Harness />, "en");
    fireEvent.change(screen.getByLabelText("username"), { target: { value: "ahm" } });
    expect(screen.getByText(s.usernameChecking)).toBeInTheDocument();
    await type("ahmed");
    expect(checkUsername).toHaveBeenCalledTimes(1);
    expect(checkUsername).toHaveBeenCalledWith("ahmed");
    expect(screen.getByText(new RegExp(s.usernameAvailable))).toBeInTheDocument();
  });

  it("shows taken with a suggestion that fills the field", async () => {
    checkUsername.mockResolvedValue({ status: "taken", suggestion: "ahmed42" });
    renderWithI18n(<Harness />, "en");
    await type("ahmed");
    expect(screen.getByText(new RegExp(s.usernameTaken))).toBeInTheDocument();
    checkUsername.mockResolvedValue({ status: "available" });
    fireEvent.click(screen.getByRole("button", { name: "Try ahmed42" }));
    expect(screen.getByLabelText("username")).toHaveValue("ahmed42");
  });
});
