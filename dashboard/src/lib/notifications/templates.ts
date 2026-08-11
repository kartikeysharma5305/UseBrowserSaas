import type { NotificationType } from '@prisma/client';

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        character
      ]!
  );
}

function safe(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.slice(0, 160) : fallback;
}

const COPY: Record<NotificationType, { subject: string; message: string }> = {
  RUN_SUCCEEDED: {
    subject: 'Agent Run completed',
    message: 'A browser Agent Run completed successfully.',
  },
  RUN_FAILED: {
    subject: 'Agent Run failed',
    message:
      'A browser Agent Run failed. Review its safe details in the dashboard.',
  },
  RUN_TIMED_OUT: {
    subject: 'Agent Run timed out',
    message: 'A browser Agent Run exceeded its configured time limit.',
  },
  RUN_CANCELED: {
    subject: 'Agent Run canceled',
    message: 'A browser Agent Run was canceled.',
  },
  SCHEDULE_QUOTA_BLOCKED: {
    subject: 'Scheduled Run was blocked',
    message: 'A scheduled occurrence was blocked by the current plan or quota.',
  },
  SCHEDULE_REPEATED_FAILURE: {
    subject: 'Schedule needs attention',
    message: 'A schedule repeatedly could not admit a Run.',
  },
  USAGE_THRESHOLD: {
    subject: 'Run usage threshold reached',
    message: 'Monthly Run usage reached a configured threshold.',
  },
  STORAGE_THRESHOLD: {
    subject: 'Storage threshold reached',
    message: 'Artifact storage usage reached a configured threshold.',
  },
  BILLING_PAYMENT_ISSUE: {
    subject: 'Subscription payment needs attention',
    message: 'A subscription payment issue requires attention in Billing.',
  },
  SUBSCRIPTION_CANCELING: {
    subject: 'Subscription cancellation scheduled',
    message:
      'Your subscription is scheduled to end at the current period boundary.',
  },
  SUBSCRIPTION_ENDED: {
    subject: 'Subscription ended',
    message: 'Your subscription ended and plan access was updated.',
  },
  ACCOUNT_DELETION_COMPLETED: {
    subject: 'Account deletion completed',
    message: 'Your account deletion request completed.',
  },
  ACCOUNT_DELETION_BLOCKED: {
    subject: 'Account deletion needs retry',
    message:
      'Your saved account deletion request could not complete and needs retry.',
  },
};

export function renderNotificationEmail(input: {
  type: NotificationType;
  payload: Record<string, unknown>;
  appBaseUrl: string;
}): EmailTemplate {
  const copy = COPY[input.type];
  const agentName = safe(input.payload.agentName);
  const detail = agentName ? ` Agent: ${agentName}.` : '';
  const actionPath = safe(input.payload.actionPath);
  const safePath =
    actionPath.startsWith('/') && !actionPath.startsWith('//')
      ? actionPath
      : '/dashboard/notifications';
  const url = `${input.appBaseUrl}${safePath}`;
  const text = `Browser Use Dashboard\n\n${copy.message}${detail}\n\nOpen dashboard: ${url}`;
  return {
    subject: copy.subject,
    text,
    html: `<h1>${escapeHtml(copy.subject)}</h1><p>${escapeHtml(copy.message + detail)}</p><p><a href="${escapeHtml(url)}">Open dashboard</a></p>`,
  };
}

export { escapeHtml };
