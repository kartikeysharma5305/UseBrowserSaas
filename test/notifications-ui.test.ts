import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = path.join(process.cwd(), 'dashboard');
const source = (file: string) =>
  fs.readFileSync(path.join(dashboard, file), 'utf8');

describe('Phase 7 notification UI contract', () => {
  const preferences = source(
    'src/components/dashboard/notification-preferences.tsx'
  );
  const history = source(
    'src/components/dashboard/notifications-dashboard.tsx'
  );

  it('has loading, success, safe error, and duplicate-submit states', () => {
    expect(preferences).toContain('animate-pulse');
    expect(preferences).toContain('Notification preferences saved.');
    expect(preferences).toContain(
      'Unable to save notification preferences. Please try again.'
    );
    expect(preferences).toContain('if (!value || busy) return');
    expect(preferences).toContain('disabled={busy}');
  });

  it('shows disabled-email and mandatory lifecycle policy clearly', () => {
    expect(preferences).toContain('Enable email delivery');
    expect(preferences).toContain('disabled={!value.emailEnabled');
    expect(preferences).toContain('Critical account-deletion');
    expect(preferences).toContain('digest generation is deferred');
  });

  it('shows sanitized history and no provider or event payload internals', () => {
    expect(history).toContain('item.deliveries[0]?.status.toLowerCase()');
    expect(history).toContain('Mark all read');
    expect(history).not.toMatch(
      /recipientEmail|providerMessageId|failureMessage|payload\.|stripe/i
    );
  });

  it('is linked from desktop and mobile navigation', () => {
    expect(source('src/components/layout/sidebar.tsx')).toContain(
      "label: 'Notifications'"
    );
    expect(source('src/components/layout/mobile-navigation.tsx')).toContain(
      "label: 'Notifications'"
    );
    expect(source('src/app/dashboard/settings/page.tsx')).toContain(
      '<NotificationPreferences />'
    );
  });
});
