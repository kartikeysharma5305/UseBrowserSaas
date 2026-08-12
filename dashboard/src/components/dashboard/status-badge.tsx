import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();

  if (normalized === 'ACTIVE' || normalized === 'SUCCESS') {
    return <Badge tone="success">{normalized}</Badge>;
  }

  if (normalized === 'PAUSED' || normalized === 'TIMED_OUT') {
    return <Badge tone="warning">{normalized}</Badge>;
  }

  if (normalized === 'FAILED') {
    return <Badge tone="danger">{normalized}</Badge>;
  }

  if (normalized === 'RUNNING') {
    return <Badge tone="info">{normalized}</Badge>;
  }

  return <Badge tone="default">{normalized}</Badge>;
}
