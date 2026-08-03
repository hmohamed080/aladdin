import { redirect } from "next/navigation";

/** The app entry redirects into the B2B workspace (middleware guards the session). */
export default function RootPage() {
  redirect("/b2b");
}
