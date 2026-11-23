"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, InlineError } from "@/components/ui/primitives";
import { Button, LabeledField, Textarea } from "@/components/ui/controls";
import { VideoPlayer } from "@/features/video/video-player";
import { useI18n } from "@/lib/i18n/context";
import type { VideoPlayback } from "@/server/video/playback";
import { reviewVideoAction } from "@/server/actions/marketplace-video-review";

export type ReviewVideo = {
  id: string;
  title: string;
  state: string;
  reviewStatus: "pending" | "approved" | "rejected";
  playback: VideoPlayback | null;
  width: number | null;
  height: number | null;
  reviewReason: string | null;
};

const KNOWN_ERRORS = ["not_permitted", "not_found", "video_not_ready", "reason_required", "message_required", "text_too_long", "decision_invalid"];

/** One video with Approve / Reject. Rejecting needs an internal reason and the message to the seller in both languages. */
export function VideoReviewCard({ video }: { video: ReviewVideo }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [messageAr, setMessageAr] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ready = video.state === "ready";

  function decide(decision: "approve" | "reject") {
    setError(null);
    start(async () => {
      const result = await reviewVideoAction(video.id, decision, { reason, messageAr, messageEn });
      if (!result.ok) {
        setError(KNOWN_ERRORS.includes(result.code) ? result.code : "unexpected");
        return;
      }
      setRejecting(false);
      router.refresh();
    });
  }

  return (
    <Card pad="sm" className="flex flex-col gap-sm" data-testid="video-review-card">
      {ready && video.playback ? (
        <VideoPlayer source={video.playback} title={video.title} width={video.width} height={video.height}
          labels={{ play: t("video.play", { title: video.title }), unavailable: t("video.unavailable") }} />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-md bg-surface-2 px-md text-center text-label text-fg-secondary">
          {ready ? t("video.unavailable") : t(`video.state.${video.state}`)}
        </div>
      )}
      <p className="truncate text-label font-medium text-fg">{video.title}</p>
      <p className="text-caption text-fg-secondary" data-testid="video-review-status">{t(`video.review.${video.reviewStatus}`)}</p>
      {video.reviewStatus === "rejected" && video.reviewReason ? (
        <p className="text-caption text-fg-secondary">{t("adminMarketplace.videos.internalReason")}: {video.reviewReason}</p>
      ) : null}
      {ready ? (
        rejecting ? (
          <div className="flex flex-col gap-sm">
            <LabeledField label={t("adminMarketplace.videos.reason")}>
              <Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </LabeledField>
            <LabeledField label={t("adminMarketplace.videos.messageAr")}>
              <Textarea dir="rtl" value={messageAr} maxLength={1000} onChange={(e) => setMessageAr(e.target.value)} />
            </LabeledField>
            <LabeledField label={t("adminMarketplace.videos.messageEn")}>
              <Textarea dir="ltr" value={messageEn} maxLength={1000} onChange={(e) => setMessageEn(e.target.value)} />
            </LabeledField>
            <div className="flex gap-sm">
              <Button size="sm" variant="danger" disabled={pending} onClick={() => decide("reject")}>{t("adminMarketplace.videos.confirmReject")}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>{t("common.cancel")}</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-sm">
            {video.reviewStatus !== "approved" && (
              <Button size="sm" disabled={pending} onClick={() => decide("approve")}>{t("adminMarketplace.videos.approve")}</Button>
            )}
            {video.reviewStatus !== "rejected" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>{t("adminMarketplace.videos.reject")}</Button>
            )}
          </div>
        )
      ) : null}
      {error ? <InlineError>{t(`adminMarketplace.videos.errors.${error}`)}</InlineError> : null}
    </Card>
  );
}
