// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";
import config from "../../../next.config";
import { MediaImage } from "@/features/portfolio/media-frame";
import { PublicPortfolio } from "@/features/profile/public-portfolio";
import { ProductMedia } from "@/features/commerce/product-media";
import type { MediaSource } from "@/lib/media/image-variants";

it("rejects revocable media from the actual installed Next optimizer matcher", () => {
  for (const url of ["/api/media/portfolio?key=x.png", "/api/media/certificate?key=x.pdf", "/p/media/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "/brand/../p/media/x"]) {
    expect(hasLocalMatch(config.images?.localPatterns, url)).toBe(false);
  }
});
it("preserves every existing static asset directory and build image imports", () => {
  for (const url of ["/brand/mark.png", "/assets/logo.png", "/demo/photo.png", "/images/showroom/products/my-products-hero-light.png", "/installer-auth/hero.png", "/landing-v2/hero.png", "/preview/photo.png", "/_next/static/media/hash.png"]) {
    expect(hasLocalMatch(config.images?.localPatterns, url)).toBe(true);
  }
});
it("never lets the optimizer fetch from a media edge host or a storage provider", () => {
  for (const url of ["https://media.example.com/c/portfolio/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/card.webp",
    "https://media.example.com/m/product/x?t=ticket", "https://acct.r2.cloudflarestorage.com/bucket/v/portfolio/k/card.webp",
    "https://project.supabase.co/storage/v1/object/sign/avatars/x.jpg?token=t"]) {
    expect(hasRemoteMatch(config.images?.domains ?? [], config.images?.remotePatterns ?? [], new URL(url))).toBe(false);
  }
});

const ITEM = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VARIANTS: MediaSource = { src: `/p/media/${ITEM}`, variants: {
  thumb: `https://media.example.com/c/portfolio/${ITEM}/thumb.webp`,
  card: `https://media.example.com/c/portfolio/${ITEM}/card.webp`,
  full: `https://media.example.com/c/portfolio/${ITEM}/full.webp`,
} };
const t = (key: string) => key;
const snapshot = (img: Element) => ({ src: img.getAttribute("src"), srcset: img.getAttribute("srcset") });
const CACHE_BUSTERS = /[?&](t|v|ts|_|cb|cache|nocache|rand)=/;

describe("stable media URLs across re-renders", () => {
  it("renders the same public portfolio URL every time, lazily, with an intrinsic size", () => {
    const items = [{ id: ITEM, title: "Kitchen", description: null }];
    const view = render(createElement(PublicPortfolio, { items, t: t as never }));
    const first = snapshot(view.getByRole("img"));
    view.rerender(createElement(PublicPortfolio, { items: items.map((i) => ({ ...i })), t: t as never }));
    view.rerender(createElement(PublicPortfolio, { items, t: t as never }));
    const img = view.getByRole("img") as HTMLImageElement;
    expect(snapshot(img)).toEqual(first);
    expect(first.src).toBe(`/p/media/${ITEM}`);
    expect(first.src).not.toMatch(CACHE_BUSTERS);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("width")).toBeTruthy();
    expect(img.getAttribute("height")).toBeTruthy();
  });

  it("offers only thumb/card in grids, full only in detail, and keeps them identical on rerender", () => {
    const grid = render(createElement(MediaImage, { source: VARIANTS, alt: "" }));
    const before = snapshot(grid.container.querySelector("img")!);
    grid.rerender(createElement(MediaImage, { source: { ...VARIANTS, variants: { ...VARIANTS.variants } }, alt: "" }));
    expect(snapshot(grid.container.querySelector("img")!)).toEqual(before);
    expect(before.srcset).toBe(`${VARIANTS.variants!.thumb} 320w, ${VARIANTS.variants!.card} 768w`);
    expect(before.src).toBe(VARIANTS.variants!.card);
    expect(before.srcset).not.toContain("full.webp");
    expect(grid.container.querySelector("img")!.getAttribute("sizes")).toContain("33vw");

    const detail = render(createElement(MediaImage, { source: VARIANTS, alt: "", use: "detail", priority: true }));
    const img = detail.container.querySelector("img")!;
    expect(img.getAttribute("srcset")).toContain("full.webp 1600w");
    expect(img.getAttribute("srcset")).not.toContain("thumb.webp");
    expect(img.getAttribute("loading")).toBe("eager");
  });

  it("falls back to the exact original URL, with no srcset, when no variants exist", () => {
    const view = render(createElement(MediaImage, { source: { src: "/api/media/portfolio?key=k.jpg" }, alt: "" }));
    const img = view.container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/media/portfolio?key=k.jpg");
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.hasAttribute("sizes")).toBe(false);
  });

  it("keeps ProductMedia's URL stable across re-renders and uses variants for cards", () => {
    const props = { src: "/api/media/product?key=k.webp&workspace=w", alt: "Tile", variants: VARIANTS.variants };
    const view = render(createElement(ProductMedia, props));
    const first = snapshot(view.getByRole("img"));
    view.rerender(createElement(ProductMedia, { ...props, variants: { ...props.variants } }));
    expect(snapshot(view.getByRole("img"))).toEqual(first);
    expect(first.srcset).toContain("thumb.webp 320w");
    expect(first.src).not.toMatch(CACHE_BUSTERS);
    const plain = render(createElement(ProductMedia, { src: props.src, alt: "Tile" }));
    expect(plain.getAllByRole("img").at(-1)!.getAttribute("src")).toBe(props.src);
  });
});
