import { redirect } from "next/navigation";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { loadBusinessCreationAccess } from "@/server/queries/business-creation-access";
import { BusinessFlow } from "@/features/onboarding/business-flow";

export default async function AddShowroomBusiness() {
  await requireShowroomContext();
  const { allowed, data, slotOpen } = await loadBusinessCreationAccess();
  // A taken application slot is explained on the applications page rather than bounced home.
  if (data && !slotOpen) redirect("/business/applications");
  if (!allowed || !data) redirect("/showroom/home");
  // An additional activity chooses its own type, never the original registration intent.
  // Open drafts still resume normally. Writes retain canonical entitlement and RPC checks.
  return <BusinessFlow answers={data.business} presetOrgType={null} draftId={data.draftId} />;
}
