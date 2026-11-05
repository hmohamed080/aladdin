export default function ShowroomMyProductsLoading() {
  return (
    <div className="flex flex-col gap-md" aria-busy="true" data-testid="my-products-loading">
      <div className="h-14 w-64 animate-pulse rounded-md bg-surface-2" />
      <div className="h-8 w-80 max-w-full animate-pulse rounded-pill bg-surface-2" />
      <div className="h-12 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-60 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
