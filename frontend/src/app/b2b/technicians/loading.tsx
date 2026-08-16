import { ListPageSkeleton } from "@/components/ui/page-skeletons";

/** Technicians shows two tiles, then tabs and a table. */
export default function Loading() {
  return <ListPageSkeleton tiles={2} />;
}
