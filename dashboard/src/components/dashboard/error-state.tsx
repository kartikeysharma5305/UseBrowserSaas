import { Card } from '@/components/ui/card';

export function ErrorState({ message }: { message: string }) {
  return (
    <Card className="p-6">
      <p className="text-sm font-medium text-rose-600">Something went wrong</p>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
    </Card>
  );
}
