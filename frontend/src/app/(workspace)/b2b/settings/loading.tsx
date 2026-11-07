import { PanelPageSkeleton } from "@/components/ui/page-skeletons";

/** Settings is a wall of panels with no KPI strip. */
export default function Loading() {
  return <PanelPageSkeleton tiles={0} panels={4} />;
}
