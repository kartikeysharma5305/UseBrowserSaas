import 'server-only';

import Stripe from 'stripe';

import { assertBillingEnabled } from './config';

const globalForStripe = globalThis as typeof globalThis & {
  stripeClient?: Stripe;
};

export function getStripeClient(): Stripe {
  if (globalForStripe.stripeClient) return globalForStripe.stripeClient;
  const config = assertBillingEnabled();
  globalForStripe.stripeClient = new Stripe(config.secretKey, {
    apiVersion: '2026-06-24.dahlia',
    appInfo: {
      name: 'browser-use-dashboard',
      version: '0.1.0',
    },
  });
  return globalForStripe.stripeClient;
}

export function classifyStripeError(error: unknown): string {
  if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
    return 'STRIPE_SIGNATURE_INVALID';
  }
  if (error instanceof Stripe.errors.StripeError) {
    return error.code || error.type || 'STRIPE_ERROR';
  }
  return 'BILLING_ERROR';
}
