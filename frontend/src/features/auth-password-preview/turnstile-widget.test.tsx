import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PENDING_SUBMIT_TIMEOUT_MS, TurnstileWidget } from "./turnstile-widget";

type RenderOptions = {
  sitekey: string;
  action?: string;
  appearance?: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "error-callback"?: () => void;
};

let renders: RenderOptions[];
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  renders = [];
  remove = vi.fn();
  // Pre-seeding `window.turnstile` makes the loader resolve without a network script.
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: HTMLElement, options: RenderOptions) => {
      renders.push(options);
      return `widget-${renders.length}`;
    },
    remove,
  };
});

afterEach(() => {
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

const flush = () => act(async () => { await Promise.resolve(); });
const tokenInput = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

describe("TurnstileWidget", () => {
  it("writes the solved token into a hidden input named captchaToken by default", async () => {
    renderWithI18n(<TurnstileWidget action="sign-up" />);
    await flush();
    expect(tokenInput("captchaToken").value).toBe("");
    expect(tokenInput("captchaToken").dataset.captchaReady).toBe("false");
    act(() => renders[0]!.callback("solved-token"));
    expect(tokenInput("captchaToken").value).toBe("solved-token");
    expect(tokenInput("captchaToken").dataset.captchaReady).toBe("true");
  });

  it("passes the Cloudflare action and the requested appearance to the widget", async () => {
    renderWithI18n(<TurnstileWidget action="phone-sign-up-session" appearance="interaction-only" />);
    await flush();
    expect(renders[0]).toMatchObject({ action: "phone-sign-up-session", appearance: "interaction-only" });
  });

  it("defaults to the visible widget (a challenge is never assumed to be invisible)", async () => {
    renderWithI18n(<TurnstileWidget action="sign-up" />);
    await flush();
    expect(renders[0]!.appearance).toBe("always");
  });

  it("supports TWO independent tokens in one form, each in its own field", async () => {
    renderWithI18n(
      <form>
        <TurnstileWidget name="captchaToken" action="phone-sign-up" />
        <TurnstileWidget name="captchaSessionToken" action="phone-sign-up-session" appearance="interaction-only" />
      </form>,
    );
    await flush();
    expect(renders).toHaveLength(2);
    act(() => renders[0]!.callback("token-a"));
    act(() => renders[1]!.callback("token-b"));
    expect(tokenInput("captchaToken").value).toBe("token-a");
    expect(tokenInput("captchaSessionToken").value).toBe("token-b");
  });

  it.each(["expired-callback", "timeout-callback"] as const)("clears the token on %s so a stale token is never submitted", async (event) => {
    renderWithI18n(<TurnstileWidget action="sign-in" appearance="interaction-only" />);
    await flush();
    act(() => renders[0]!.callback("soon-stale"));
    expect(tokenInput("captchaToken").value).toBe("soon-stale");
    act(() => renders[0]![event]!());
    expect(tokenInput("captchaToken").value).toBe("");
  });

  it("shows an actionable message when the challenge errors, without exposing a provider code", async () => {
    renderWithI18n(<TurnstileWidget action="sign-in" />);
    await flush();
    act(() => renders[0]!["error-callback"]!());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent ?? "").not.toMatch(/\d{6}/);
  });

  it("requests a fresh token (remounts) when resetKey changes - a spent token is never reused", async () => {
    function Harness() {
      const [round, setRound] = useState(1);
      return (
        <>
          <TurnstileWidget action="sign-up" resetKey={round} />
          <button type="button" onClick={() => setRound((n) => n + 1)}>
            submit-again
          </button>
        </>
      );
    }
    renderWithI18n(<Harness />);
    await flush();
    act(() => renders[0]!.callback("spent"));
    expect(tokenInput("captchaToken").value).toBe("spent");
    fireEvent.click(screen.getByRole("button", { name: "submit-again" }));
    await flush();
    expect(remove).toHaveBeenCalledWith("widget-1");
    expect(renders).toHaveLength(2);
    expect(tokenInput("captchaToken").value).toBe("");
  });

  describe("a submission made before the token exists", () => {
    function TokenForm({ onSubmit, widgets = ["captchaToken"] }: { onSubmit: (data: FormData) => void; widgets?: string[] }) {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(new FormData(event.currentTarget));
          }}
        >
          {widgets.map((name) => (
            <TurnstileWidget key={name} name={name} action="sign-in" appearance="interaction-only" />
          ))}
          <button type="submit">
            go
          </button>
        </form>
      );
    }

    it("is held, then replayed once the token arrives", async () => {
      const submitted = vi.fn();
      renderWithI18n(<TokenForm onSubmit={submitted} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      expect(submitted).not.toHaveBeenCalled();
      act(() => renders[0]!.callback("late-token"));
      expect(submitted).toHaveBeenCalledTimes(1);
      expect((submitted.mock.calls[0]![0] as FormData).get("captchaToken")).toBe("late-token");
    });

    it("is sent once even when clicked repeatedly while held", async () => {
      const submitted = vi.fn();
      renderWithI18n(<TokenForm onSubmit={submitted} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      act(() => renders[0]!.callback("late-token"));
      expect(submitted).toHaveBeenCalledTimes(1);
    });

    it("waits for EVERY widget in the form before it is sent", async () => {
      const submitted = vi.fn();
      renderWithI18n(<TokenForm onSubmit={submitted} widgets={["captchaToken", "captchaSessionToken"]} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      act(() => renders[1]!.callback("token-b"));
      expect(submitted).not.toHaveBeenCalled();
      act(() => renders[0]!.callback("token-a"));
      expect(submitted).toHaveBeenCalledTimes(1);
      const data = submitted.mock.calls[0]![0] as FormData;
      expect([data.get("captchaToken"), data.get("captchaSessionToken")]).toEqual(["token-a", "token-b"]);
    });

    it("goes through immediately when a token is already present", async () => {
      const submitted = vi.fn();
      renderWithI18n(<TokenForm onSubmit={submitted} />);
      await flush();
      act(() => renders[0]!.callback("ready"));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      expect(submitted).toHaveBeenCalledTimes(1);
    });

    it("goes through WITHOUT a token when the challenge errors, so the server refuses it with its own message", async () => {
      const submitted = vi.fn();
      renderWithI18n(<TokenForm onSubmit={submitted} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      act(() => renders[0]!["error-callback"]!());
      expect(submitted).toHaveBeenCalledTimes(1);
      expect((submitted.mock.calls[0]![0] as FormData).get("captchaToken")).toBe("");
    });

    it("goes through WITHOUT a token when no token arrives in time", async () => {
      vi.useFakeTimers();
      try {
        const submitted = vi.fn();
        renderWithI18n(<TokenForm onSubmit={submitted} />);
        await flush();
        fireEvent.click(screen.getByRole("button", { name: "go" }));
        act(() => vi.advanceTimersByTime(PENDING_SUBMIT_TIMEOUT_MS - 1));
        expect(submitted).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(submitted).toHaveBeenCalledTimes(1);
        expect((submitted.mock.calls[0]![0] as FormData).get("captchaToken")).toBe("");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
