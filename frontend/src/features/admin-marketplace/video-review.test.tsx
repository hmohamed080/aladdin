import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { VideoReviewCard, type ReviewVideo } from "./video-review";

const review = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/marketplace-video-review", () => ({ reviewVideoAction: (...a: unknown[]) => review(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/features/video/video-player", () => ({ VideoPlayer: ({ title }: { title: string }) => <div data-testid="player">{title}</div> }));

const video = (over: Partial<ReviewVideo> = {}): ReviewVideo => ({
  id: "v1", title: "Front view", state: "ready", reviewStatus: "pending", width: 1280, height: 720, reviewReason: null,
  playback: { id: "v1", title: "Front view", durationSeconds: 10, width: 1280, height: 720, hasPoster: true,
    src: "https://media.example/v/v1/master.m3u8", poster: null, access: "ticketed" },
  ...over,
});

beforeEach(() => {
  review.mockReset();
  refresh.mockReset();
  review.mockResolvedValue({ ok: true });
});

describe("VideoReviewCard", () => {
  it("plays the video and approves it", async () => {
    renderWithI18n(<VideoReviewCard video={video()} />);
    expect(screen.getByTestId("player")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith("v1", "approve", expect.anything()));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("rejects only with the reason and both messages, and shows the refusal otherwise", async () => {
    review.mockResolvedValueOnce({ ok: false, code: "reason_required" });
    renderWithI18n(<VideoReviewCard video={video()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject video" }));
    expect(await screen.findByText("Write the internal reason.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Internal reason (not shown to the seller)"), { target: { value: "blurry" } });
    fireEvent.change(screen.getByLabelText("Message to the seller (Arabic)"), { target: { value: "غير واضح" } });
    fireEvent.change(screen.getByLabelText("Message to the seller (English)"), { target: { value: "Blurry" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject video" }));
    await waitFor(() => expect(review).toHaveBeenLastCalledWith("v1", "reject", { reason: "blurry", messageAr: "غير واضح", messageEn: "Blurry" }));
  });

  it("offers no decision while the video is still processing", () => {
    renderWithI18n(<VideoReviewCard video={video({ state: "processing", playback: null })} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("lets a rejected video be approved and shows the internal reason to reviewers", () => {
    renderWithI18n(<VideoReviewCard video={video({ reviewStatus: "rejected", reviewReason: "blurry footage" })} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.getByText(/blurry footage/)).toBeTruthy();
  });
});
