import 'server-only';

const APP_ENVIRONMENT =
  process.env.BILLING_ENVIRONMENT?.trim() ||
  process.env.NODE_ENV ||
  'development';

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when billing is enabled.`);
  return value;
}

function optionalHttpUrl(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(`${name} must be a safe HTTP or HTTPS URL.`);
  }
  return url.toString();
}

function allowedRedirectUrl(name: string, appOrigin: string): string {
  const value = optionalHttpUrl(name) ?? required(name);
  const url = new URL(value);
  const app = new URL(appOrigin);
  if (url.origin !== app.origin) {
    throw new Error(`${name} must use the configured application origin.`);
  }
  return url.toString();
}

function appOrigin(): string {
  const raw =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3001';
  const url = new URL(raw);
  return url.origin;
}

export function getBillingConfig() {
  const billingEnabled = parseBoolean(
    'BILLING_ENABLED',
    process.env.NODE_ENV === 'production'
  );
  const origin = appOrigin();
  if (!billingEnabled) {
    return {
      enabled: false as const,
      environment: APP_ENVIRONMENT,
      testMode: true,
      appOrigin: origin,
    };
  }

  const secretKey = required('STRIPE_SECRET_KEY');
  const webhookSecret = required('STRIPE_WEBHOOK_SECRET');
  const proMonthlyPriceId = required('STRIPE_PRO_MONTHLY_PRICE_ID');
  if (!proMonthlyPriceId.startsWith('price_')) {
    throw new Error('STRIPE_PRO_MONTHLY_PRICE_ID must be a Stripe price ID.');
  }
  return {
    enabled: true as const,
    environment: APP_ENVIRONMENT,
    testMode: secretKey.startsWith('sk_test_'),
    appOrigin: origin,
    secretKey,
    webhookSecret,
    checkoutSuccessUrl: allowedRedirectUrl(
      'STRIPE_CHECKOUT_SUCCESS_URL',
      origin
    ),
    checkoutCancelUrl: allowedRedirectUrl('STRIPE_CHECKOUT_CANCEL_URL', origin),
    portalReturnUrl: allowedRedirectUrl('STRIPE_PORTAL_RETURN_URL', origin),
    proMonthlyPriceId,
  };
}

export function assertBillingEnabled() {
  const config = getBillingConfig();
  if (!config.enabled) {
    throw new Error('Billing is disabled.');
  }
  return config;
}
