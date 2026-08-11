import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

import { prisma } from '../src/lib/db/prisma';

const baseUrl = process.env.PHASE20_BASE_URL ?? 'http://localhost:3001';
const marker = randomUUID().replaceAll('-', '');
const email = `phase20-browser-${marker}@example.invalid`;
const password = `Phase20-${marker}!aA1`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let signInPost = false;
  let sensitiveUrl = false;
  let loginSubmitted = false;
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.endsWith('/api/auth/sign-in/email'))
      signInPost = true;
    if (
      loginSubmitted &&
      (url.includes(encodeURIComponent(email)) ||
        url.includes(encodeURIComponent(password)))
    )
      sensitiveUrl = true;
  });

  try {
    const registration = await page.goto(`${baseUrl}/register`);
    const csp = registration?.headers()['content-security-policy'] ?? '';
    if (!csp.includes("'unsafe-eval'"))
      throw new Error(
        'Development CSP does not allow required hydration support.'
      );
    await page.getByLabel('Full name').fill('Phase 20 browser disposable');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    await page.context().clearCookies();
    await page.goto(
      `${baseUrl}/login?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    );
    await page.waitForFunction(
      () =>
        !location.search.includes('email=') &&
        !location.search.includes('password=')
    );
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    loginSubmitted = true;
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    const protectedStatus = await page.evaluate(
      async () => (await fetch('/api/agents')).status
    );
    if (!signInPost || sensitiveUrl || protectedStatus !== 200)
      throw new Error('Browser authentication contract failed.');

    const deleted = await page.evaluate(
      async () =>
        (
          await fetch('/api/account/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirmation: 'DELETE' }),
          })
        ).status
    );
    if (deleted !== 202)
      throw new Error('Disposable browser user cleanup failed.');
    console.log(
      JSON.stringify({
        developmentHydration: 'verified',
        loginTransport: 'POST',
        credentialsInUrl: false,
        dashboardSession: 'verified',
        protectedApi: 'verified',
        legacyQueryCleanup: 'verified',
        cleanup: 'completed',
        identifiers: 'sanitized',
      })
    );
  } finally {
    await browser.close();
  }
}

main()
  .catch(async () => {
    await prisma.user.deleteMany({ where: { email } });
    console.error(
      'Phase 20 browser runtime drill failed; disposable state was cleaned.'
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
