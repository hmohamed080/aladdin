export default function ShowroomHomeLoading() {
  return (
    <div className="flex flex-col gap-lg" aria-busy="true" data-testid="showroom-home-loading">
      <div className="h-14 w-64 animate-pulse rounded-md bg-surface-2" />
      <div className="grid grid-cols-2 gap-md tablet:grid-cols-3 desktop:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[5.5rem] animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
