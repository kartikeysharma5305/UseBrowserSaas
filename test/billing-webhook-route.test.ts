import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  getBillingConfig: vi.fn(),
  constructEvent: vi.fn(),
  handleEvent: vi.fn(),
}));

vi.mock('@/lib/billing/config', () => ({
  getBillingConfig: mocks.getBillingConfig,
}));
vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
  }),
}));
vi.mock('@/lib/billing/webhook', () => ({
  handleStripeWebhookEvent: mocks.handleEvent,
}));
vi.mock('@/lib/api/route-helpers', () => ({
  jsonError: (error: string, status = 400, code?: string) =>
    NextResponse.json(code ? { error, code } : { error }, { status }),
}));

import { POST } from '@/app/api/billing/webhook/route';

const config = {
  enabled: true as const,
  webhookSecret: 'whsec_test',
  secretKey: 'sk_test_secret',
  proMonthlyPriceId: 'price_pro',
  checkoutSuccessUrl: 'http://localhost:3001/success',
  checkoutCancelUrl: 'http://localhost:3001/cancel',
  portalReturnUrl: 'http://localhost:3001/portal',
  testMode: true,
  appOrigin: 'http://localhost:3001',
  environment: 'test',
};
const event = {
  id: 'evt_route',
  type: 'customer.created',
  created: 1,
  data: { object: {} },
} as any;
const webhookRequest = (body: string, signature?: string) =>
  new Request('http://localhost:3001/api/billing/webhook', {
    method: 'POST',
    body,
    headers: signature ? { 'stripe-signature': signature } : {},
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getBillingConfig.mockReturnValue(config);
  mocks.constructEvent.mockReturnValue(event);
  mocks.handleEvent.mockResolvedValue(undefined);
});

describe('billing webhook route raw signature handling', () => {
  it('rejects a missing signature without reading or dispatching the event', async () => {
    const response = await POST(webhookRequest('{"id":"evt"}'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ code: 'STRIPE_SIGNATURE_MISSING' })
    );
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it('passes the exact raw body and configured signing secret to Stripe verification', async () => {
    const raw = '{\n  "id": "evt_route"\n}';
    const response = await POST(webhookRequest(raw, 't=1,v1=signature'));
    expect(response.status).toBe(200);
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      raw,
      't=1,v1=signature',
      'whsec_test'
    );
    expect(mocks.handleEvent).toHaveBeenCalledWith(event);
  });

  it('rejects invalid signatures with a sanitized response', async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error('signature mismatch: whsec_test');
    });
    const response = await POST(webhookRequest('{"id":"evt"}', 'bad'));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('whsec_test');
  });

  it('does not dispatch when body/signature verification fails after a body change', async () => {
    mocks.constructEvent.mockImplementation((body: string) => {
      if (body !== '{"id":"original"}') throw new Error('invalid');
      return event;
    });
    const response = await POST(
      webhookRequest('{ "id":"original" }', 'valid-for-original')
    );
    expect(response.status).toBe(400);
    expect(mocks.handleEvent).not.toHaveBeenCalled();
  });

  it('returns a retryable safe failure when dispatch fails', async () => {
    mocks.handleEvent.mockRejectedValue(new Error('database details'));
    const response = await POST(webhookRequest('{"id":"evt"}', 'valid'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'database details'
    );
  });

  it('returns a deliberate safe response when billing is disabled', async () => {
    mocks.getBillingConfig.mockReturnValue({
      enabled: false,
      testMode: true,
      appOrigin: 'http://localhost:3001',
      environment: 'test',
    });
    expect((await POST(webhookRequest('{}', 'anything'))).status).toBe(503);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });
});
