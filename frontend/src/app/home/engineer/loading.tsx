import { Skeleton } from "@/components/ui/primitives";
export default function EngineerLoading() {
  return (
    <div className="flex flex-col gap-lg" aria-busy="true">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-md tablet:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
