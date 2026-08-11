import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = path.join(process.cwd(), 'dashboard');
const source = (file: string) =>
  fs.readFileSync(path.join(dashboard, file), 'utf8');

describe('Phase 6B billing UI contract', () => {
  const billing = source('src/components/dashboard/billing-dashboard.tsx');

  it('renders loading, safe failure, disabled, and usage states', () => {
    expect(billing).toContain('animate-pulse');
    expect(billing).toContain(
      'Unable to load billing status. Please try again.'
    );
    expect(billing).toContain('Billing is unavailable in this environment.');
    expect(billing).toContain('href="/dashboard/usage"');
  });

  it('renders server-authoritative FREE, PRO, INTERNAL and TRIALING state', () => {
    expect(billing).toContain('{status.planCode}');
    expect(billing).toContain(
      'Subscription status: ${status.subscription.status}'
    );
    const statusRoute = source('src/app/api/billing/status/route.ts');
    expect(statusRoute).toContain('planCode: user.planCode');
    expect(statusRoute).toContain('status: true');
  });

  it('shows PAST_DUE and period-end cancellation warnings', () => {
    expect(billing).toContain("status.subscription?.status === 'PAST_DUE'");
    expect(billing).toContain('payment needs attention');
    expect(billing).toContain('cancelAtPeriodEnd');
    expect(billing).toContain('Access remains active until');
  });

  it('supports Checkout and Portal with duplicate-click prevention', () => {
    expect(billing).toContain("launch('checkout')");
    expect(billing).toContain("launch('portal')");
    expect(billing).toContain('Start PRO');
    expect(billing).toContain('Manage Billing');
    expect(billing).toContain('disabled={busy !== null}');
    expect(billing).toContain('setBusy(kind)');
  });

  it('does not trust the Checkout success query as entitlement evidence', () => {
    expect(billing).toContain("get('checkout') === 'success'");
    expect(billing).toContain("get('checkout') !==");
    expect(billing).toContain("status.planCode !== 'PRO'");
    expect(billing).toMatch(/only after a\s+verified webhook/);
    expect(billing).not.toMatch(/setStatus\([^)]*planCode:\s*['"]PRO/);
  });

  it('bounds polling and cleans up both timers', () => {
    expect(billing).toContain('window.setInterval');
    expect(billing).toContain('2000');
    expect(billing).toContain('30_000');
    expect(billing).toContain('window.clearInterval(id)');
    expect(billing).toContain('window.clearTimeout(stop)');
  });

  it('accepts only secure hosted redirects and renders no Stripe identifiers', () => {
    expect(billing).toContain("body.data.url.startsWith('https://')");
    expect(billing).not.toMatch(
      /stripeCustomerId|stripeSubscriptionId|stripePriceId/
    );
    expect(billing).not.toMatch(/sk_(test|live)_|whsec_/);
  });

  it('places Billing in desktop and mobile navigation', () => {
    expect(source('src/components/layout/sidebar.tsx')).toContain(
      "label: 'Billing'"
    );
    expect(source('src/components/layout/mobile-navigation.tsx')).toContain(
      "label: 'Billing'"
    );
  });
});
