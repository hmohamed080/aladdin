import { GridPageSkeleton } from "@/components/ui/page-skeletons";

/** Browse Products arrives as a card grid. */
export default function Loading() {
  return <GridPageSkeleton cards={9} />;
}
