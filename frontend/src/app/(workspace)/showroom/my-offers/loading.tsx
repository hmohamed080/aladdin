export default function ShowroomMyOffersLoading() {
  return (
    <div className="flex flex-col gap-md" aria-busy="true" data-testid="my-offers-loading">
      <div className="h-14 w-64 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-2 gap-sm desktop:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
      <div className="h-12 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-1 gap-sm tablet:grid-cols-2 desktop:grid-cols-3 wide:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-72 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
