import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';

import { prisma } from '@/lib/db/prisma';
import { getAuthCookiePolicy } from './cookie-policy';

function parseAuthOrigin(variableName: string, value: string | undefined) {
  const candidate = value?.trim();

  if (!candidate) {
    throw new Error(
      `${variableName} is required. Set it to the dashboard's absolute HTTP or HTTPS origin.`
    );
  }

  if (candidate.includes('*')) {
    throw new Error(`${variableName} must not contain wildcard origins.`);
  }

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `${variableName} must contain a valid absolute HTTP or HTTPS origin.`
    );
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${variableName} must contain an HTTP or HTTPS origin without credentials, a path, query parameters, or a fragment.`
    );
  }

  return url.origin;
}

function createAuth() {
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!authSecret?.trim()) {
    throw new Error(
      'BETTER_AUTH_SECRET is required. Set it in your dashboard .env.local file.'
    );
  }

  const authBaseOrigin = parseAuthOrigin(
    'BETTER_AUTH_URL',
    process.env.BETTER_AUTH_URL
  );
  const configuredTrustedOrigins = (
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseAuthOrigin('BETTER_AUTH_TRUSTED_ORIGINS', origin));
  const trustedOrigins = [
    ...new Set([authBaseOrigin, ...configuredTrustedOrigins]),
  ];

  return betterAuth({
    baseURL: authBaseOrigin,
    trustedOrigins,
    secret: authSecret,
    advanced: getAuthCookiePolicy(process.env.NODE_ENV === 'production'),
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [nextCookies()],
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}
