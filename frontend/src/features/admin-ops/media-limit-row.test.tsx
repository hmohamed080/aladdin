import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { MediaLimitRow } from "./media-limit-row";

vi.mock("@/server/actions/media-limits", () => ({ saveMediaLimitAction: vi.fn(async () => ({ ok: true, code: "mediaLimits.saved" })) }));

const props = { kind: "image" as const, place: "marketplace", label: "Marketplace photos and payment proofs", currentMb: "10 MB", defaultMb: "10 MB", ceilingMb: "25 MB", floorMb: "100 KB", changedLabel: null };

describe("MediaLimitRow", () => {
  it("shows the limit now, the default and the hard ceiling, and posts the place with the typed value and the reason", () => {
    const { container } = renderWithI18n(<MediaLimitRow {...props} />, "en");
    expect(screen.getByText("Marketplace photos and payment proofs")).toBeTruthy();
    expect(container.textContent).toContain("10 MB");
    expect(container.textContent).toContain("25 MB");
    const form = screen.getByTestId("media-limit-image-marketplace");
    expect((form.querySelector('input[name="kind"]') as HTMLInputElement).value).toBe("image");
    expect((form.querySelector('input[name="place"]') as HTMLInputElement).value).toBe("marketplace");
    const megabytes = form.querySelector('input[name="megabytes"]') as HTMLInputElement;
    expect(megabytes.required).toBe(true);
    expect(megabytes.getAttribute("inputmode")).toBe("decimal");
    expect(megabytes.getAttribute("dir")).toBe("ltr");
    const reason = form.querySelector('input[name="reason"]') as HTMLInputElement;
    expect(reason.required).toBe(true);
    expect(reason.minLength).toBe(3);
    expect(reason.maxLength).toBe(500);
  });

  it("says when the limit last changed, and gives the inputs accessible names", () => {
    renderWithI18n(<MediaLimitRow {...props} changedLabel="Last changed today" />, "en");
    expect(screen.getByText("Last changed today")).toBeTruthy();
    expect(screen.getByLabelText("New limit (MB)")).toBeTruthy();
    expect(screen.getByLabelText("Reason")).toBeTruthy();
  });
});
