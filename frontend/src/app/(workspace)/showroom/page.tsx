import { redirect } from "next/navigation";
import { requireShowroomContext } from "@/features/showroom-shell/context";

export default async function ShowroomEntry() {
  await requireShowroomContext();
  redirect("/showroom/home");
}
