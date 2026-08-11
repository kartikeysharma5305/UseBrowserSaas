import { jsonError } from '@/lib/api/route-helpers';
import { ExecutionServiceError } from '@/lib/execution/errors';
import { SchedulingError } from './service';

export function schedulingRouteError(error: unknown) {
  if (error instanceof SchedulingError)
    return jsonError(error.message, error.status, error.code);
  if (error instanceof ExecutionServiceError)
    return jsonError(error.publicMessage, error.status, error.code);
  return jsonError(
    'Unable to process schedule.',
    500,
    'SCHEDULE_OPERATION_FAILED'
  );
}
