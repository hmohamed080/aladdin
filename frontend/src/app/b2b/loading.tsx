import { Skeleton } from "@/components/ui/primitives";

/** Shell-level loading skeleton shown while a B2B page's data resolves. */
export default function B2BLoading() {
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-sm">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-lg desktop:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
