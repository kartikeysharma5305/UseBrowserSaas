import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';

const origin = 'http://localhost:3001';
const result = {
  registered: false,
  beganFree: false,
  successQueryStayedFree: false,
  checkoutHosted: false,
  paymentSubmitted: false,
  webhookGrantedPro: false,
  portalHosted: false,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const token = randomBytes(8).toString('hex');
  const email = `phase6b-${token}@example.invalid`;
  const password = `Sandbox-${randomBytes(12).toString('hex')}!`;

  await page.goto(`${origin}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Full name').fill('Phase 6B Sandbox');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:\/)?$/, { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  result.registered = true;

  const readStatus = () =>
    page.evaluate(async () => {
      const response = await fetch('/api/billing/status');
      const body = await response.json();
      return { http: response.status, plan: body.data?.planCode };
    });

  await page.goto(`${origin}/dashboard/billing`, { waitUntil: 'networkidle' });
  let status = await readStatus();
  result.beganFree = status.http === 200 && status.plan === 'FREE';

  await page.goto(`${origin}/dashboard/billing?checkout=success`, {
    waitUntil: 'networkidle',
  });
  status = await readStatus();
  result.successQueryStayedFree = status.http === 200 && status.plan === 'FREE';

  await Promise.all([
    page.waitForURL((url) => url.hostname.endsWith('stripe.com'), {
      timeout: 30_000,
    }),
    page.getByRole('button', { name: 'Start PRO' }).click(),
  ]);
  result.checkoutHosted =
    page.url().startsWith('https://') &&
    new URL(page.url()).hostname.endsWith('stripe.com');

  await page.locator('input[name="cardNumber"]').fill('4242424242424242');
  await page.locator('input[name="cardExpiry"]').fill('1234');
  await page.locator('input[name="cardCvc"]').fill('123');
  const billingName = page.locator('input[name="billingName"]');
  if (await billingName.count()) await billingName.fill('Phase Sandbox');
  const postalCode = page.locator('input[name="postalCode"]');
  if (await postalCode.count()) await postalCode.fill('10001');
  await Promise.all([
    page.waitForURL((url) => url.origin === origin, { timeout: 60_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  result.paymentSubmitted = true;

  const deadline = Date.now() + 45_000;
  do {
    await page.waitForTimeout(2_000);
    status = await readStatus();
    if (status.plan === 'PRO') break;
  } while (Date.now() < deadline);
  result.webhookGrantedPro = status.http === 200 && status.plan === 'PRO';

  const portal = await page.evaluate(async () => {
    const response = await fetch('/api/billing/portal', { method: 'POST' });
    const body = await response.json();
    const url =
      typeof body.data?.url === 'string' ? new URL(body.data.url) : null;
    return {
      http: response.status,
      secure: url?.protocol === 'https:',
      hosted: url?.hostname.endsWith('stripe.com'),
    };
  });
  result.portalHosted = portal.http === 200 && portal.secure && portal.hosted;
} finally {
  await browser.close();
}

console.log(JSON.stringify(result));
if (Object.values(result).some((value) => !value)) process.exitCode = 1;
