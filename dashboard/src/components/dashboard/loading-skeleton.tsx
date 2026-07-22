export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="h-12 animate-pulse rounded-lg bg-slate-100"
        />
      ))}
    </div>
  );
}
