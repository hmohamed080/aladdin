import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const ID = "70000009-0000-4000-8000-000000000009";
const requireViewAs = vi.fn();
vi.mock("@/server/view-as/guard", () => ({ requireViewAs }));
const shellData = vi.fn();
vi.mock("@/server/view-as/account-reader", () => ({ viewAsReader: () => ({ shell: shellData }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => `/view-as/${ID}`, useRouter: () => ({ push: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
const startInterim = vi.fn();
vi.mock("@/app/admin/users/[id]/view/start/route", () => ({ POST: startInterim }));

const { default: ViewAsLayout } = await import("./[id]/layout");
const { POST: startExact } = await import("./[id]/start/route");

beforeEach(() => {
  requireViewAs.mockReset();
  requireViewAs.mockResolvedValue({
    sessionId: "s1",
    kind: "craftsman",
    subjectUserId: ID,
    subjectName: "Ahmed Sobhy",
    startedAt: "2026-11-15T10:00:00Z",
    expiresAt: "2099-11-15T10:30:00Z",
  });
  shellData.mockReset();
  shellData.mockResolvedValue({ displayName: "Ahmed Sobhy", avatarUrl: null, location: "Cairo", searchJobs: [] });
});
afterEach(cleanup);

describe("/view-as/[id] layout", () => {
  it("calls requireViewAs(id) first, then renders the banner above the real shell with the subject's identity", async () => {
    const el = await ViewAsLayout({ children: <p>page body</p>, params: Promise.resolve({ id: ID }) });
    expect(requireViewAs).toHaveBeenCalledWith(ID);
    const { container } = render(el);
    const banner = container.querySelector('[data-view-as-tree="exact"]')!;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Ahmed Sobhy");
    expect(container.querySelector(".installer-surface")).toBeTruthy();
    // banner comes BEFORE the shell in the document, and is not inside it
    expect(banner.compareDocumentPosition(container.querySelector(".installer-surface")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".installer-surface")!.contains(banner)).toBe(false);
    expect(container.querySelector("fieldset[data-view-as-read-only]")!.textContent).toContain("page body");
    expect([...container.querySelectorAll("a[href]")].filter((a) => a.getAttribute("href")!.startsWith("/home"))).toEqual([]);
    expect(container.querySelector("form[action='/view-as/" + ID + "/exit']")).toBeTruthy();
  });

  it("shows no Admin console chrome", async () => {
    const { container } = render(await ViewAsLayout({ children: <p>x</p>, params: Promise.resolve({ id: ID }) }));
    expect(container.querySelector("[data-admin-sidebar], nav[aria-label*='Admin' i]")).toBeNull();
    expect([...container.querySelectorAll("a[href]")].filter((a) => a.getAttribute("href")!.startsWith("/admin"))).toEqual([]);
  });

  it("does not render anything when the guard refuses (it throws / redirects)", async () => {
    requireViewAs.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(ViewAsLayout({ children: null, params: Promise.resolve({ id: ID }) })).rejects.toThrow();
    expect(shellData).not.toHaveBeenCalled();
  });
});

describe("/view-as/[id]/start mirrors the interim start and lands on the exact view", () => {
  it("rewrites only the redirect target", async () => {
    startInterim.mockResolvedValue(new Response(null, { status: 303, headers: { location: `https://app.example/admin/users/${ID}/view` } }));
    const res = await startExact(new NextRequest(`https://app.example/view-as/${ID}/start`, { method: "POST" }), { params: Promise.resolve({ id: ID }) });
    expect(res.headers.get("location")).toBe(`https://app.example/view-as/${ID}`);
  });

  it("passes a refusal through untouched", async () => {
    startInterim.mockResolvedValue(new Response(null, { status: 404 }));
    const res = await startExact(new NextRequest(`https://app.example/view-as/${ID}/start`, { method: "POST" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
  });
});

/* ---- import graph: the view tree reaches server actions only through the real shell, never directly ---- */
const SRC = path.resolve(__dirname, "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);

describe("view-tree import graph", () => {
  const files = [
    ...walk(path.join(SRC, "app/view-as")),
    ...walk(path.join(SRC, "server/view-as")),
    ...walk(path.join(SRC, "features/admin-view-as")),
    path.join(SRC, "components/navigation/scoped-link.tsx"),
    path.join(SRC, "lib/admin/view-as/link-scope.ts"),
  ].filter(isSource);

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(existsSync(f)).toBe(true);
  });

  it("never imports @/server/actions/** (nor declares 'use server') directly", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["']@\/server\/actions\//);
      expect(src, f).not.toMatch(/^\s*["']use server["']/m);
    }
  });

  it("never uses a service-role client and writes nothing through Supabase", () => {
    for (const f of files.filter((x) => !x.endsWith("read-only-client.ts"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/SERVICE_ROLE|createAdminClient|getAdminSupabase|admin-server/);
      expect(src, f).not.toMatch(/\.(insert|update|upsert)\s*\(/);
    }
  });

  it("every page and the layout re-establishes the gate", () => {
    for (const f of files.filter((x) => /\/(page|layout)\.tsx$/.test(x.replaceAll("\\", "/")) && x.replaceAll("\\", "/").includes("app/view-as"))) {
      expect(readFileSync(f, "utf8"), f).toMatch(/requireViewAs\(/);
      expect(readFileSync(f, "utf8"), f).toMatch(/export const dynamic = "force-dynamic"/);
    }
  });

  it("view pages never hard-code a /home href", () => {
    for (const f of files.filter((x) => x.replaceAll("\\", "/").includes("app/view-as"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/["'`]\/home(\/|["'`])/);
    }
  });
});
