import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("swaps to initials when the image fails and retries on a new src", async () => {
    const { rerender } = render(<MediaAvatar src="/missing.webp" name="Mona" testId="av" />);
    fireEvent.error(screen.getByTestId("av"));
    await waitFor(() => expect(screen.getByTestId("av-fallback")).toBeInTheDocument());
    rerender(<MediaAvatar src="/fresh.webp" name="Mona" testId="av" />);
    expect(screen.getByTestId("av")).toHaveAttribute("src", "/fresh.webp");
  });
});

describe("other fallbacks", () => {
  it("cover falls back to a neutral panel on error", async () => {
    render(<MediaCover src="/p/cover/1" />);
    fireEvent.error(document.querySelector("img")!);
    expect(await screen.findByTestId("media-cover-fallback")).toBeInTheDocument();
  });
  it("logo falls back to a glyph without a src", () => {
    render(<MediaLogo src={undefined} />);
    expect(screen.getByTestId("media-logo-fallback")).toBeInTheDocument();
  });
  it("thumb renders no broken image after an error", async () => {
    const { container } = render(<MediaThumb src="/gone.webp" />);
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(container.querySelector("img")).toBeNull());
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("empty media shows its message", () => {
    render(<EmptyMedia>No work yet</EmptyMedia>);
    expect(screen.getByTestId("empty-media")).toHaveTextContent("No work yet");
  });
});

describe("SafeImage", () => {
  it("shows the fallback when a plain URL fails and the refresh declines", async () => {
    const refresh = vi.fn().mockResolvedValue(null);
    render(<SafeImage src="/a.webp" alt="" fallback={<i data-testid="fb" />} refresh={refresh} />);
    fireEvent.error(document.querySelector("img")!);
    await waitFor(() => expect(screen.getByTestId("fb")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("retries once with a fresh URL when the server re-authorizes an expired one", async () => {
    const refresh = vi.fn().mockResolvedValue("https://edge.test/m/avatar/original?t=new");
    render(<SafeImage src="https://edge.test/m/avatar/original?t=old" srcSet="a 1x" alt="" data-testid="im" fallback={<i data-testid="fb" />} refresh={refresh} />);
    fireEvent.error(screen.getByTestId("im"));
    await waitFor(() => expect(screen.getByTestId("im")).toHaveAttribute("src", "https://edge.test/m/avatar/original?t=new"));
    expect(screen.getByTestId("im")).not.toHaveAttribute("srcset");
    // a second failure does not loop
    fireEvent.error(screen.getByTestId("im"));
    expect(screen.getByTestId("fb")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats a refresh that throws as unavailable", async () => {
    render(<SafeImage src="/a.webp" alt="" fallback={<i data-testid="fb" />} refresh={() => Promise.reject(new Error("offline"))} />);
    fireEvent.error(document.querySelector("img")!);
    await waitFor(() => expect(screen.getByTestId("fb")).toBeInTheDocument());
  });
});

describe("SafeImage pre-hydration failure", () => {
  it("falls back when the image already failed before React attached", async () => {
    const spy = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    render(<SafeImage src="/gone.webp" alt="" fallback={<i data-testid="fb" />} />);
    expect(await screen.findByTestId("fb")).toBeInTheDocument();
    spy.mockRestore();
  });
});
