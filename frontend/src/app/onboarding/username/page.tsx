import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Retired in P1 PR-2: the application no longer has a username, so there is no username step. Old links and bookmarks are sent to the
 * onboarding gate, which re-derives the real state from the database and routes accordingly. (The page never granted anything itself.)
 */
export default function OnboardingUsernamePage(): never {
  redirect("/onboarding");
}
