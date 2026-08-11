import { jsonError } from '@/lib/api/route-helpers';
import { WebhookTargetError } from './network';
import {
  WebhookAccountBlockedError,
  WebhookNotFoundError,
  WebhookPlanError,
} from './service';

export function webhookRouteError(error: unknown) {
  if (error instanceof WebhookNotFoundError)
    return jsonError('Webhook endpoint not found.', 404, 'NOT_FOUND');
  if (error instanceof WebhookPlanError)
    return jsonError(
      'Outbound webhooks are unavailable for this plan or the endpoint limit was reached.',
      403,
      'WEBHOOK_PLAN_LIMIT'
    );
  if (error instanceof WebhookAccountBlockedError)
    return jsonError(
      'Account deletion is in progress.',
      403,
      'ACCOUNT_DELETION_IN_PROGRESS'
    );
  if (error instanceof WebhookTargetError)
    return jsonError('Webhook endpoint URL is not allowed.', 400, error.code);
  return jsonError(
    'Unable to process the webhook request.',
    503,
    'WEBHOOK_UNAVAILABLE'
  );
}
