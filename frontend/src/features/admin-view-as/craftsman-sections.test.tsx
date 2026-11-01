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
  display_name: "Sayed Abdel-Rahman", username: "sayed", phone: "+201000000001", phone_verified: true, secondary_phone_masked: "•••999",
  has_avatar: true, has_cover: false, account_status: "suspended", public_profile_status: "hidden", years_experience: 8, availability: "full_time",
  trades: [{ key: "tiling", is_primary: true }], service_areas: [{ governorate: "cairo", city: "new_cairo", is_primary: true }],
  completion: { percent: 60, missing: ["portfolio"] }, bio: "Tiler.",
});
const portfolio = parsePortfolio({
  projects: [{ id: "p", title: "Villa kitchen", items: [{ id: "i", kind: "image" }, { id: "v", kind: "video" }] }],
  certificates: [{ id: "c", title: "Electrical safety", issuer: "Board", kind: "pdf" }],
});

describe("craftsman read-only sections", () => {
  it("dashboard shows the subject's numbers", () => {
    wrap(<DashboardSection data={parseDashboard({ work_counts: { completed: 3, in_progress: 1 }, points: { balance: 120, month_earned: 20 }, reviews: { total: 2, average: 4.5 }, completion: { percent: 50, missing: [] } })} />);
    expect(screen.getByText("Points balance")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
  });

  it("profile shows primary phone, MASKS the secondary, and never renders media (placeholder only)", () => {
    const { container } = wrap(<ProfileSection data={profile} />);
    expect(screen.getByText("+201000000001")).toBeTruthy();
    expect(screen.getByText("•••999")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\+201000000999/);
    expect(container.querySelector("img, video, source")).toBeNull();
    expect(screen.getAllByRole("img", { name: /Profile photo|Private file/ }).length).toBeGreaterThan(0);
  });

  it("portfolio WITHOUT private-media links (delivery off) lists details + placeholders, never <img>/<video>/<a href=file>", () => {
    const { container } = wrap(<PortfolioSection data={portfolio} />);
    expect(screen.getByText("Villa kitchen")).toBeTruthy();
    expect(screen.getByText("Electrical safety")).toBeTruthy();
    expect(container.querySelector("img, video, source, iframe, embed, object, a[href]")).toBeNull();
    expect(screen.getAllByRole("img").length).toBe(3); // the neutral placeholders (role=img divs), one per file
    expect(screen.getByText(/not displayed in View-As yet/)).toBeTruthy();
  });

  it("portfolio WITH authorized links shows the image and a document link; the video stays a placeholder; no storage key is rendered", () => {
    const media = { i: "https://media.example.test/a/portfolio_item/original?t=T1", c: "https://media.example.test/a/certificate/original?t=T2" };
    const { container } = wrap(<PortfolioSection data={portfolio} media={media} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(media.i);
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.querySelectorAll("img").length).toBe(1); // the certificate is a pdf: a link, not an image
    const link = container.querySelector("a[href]")!;
    expect(link.getAttribute("href")).toBe(media.c);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("video, source, iframe, embed, object")).toBeNull();
    expect(screen.getAllByRole("img", { name: /Private file/ }).length).toBe(2); // the video and the pdf's file icon (its link sits beside it)
    expect(container.innerHTML).not.toMatch(/object_key|object_path|\.(jpg|png|pdf)["'?]/i);
    expect(screen.getByText(/short-lived, audited link/)).toBeTruthy();
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
      <DashboardSection key="d" data={parseDashboard({})} />, <ProfileSection key="p" data={profile} />, <PortfolioSection key="o" data={portfolio} />,
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
