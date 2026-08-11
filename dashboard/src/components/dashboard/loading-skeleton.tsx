import { Card } from '@/components/ui/card';

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, index) => (
        <Card key={index} className="p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-3 w-1/2 rounded bg-slate-50 dark:bg-slate-700" />
          </div>
        </Card>
      ))}
    </div>
  );
}
