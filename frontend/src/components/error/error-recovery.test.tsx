import { renderToStaticMarkup } from "react-dom/server";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorRecovery } from "./error-recovery";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/globals.css", () => ({}));

/** The kind of text a Postgres / PostgREST failure carries - none of it may ever reach the screen. */
const SECRET_MESSAGE =
  'permission denied for function job_opportunities_page; PGRST202 Could not find the function public.job_opportunities_page; select * from public.saved_jobs where user_id = "9a1c"';

function serverError(withDigest = true): Error & { digest?: string } {
  const error = new Error(SECRET_MESSAGE) as Error & { digest?: string };
  error.name = "PostgrestError";
  if (withDigest) error.digest = "2418803267";
  return error;
}

function setCookies(cookies: string[]) {
  for (const c of cookies) document.cookie = /;\s*path=/.test(c) ? c : `${c}; path=/`;
}
function clearCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const name of ["NEXT_LOCALE", "aladdin-theme", "sb-access-token", "sb-refresh-token"]) clearCookie(name);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  router.refresh.mockClear();
});
afterEach(() => {
  consoleError.mockRestore();
  for (const name of ["NEXT_LOCALE", "aladdin-theme", "sb-access-token", "sb-refresh-token"]) clearCookie(name);
});

describe("ErrorRecovery (the shared Aladdin recovery screen)", () => {
  it("is a branded, Arabic-first recovery screen with a Retry action and a safe way home", () => {
    render(<ErrorRecovery error={serverError()} scope="app" onRetry={() => {}} />);
    const screenEl = screen.getByTestId("aladdin-error-boundary");
    expect(screenEl).toHaveAttribute("role", "alert");
    expect(screenEl).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("علاء الدين")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "واجهتنا مشكلة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "الرئيسية" })).toHaveAttribute("href", "/");
  });

  it("switches to English and left-to-right from the locale cookie", () => {
    setCookies(["NEXT_LOCALE=en"]);
    render(<ErrorRecovery error={serverError()} scope="app" onRetry={() => {}} />);
    expect(screen.getByTestId("aladdin-error-boundary")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("Aladdin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "We hit a problem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("never shows the raw error: no SQL, PostgREST or Supabase text, in either language", () => {
    for (const cookie of ["NEXT_LOCALE=en", "NEXT_LOCALE=ar"]) {
      setCookies([cookie]);
      const { container, unmount } = render(<ErrorRecovery error={serverError()} scope="app" onRetry={() => {}} />);
      const html = container.innerHTML;
      for (const leak of ["permission denied", "PGRST202", "job_opportunities_page", "saved_jobs", "select *", "9a1c", "PostgrestError"]) {
        expect(html, `leaked "${leak}"`).not.toContain(leak);
      }
      unmount();
    }
  });

  it("shows the opaque digest as a support reference, and omits the line when there is none", () => {
    const { unmount } = render(<ErrorRecovery error={serverError()} scope="app" onRetry={() => {}} />);
    expect(screen.getByTestId("aladdin-error-digest")).toHaveTextContent("2418803267");
    unmount();
    render(<ErrorRecovery error={serverError(false)} scope="app" onRetry={() => {}} />);
    expect(screen.queryByTestId("aladdin-error-digest")).toBeNull();
  });

  it("logs only the error's name and digest - never its message", () => {
    render(<ErrorRecovery error={serverError()} scope="app" onRetry={() => {}} />);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, payload] = consoleError.mock.calls[0]!;
    expect(label).toBe("[app] route error");
    expect(payload).toEqual({ name: "PostgrestError", digest: "2418803267" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("permission denied");
  });

  it("does not retry by itself and does not hide the failure behind empty content", () => {
    const onRetry = vi.fn();
    render(<ErrorRecovery error={serverError()} scope="app" onRetry={onRetry} />);
    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the session: it reads cookies but never writes or clears any", () => {
    setCookies(["sb-access-token=abc; path=/", "sb-refresh-token=def; path=/", "NEXT_LOCALE=en"]);
    const before = document.cookie;
    render(<ErrorRecovery error={serverError()} scope="app" onRetry={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(document.cookie).toBe(before);
    expect(document.cookie).toContain("sb-access-token=abc");
    expect(document.cookie).toContain("sb-refresh-token=def");
  });
});

describe("app/error.tsx (root segment boundary)", () => {
  it("Retry refreshes the server data and resets the boundary", async () => {
    const reset = vi.fn();
    render(<AppError error={serverError()} reset={reset} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("app/global-error.tsx (root layout failure)", () => {
  it("renders its own <html> and <body>, as Next.js requires, with locale direction", () => {
    const markup = renderToStaticMarkup(<GlobalError error={serverError()} />);
    expect(markup.startsWith("<html")).toBe(true);
    expect(markup).toContain("<head>");
    expect(markup).toContain("<body");
    expect(markup).toMatch(/<html[^>]*lang="ar"/);
    expect(markup).toMatch(/<html[^>]*dir="rtl"/);
    expect(markup).toContain('data-testid="aladdin-error-boundary"');
    expect(markup).toContain("data-theme-pref=\"system\"");
  });

  it("carries the pre-paint theme script so a dark-mode user does not get a white flash", () => {
    const markup = renderToStaticMarkup(<GlobalError error={serverError()} />);
    expect(markup).toContain("prefers-color-scheme: dark");
  });

  it("never renders the raw error message", () => {
    const markup = renderToStaticMarkup(<GlobalError error={serverError()} />);
    for (const leak of ["permission denied", "PGRST202", "job_opportunities_page", "select *"]) {
      expect(markup).not.toContain(leak);
    }
    expect(markup).toContain("2418803267");
  });
});
