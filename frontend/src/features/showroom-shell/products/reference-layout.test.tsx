import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { PackageIcon } from "@/components/ui/icons";
import { ShowroomPageHero } from "@/features/showroom-shell/page-hero";
import { ProductStatCards } from "./stat-cards";
import { CategoryChips } from "./category-chips";

const wrap = (node: React.ReactNode) => render(<I18nProvider locale="en" dir="ltr">{node}</I18nProvider>);

describe("page hero", () => {
  it("shows the title block without any artwork when none has been supplied (no stand-in image)", () => {
    wrap(<ShowroomPageHero locale="en" title="My products" subtitle="Subtitle" Icon={PackageIcon} />);
    expect(screen.getByRole("heading", { level: 1, name: "My products" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders light and dark artwork variants when supplied, hidden from assistive tech", () => {
    const { container } = wrap(<ShowroomPageHero locale="ar" title="منتجاتي" art={{ light: "/assets/a-light.png", dark: "/assets/a-dark.png" }} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("[aria-hidden=true]")).toBeTruthy();
    expect(screen.getByTestId("page-hero").getAttribute("aria-labelledby")).toBe("page-title");
  });
});

describe("stat cards", () => {
  const stats = [
    { key: "total", label: "Total products", value: "12", href: "/x", active: true, viewAll: "View all", Icon: PackageIcon },
    { key: "active", label: "Active products", value: "7", href: "/x?status=active", active: false, viewAll: "View all", Icon: PackageIcon },
  ];

  it("shows each figure with its label and a View all link that is also the status filter", () => {
    wrap(<ProductStatCards stats={stats} />);
    const active = screen.getByTestId("stat-active");
    expect(within(active).getByText("7")).toBeTruthy();
    expect(within(active).getByText("Active products")).toBeTruthy();
    expect(active.getAttribute("href")).toBe("/x?status=active");
    expect(screen.getByTestId("stat-total").getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("aria-current")).toBeNull();
  });
});

describe("category chips", () => {
  it("is a labelled navigation with the selected chip marked", () => {
    wrap(<CategoryChips label="Category" selected="paints" hrefFor={(v) => `/p?category=${v}`} chips={[{ value: "", label: "All" }, { value: "paints", label: "Paints" }]} />);
    const nav = screen.getByRole("navigation", { name: "Category" });
    expect(within(nav).getByRole("link", { name: "Paints" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "All" }).getAttribute("href")).toBe("/p?category=");
  });
});
