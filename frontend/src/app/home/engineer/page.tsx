import { redirect } from "next/navigation";

// The Engineer overview lives at /home (ENGINEER_LINKS "home"); the bare
// /home/engineer segment has no screen of its own, so send it there instead of a 404.
export default function EngineerIndexPage() {
  redirect("/home");
}
