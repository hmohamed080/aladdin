import { redirect } from "next/navigation";

/** Legacy preview URL — the password flow is canonical at /auth/sign-up now. */
export default function LegacyPreviewSignUpRedirect(): never {
  redirect("/auth/sign-up");
}
