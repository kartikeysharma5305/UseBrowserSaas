import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  formRecurrencePreview,
  occurrenceMessage,
  oneTimeUtc,
  recurrenceSummary,
} from '../dashboard/src/lib/scheduling/presentation.js';

const dashboard = path.join(process.cwd(), 'dashboard');
const source = (file: string) =>
  fs.readFileSync(path.join(dashboard, file), 'utf8');

describe('Phase 6D scheduling presentation', () => {
  it('formats one-time, daily, and selected-weekday recurrence', () => {
    expect(
      recurrenceSummary({
        kind: 'DAILY',
        localTime: '09:30',
        weekdays: [],
        oneTimeAt: null,
        timezone: 'Asia/Kolkata',
      })
    ).toBe('Daily at 09:30');
    expect(
      recurrenceSummary({
        kind: 'WEEKLY',
        localTime: '08:00',
        weekdays: [1, 5],
        oneTimeAt: null,
        timezone: 'UTC',
      })
    ).toBe('Mon, Fri at 08:00');
    expect(
      formRecurrencePreview({
        kind: 'ONCE',
        date: '2030-01-02',
        localTime: '10:15',
        timezone: 'UTC',
        weekdays: [],
      })
    ).toContain('2030-01-02 10:15 UTC');
  });

  it('converts local one-time input with its selected timezone', () => {
    expect(oneTimeUtc('2030-01-02', '10:15', 'Asia/Kolkata')).toBe(
      '2030-01-02T04:45:00.000Z'
    );
  });

  it('uses safe fixed explanations instead of provider errors', () => {
    expect(occurrenceMessage('QUOTA_BLOCKED')).toContain('quota');
    expect(occurrenceMessage('MISSED')).toContain('recovery window');
    expect(occurrenceMessage('FAILED')).not.toMatch(/prisma|stack|sql/i);
  });
});

describe('Phase 6D scheduling UI contract', () => {
  const page = source('src/components/dashboard/schedules-dashboard.tsx');
  const form = source('src/components/dashboard/schedule-form.tsx');

  it('provides loading, empty, active, paused, completed, and safe error states', () => {
    expect(page).toContain('Loading schedules');
    expect(page).toContain('No schedules yet');
    expect(page).toContain("return 'COMPLETED'");
    expect(page).toContain(
      "return schedule.state === 'ENABLED' ? 'ACTIVE' : 'PAUSED'"
    );
    expect(page).toContain('Unable to load schedules. Please try again.');
  });

  it('explains quota, active-limit, plan, missed, and failed outcomes safely', () => {
    const presentation = source('src/lib/scheduling/presentation.ts');
    for (const status of [
      'QUOTA_BLOCKED',
      'ACTIVE_LIMIT_BLOCKED',
      'PLAN_BLOCKED',
      'MISSED',
      'FAILED',
    ])
      expect(presentation).toContain(`${status}:`);
    expect(page).not.toMatch(/errorCode\}|taskConfig|configuration\}/);
  });

  it('supports one-time, daily, weekly, timezone, and weekday controls', () => {
    expect(form).toContain("(['ONCE', 'DAILY', 'WEEKLY'] as const)");
    expect(form).toContain('aria-label="Future date"');
    expect(form).toContain('aria-label="Local time"');
    expect(form).toContain('aria-label="Timezone"');
    expect(form).toContain('Select at least one weekday.');
    expect(form).toContain('browserTimezone()');
  });

  it('validates future dates, previews recurrence, and submits only once', () => {
    expect(form).toContain('Choose a one-time execution in the future.');
    expect(form).toContain('formRecurrencePreview');
    expect(form).toContain('if (submitting) return');
    expect(form).toContain('disabled={submitting}');
  });

  it('edits with optimistic version and explains immutable Runs', () => {
    expect(form).toContain('version: schedule.version');
    expect(form).toContain(
      'Changes apply only to future occurrences. Existing Runs are unchanged.'
    );
    expect(form).toContain(
      'This schedule changed elsewhere. Refresh and try again.'
    );
  });

  it('supports guarded pause, resume, skip, delete, and Run now', () => {
    for (const command of ['pause', 'resume', 'skip-next', 'run-now', 'delete'])
      expect(page).toContain(`'${command}'`);
    expect(page).toContain('Existing Runs will continue.');
    expect(page).toContain('Existing Runs are not canceled.');
    expect(page).toContain('if (busy) return');
    expect(page).toContain('const itemBusy = busy !== null');
    expect(page).toContain(
      'Run admitted without changing the next scheduled occurrence.'
    );
  });

  it('renders trusted plan limits and FREE upgrade guidance', () => {
    expect(page).toContain('plan?.limits.schedulingEnabled');
    expect(page).toContain('plan.limits.maxActiveSchedules');
    expect(page).toContain('Scheduling is unavailable on FREE');
    expect(page).toContain('href="/dashboard/billing"');
  });

  it('links admitted occurrence history to Run detail', () => {
    expect(page).toContain('Recent occurrences');
    expect(page).toContain('occurrence.discoveredAt');
    expect(page).toContain('`/dashboard/runs/${occurrence.runId}`');
    expect(page).toContain('Load more');
  });

  it('cancels requests and prevents stale load responses', () => {
    expect(page).toContain('loadController.current?.abort()');
    expect(page).toContain('historyController.current?.abort()');
    expect(page).toContain('sequence !== requestSequence.current');
    expect(page).not.toContain('setInterval(');
  });

  it('is integrated in desktop/mobile navigation and Agent detail', () => {
    expect(source('src/components/layout/sidebar.tsx')).toContain(
      "label: 'Scheduling'"
    );
    expect(source('src/components/layout/mobile-navigation.tsx')).toContain(
      "label: 'Scheduling'"
    );
    expect(
      source('src/components/dashboard/agent-detail-client.tsx')
    ).toContain('<SchedulesDashboard agentId={id} compact />');
  });

  it('uses responsive layout without exposing internal occurrence errors', () => {
    expect(page).toContain('lg:grid-cols-');
    expect(page).toContain('overflow-x-auto');
    expect(page).not.toContain('occurrence.errorCode');
    expect(page).not.toMatch(
      /stripeCustomerId|stripeSubscriptionId|sk_test|whsec_/
    );
  });
});
