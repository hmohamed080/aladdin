import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyMedia, initialOf, MediaAvatar, MediaCover, MediaLogo, MediaThumb } from "./media-fallbacks";
import { SafeImage } from "./safe-image";

describe("initialOf", () => {
  it("uppercases the first character, handles Arabic and empty names", () => {
    expect(initialOf("  ahmed")).toBe("A");
    expect(initialOf("سارة")).toBe("س");
    expect(initialOf("")).toBe("?");
    expect(initialOf(null)).toBe("?");
  });
});

describe("MediaAvatar", () => {
  it("shows initials when there is no picture", () => {
    render(<MediaAvatar src={null} name="Mona" testId="av" />);
    expect(screen.getByTestId("av-fallback")).toHaveTextContent("M");
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows the image while it loads", () => {
    render(<MediaAvatar src="/x.webp" name="Mona" testId="av" />);
    expect(screen.getByTestId("av")).toHaveAttribute("src", "/x.webp");
  });

  it("swaps to initials when the image fails and retries on a new src", () => {
    const { rerender } = render(<MediaAvatar src="/missing.webp" name="Mona" testId="av" />);
    fireEvent.error(screen.getByTestId("av"));
    expect(screen.getByTestId("av-fallback")).toBeInTheDocument();
    rerender(<MediaAvatar src="/fresh.webp" name="Mona" testId="av" />);
    expect(screen.getByTestId("av")).toHaveAttribute("src", "/fresh.webp");
  });
});

describe("other fallbacks", () => {
  it("cover falls back to a neutral panel on error", () => {
    render(<MediaCover src="/p/cover/1" />);
    fireEvent.error(document.querySelector("img")!);
    expect(screen.getByTestId("media-cover-fallback")).toBeInTheDocument();
  });
  it("logo falls back to a glyph without a src", () => {
    render(<MediaLogo src={undefined} />);
    expect(screen.getByTestId("media-logo-fallback")).toBeInTheDocument();
  });
  it("thumb renders no broken image after an error", () => {
    const { container } = render(<MediaThumb src="/gone.webp" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("empty media shows its message", () => {
    render(<EmptyMedia>No work yet</EmptyMedia>);
    expect(screen.getByTestId("empty-media")).toHaveTextContent("No work yet");
  });
});

describe("SafeImage", () => {
  it("reports each failing src once through onFail", () => {
    const onFail = vi.fn();
    render(<SafeImage src="/a.webp" alt="" fallback={<i data-testid="fb" />} onFail={onFail} />);
    fireEvent.error(document.querySelector("img")!);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fb")).toBeInTheDocument();
  });
});

describe("SafeImage pre-hydration failure", () => {
  it("falls back when the image already failed before React attached", () => {
    const spy = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    render(<SafeImage src="/gone.webp" alt="" fallback={<i data-testid="fb" />} />);
    expect(screen.getByTestId("fb")).toBeInTheDocument();
    spy.mockRestore();
  });
});
