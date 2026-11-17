import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users/u1/view/work" }));
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { parseDashboard, parsePoints, parsePortfolio, parseProfile, parseReviews, parseWork } from "@/lib/admin/view-as/craftsman-data";
import { DashboardSection, PointsSection, PortfolioSection, ProfileSection, ReviewsSection, ViewAsNav, WorkSection } from "./craftsman-sections";

const wrap = (node: React.ReactNode, locale: "en" | "ar" = "en") =>
  render(<I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{node}</I18nProvider>);
afterEach(cleanup);

const profile = parseProfile({
  display_name: "Sayed Abdel-Rahman", phone: "+201000000001", phone_verified: true, secondary_phone_masked: "•••999",
  has_avatar: true, avatar_id: "a1000000-0000-4000-8000-000000000001", has_cover: false, account_status: "suspended", public_profile_status: "hidden", years_experience: 8, availability: "full_time",
  trades: [{ key: "tiling", is_primary: true }], service_areas: [{ governorate: "cairo", city: "new_cairo", is_primary: true }],
  completion: { percent: 60, missing: ["portfolio"] }, bio: "Tiler.",
});
const portfolio = parsePortfolio({
  projects: [{ id: "p", title: "Villa kitchen", items: [
    { id: "d1000000-0000-4000-8000-000000000001", kind: "image", state: "ready" },
    { id: "d2000000-0000-4000-8000-000000000002", kind: "image", state: "pending" },
    { id: "v", kind: "video", state: "ready" },
  ] }],
  certificates: [
    { id: "c1000000-0000-4000-8000-000000000001", title: "Electrical safety", issuer: "Board", kind: "pdf", state: "ready" },
    { id: "c3000000-0000-4000-8000-000000000003", title: "Scanned diploma", issuer: "Board", kind: "image", state: "ready" },
    { id: "c4000000-0000-4000-8000-000000000004", title: "Pending PDF", issuer: "Board", kind: "pdf", state: "pending" },
  ],
});
const BASE = "/admin/users/u1/view/media";

describe("craftsman read-only sections", () => {
  it("dashboard shows the subject's numbers", () => {
    wrap(<DashboardSection data={parseDashboard({ work_counts: { completed: 3, in_progress: 1 }, points: { balance: 120, month_earned: 20 }, reviews: { total: 2, average: 4.5 }, completion: { percent: 50, missing: [] } })} />);
    expect(screen.getByText("Points balance")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
  });

  it("profile shows primary phone, MASKS the secondary, and shows the avatar only through the view's media route (opaque id)", () => {
    const { container } = wrap(<ProfileSection userId="u1" data={profile} />);
    expect(screen.getByText("+201000000001")).toBeTruthy();
    expect(screen.getByText("•••999")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\+201000000999/);
    expect(container.querySelector("video, source, iframe")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`${BASE}/avatar/a1000000-0000-4000-8000-000000000001`);
    expect(img?.getAttribute("referrerpolicy")).toBe("same-origin");
  });

  it("profile without an avatar keeps the neutral placeholder (no <img>)", () => {
    const { container } = wrap(<ProfileSection userId="u1" data={{ ...profile, avatarId: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByRole("img", { name: /Profile photo/ }).length).toBe(1);
  });

  it("portfolio: ready images and certificates load through the media route; videos, pending files keep the placeholder; a PDF is a link, never embedded", () => {
    const { container } = wrap(<PortfolioSection userId="u1" data={portfolio} />);
    expect(screen.getByText("Villa kitchen")).toBeTruthy();
    expect(screen.getByText("Electrical safety")).toBeTruthy();
    expect(container.querySelector("video, source, iframe, embed, object")).toBeNull();
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs.sort()).toEqual([
      `${BASE}/certificate/c3000000-0000-4000-8000-000000000003`,
      `${BASE}/portfolio/d1000000-0000-4000-8000-000000000001`,
    ]);
    const links = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([`${BASE}/certificate/c1000000-0000-4000-8000-000000000001`]);
    expect(container.querySelector("a[href]")?.getAttribute("rel")).toBe("noreferrer");
    // the video, the pending image, the pending PDF and the (link-only) ready PDF show the neutral tile
    expect(screen.getAllByRole("img", { name: "Private file — not shown in this view" }).length).toBe(4);
  });

  it("no storage key, bucket path, file extension or signed URL appears anywhere in the rendered markup", () => {
    const { container } = wrap(<PortfolioSection userId="u1" data={portfolio} />);
    expect(container.innerHTML).not.toMatch(/\.(jpe?g|png|webp|pdf)|token=|X-Amz|supabase|r2\.|\/storage\//i);
  });

  it("work, points and reviews render the subject's rows", () => {
    wrap(<WorkSection data={parseWork({ counts: { completed: 1 }, items: [{ id: "a", status: "completed", job_title: "Marble staircase", company: "Horizon", agreed_amount: 9000 }] })} />);
    expect(screen.getByText("Marble staircase")).toBeTruthy();
    cleanup();
    wrap(<PointsSection data={parsePoints({ balance: 100, entry_count: 1, entries: [{ id: "e", event_type: "referral.organization_approved", points_delta: 100, created_at: "2026-10-01T00:00:00Z" }] })} />);
    expect(screen.getByText("referral.organization_approved")).toBeTruthy();
    cleanup();
    wrap(<ReviewsSection data={parseReviews({ total: 1, average: 5, monthly: [], items: [{ id: "r", rating: 5, comment: "Excellent finish", company: "Horizon" }] })} />);
    expect(screen.getByText("Excellent finish")).toBeTruthy();
  });

  it("renders every section in Arabic without throwing", () => {
    for (const node of [
      <DashboardSection key="d" data={parseDashboard({})} />, <ProfileSection key="p" userId="u1" data={profile} />, <PortfolioSection key="o" userId="u1" data={portfolio} />,
      <WorkSection key="w" data={parseWork({})} />, <PointsSection key="s" data={parsePoints({})} />, <ReviewsSection key="r" data={parseReviews({})} />,
    ]) {
      wrap(node, "ar");
      cleanup();
    }
  });

  it("navigation: six sections, every link stays under the view base path, current page marked", () => {
    const { container } = wrap(<ViewAsNav userId="u1" kind="craftsman" />);
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(6);
    for (const a of links) expect(a.getAttribute("href")).toMatch(/^\/admin\/users\/u1\/view(\/|$)/);
    expect(links.some((a) => /^\/home/.test(a.getAttribute("href") ?? ""))).toBe(false);
    expect(screen.getByRole("link", { name: "Work" }).getAttribute("aria-current")).toBe("page");
  });

  it("empty subjects say so plainly", () => {
    wrap(<WorkSection data={parseWork({})} />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });
});
