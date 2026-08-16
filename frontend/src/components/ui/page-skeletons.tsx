import { Skeleton } from "@/components/ui/primitives";

/**
 * Loading shapes for the workspace's two page archetypes.
 *
 * These exist so a navigation shows the SHAPE of the page that is arriving, not a
 * generic block that rearranges itself once data lands. They mirror the real
 * layouts — same header, same tile grid, same column rhythm — and use the existing
 * `Skeleton` primitive, so nothing new enters the design language.
 *
 * `aria-busy` + `aria-live="polite"` belong on the region a screen reader is
 * waiting on; the bars themselves are `aria-hidden` (see `Skeleton`), so a caller
 * hears "busy" once rather than a stream of meaningless boxes.
 */
function Header() {
  return (
    <div className="mb-lg flex flex-col gap-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

function Tiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-sm tablet:grid-cols-3 desktop:grid-cols-4 [&>*]:min-w-0">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Header → KPI tiles → filter row → table. Lists, directories and reports. */
export function ListPageSkeleton({
  tiles = 4,
  rows = 6,
  filters = true,
}: {
  tiles?: number;
  rows?: number;
  filters?: boolean;
}) {
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" aria-busy="true" aria-live="polite">
      <Header />
      {tiles > 0 ? <Tiles count={tiles} /> : null}
      <div className="flex flex-col gap-md">
        {filters ? (
          <div className="flex flex-wrap gap-sm">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-9 w-40" />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Header → filter row → card grid. The product-shaped pages (catalog, shortlist). */
export function GridPageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="pb-16 tablet:pb-0" aria-busy="true" aria-live="polite">
      <Header />
      <div className="mb-md flex flex-wrap gap-sm">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Header → tiles → two-column card wall. Reports and Settings. */
export function PanelPageSkeleton({ tiles = 4, panels = 4 }: { tiles?: number; panels?: number }) {
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" aria-busy="true" aria-live="polite">
      <Header />
      {tiles > 0 ? <Tiles count={tiles} /> : null}
      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        {Array.from({ length: panels }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    </div>
  );
}
