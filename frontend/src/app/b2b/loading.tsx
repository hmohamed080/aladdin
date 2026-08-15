import { Skeleton } from "@/components/ui/primitives";

/**
 * The dashboard's loading shape, and the fallback for any B2B route without its
 * own. It mirrors the real dashboard — greeting, KPI strip, quick actions, then a
 * two-column card wall — so the page does not visibly rearrange when data lands.
 */
export default function B2BLoading() {
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-7 w-48" />
      </div>

      <div className="grid grid-cols-2 gap-sm tablet:grid-cols-3 desktop:grid-cols-4 [&>*]:min-w-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>

      <div className="flex flex-wrap gap-sm">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-36" />
        ))}
      </div>

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    </div>
  );
}
