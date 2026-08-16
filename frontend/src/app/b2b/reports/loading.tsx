import { PanelPageSkeleton } from "@/components/ui/page-skeletons";

/** Reports arrives as tiles over a wall of breakdown panels. */
export default function Loading() {
  return <PanelPageSkeleton panels={5} />;
}
