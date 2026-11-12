import { redirect } from "next/navigation";

/**
 * Retired (2026-11-12). "Continue registration" no longer has a page of its own: /auth/sign-up reopens the code step by itself when this
 * browser has an unfinished email registration. Kept only so old bookmarks and any link already sent land somewhere useful.
 */
export default function ContinueRegistrationRetiredPage() {
  redirect("/auth/sign-up");
}
