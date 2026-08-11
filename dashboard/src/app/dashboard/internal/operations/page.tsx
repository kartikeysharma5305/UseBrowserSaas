import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { collectOperationsSnapshot } from '@/lib/operations/snapshot';

function StatusCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {detail}
        </p>
      ) : null}
    </Card>
  );
}

export default async function OperationsPage() {
  const user = await requireAuthenticatedUser();
  if (!user || user.planCode !== 'INTERNAL') notFound();
  const snapshot = await collectOperationsSnapshot();
  const severityTone =
    snapshot.severity === 'OK'
      ? 'success'
      : snapshot.severity === 'DEGRADED'
        ? 'warning'
        : 'danger';
  const securityRejections = snapshot.processCounters
    .filter((sample) => sample.name === 'security_rejections_total')
    .reduce((total, sample) => total + sample.value, 0);
  const usageQuantity = Object.values(snapshot.usage).reduce(
    (total, value) => total + value,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Internal operations · trailing 24 hours
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            Platform operations
          </h1>
        </div>
        <Badge tone={severityTone}>{snapshot.severity}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          label="Browser workers"
          value={snapshot.workers.statuses.ACTIVE ?? 0}
          detail={`${snapshot.workers.activeExecutions}/${snapshot.workers.configuredCapacity} active capacity`}
        />
        <StatusCard
          label="Browser queue"
          value={snapshot.queues.browser.waiting}
          detail={`${snapshot.queues.browser.active} active · ${snapshot.queues.browser.failed} failed`}
        />
        <StatusCard
          label="Run success"
          value={snapshot.runs.outcomes.SUCCESS ?? 0}
          detail={`${snapshot.runs.outcomes.FAILED ?? 0} failed · ${snapshot.runs.outcomes.TIMED_OUT ?? 0} timed out`}
        />
        <StatusCard
          label="Average execution"
          value={`${snapshot.runs.averageDurationMs} ms`}
          detail={`${snapshot.runs.averageQueueWaitMs} ms average queue wait`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusCard
          label="Scheduler"
          value={snapshot.heartbeats.scheduler ? 'Reporting' : 'No heartbeat'}
          detail={`${snapshot.scheduler.occurrences.ADMITTED ?? 0} admitted · ${snapshot.scheduler.occurrences.MISSED ?? 0} missed`}
        />
        <StatusCard
          label="Notifications"
          value={snapshot.notifications.statuses.SENT ?? 0}
          detail={`${snapshot.notifications.statuses.FAILED ?? 0} failed · ${snapshot.notifications.retrying} retrying`}
        />
        <StatusCard
          label="Outbound webhooks"
          value={snapshot.webhooks.statuses.DELIVERED ?? 0}
          detail={`${snapshot.webhooks.statuses.FAILED ?? 0} failed · ${snapshot.webhooks.rateLimited} rate-limited`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusCard
          label="Reconciliation repairs"
          value={
            snapshot.reconciliation.runQueueRepairs +
            snapshot.reconciliation.billingRepairs24h
          }
          detail={`${snapshot.reconciliation.runQueueRepairs} Run queue · ${snapshot.reconciliation.billingRepairs24h} billing (24h)`}
        />
        <StatusCard
          label="Security rejections"
          value={securityRejections}
          detail="Current dashboard process"
        />
        <StatusCard
          label="Usage quantity"
          value={usageQuantity}
          detail="Aggregate operational units · trailing 24h"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-white">
            Recent sanitized incidents
          </h2>
        </div>
        {snapshot.incidents.length ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {snapshot.incidents.map((incident, index) => (
              <div
                className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[170px_120px_1fr]"
                key={`${incident.timestamp}-${incident.subsystem}-${index}`}
              >
                <time className="text-slate-500">{incident.timestamp}</time>
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {incident.subsystem}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {incident.code}
                  {incident.runId ? ` · Run ${incident.runId}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-8 text-sm text-slate-500">
            No recent operational incidents.
          </p>
        )}
      </Card>

      <p className="text-xs text-slate-500">
        INTERNAL is the current operator boundary; dedicated administrative RBAC
        is deferred. No task text, variables, recipient addresses, webhook
        targets, provider payloads, or secrets are displayed.
      </p>
    </div>
  );
}
