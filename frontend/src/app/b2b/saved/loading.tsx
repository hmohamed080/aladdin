import { GridPageSkeleton } from "@/components/ui/page-skeletons";

/** The shortlist arrives as a card grid. */
export default function Loading() {
  return <GridPageSkeleton cards={6} />;
}
