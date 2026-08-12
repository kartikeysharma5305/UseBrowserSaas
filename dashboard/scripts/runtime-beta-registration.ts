import type { BrowserContext, Page } from 'playwright';
import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '../src/lib/db/prisma';

export async function createRuntimeInviteToken(input: {
  email: string;
  planCode?: 'FREE' | 'PRO' | 'INTERNAL';
}): Promise<string> {
  if (!/^(1|true|yes)$/i.test(process.env.BETA_MODE?.trim() ?? '')) return '';

  const inviteToken = randomBytes(32).toString('base64url');
  await prisma.betaInvite.create({
    data: {
      email: input.email.trim().toLowerCase(),
      tokenHash: createHash('sha256').update(inviteToken, 'utf8').digest('hex'),
      tokenPrefix: inviteToken.slice(0, 8),
      planCode: input.planCode ?? 'PRO',
      note: 'disposable runtime verification',
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  return inviteToken;
}

export async function registerRuntimeUser(input: {
  context: BrowserContext;
  origin: string;
  email: string;
  name: string;
  password: string;
  planCode?: 'FREE' | 'PRO' | 'INTERNAL';
}): Promise<Page> {
  const page = await input.context.newPage();
  const inviteToken = await createRuntimeInviteToken({
    email: input.email,
    planCode: input.planCode,
  });
  const registerUrl = new URL('/register', input.origin);
  if (inviteToken) registerUrl.searchParams.set('invite', inviteToken);
  await page.goto(registerUrl.toString(), { waitUntil: 'load' });
  await page.getByLabel('Full name').fill(input.name);
  await page.getByLabel('Email').fill(input.email);
  await page.getByLabel('Password').fill(input.password);
  await page.locator('input[name="legalAccepted"]').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/dashboard\/?$/, {
    timeout: 30_000,
    waitUntil: 'commit',
  });
  return page;
}
