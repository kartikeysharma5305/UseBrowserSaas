import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildSecurityHeaders } from '../dashboard/next.config';
import { getAuthCookiePolicy } from '../dashboard/src/lib/auth/cookie-policy';
import {
  assertStagingProductionIsolation,
  DeploymentConfigurationError,
  validateDeploymentEnvironment,
} from '../dashboard/src/lib/deployment/environment';

function environment(
  deployment: 'staging' | 'production' = 'production'
): NodeJS.ProcessEnv {
  const origin =
    deployment === 'production'
      ? 'https://app.example.com'
      : 'https://staging.example.com';
  return {
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: deployment,
    DEPLOYMENT_INSTANCE_ID: `browser-use-${deployment}`,
    DATABASE_URL: `postgresql://user:password@${deployment}-db.example.com/app?sslmode=require`,
    REDIS_URL: `rediss://user:password@${deployment}-redis.example.com:6379`,
    APP_BASE_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_TRUSTED_ORIGINS: origin,
    BETTER_AUTH_SECRET: `${deployment}-auth-secret-at-least-32-characters`,
    API_KEY_PEPPER: `${deployment}-api-pepper-at-least-32-characters`,
    WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(
      32,
      deployment === 'production' ? 7 : 8
    ).toString('base64'),
    OBSERVABILITY_TOKEN: `${deployment}-observability-token-32-characters`,
    EXECUTION_ENABLED: 'true',
    GROQ_API_KEY: `${deployment}-groq-placeholder`,
    ARTIFACT_STORAGE_DRIVER: 's3',
    S3_ENDPOINT: `https://${deployment}-objects.example.com`,
    S3_REGION: 'us-east-1',
    S3_BUCKET: `browser-use-${deployment}`,
    S3_ACCESS_KEY_ID: `${deployment}-access`,
    S3_SECRET_ACCESS_KEY: `${deployment}-secret`,
    WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS: 'false',
    BILLING_ENABLED: 'false',
    EMAIL_ENABLED: 'false',
    LEGAL_ENTITY_NAME: deployment === 'production' ? 'Configured Entity' : '',
    PRIVACY_CONTACT_EMAIL:
      deployment === 'production' ? 'privacy@example.com' : '',
    SECURITY_CONTACT_EMAIL:
      deployment === 'production' ? 'security@example.com' : '',
  };
}

function rejects(change: Record<string, string | undefined>, text: string) {
  const candidate = { ...environment(), ...change };
  expect(() => validateDeploymentEnvironment(candidate)).toThrowError(text);
}

describe('Phase 26 deployment configuration', () => {
  it('accepts a complete production contract without returning secrets', () => {
    const result = validateDeploymentEnvironment(environment());
    expect(result).toMatchObject({
      environment: 'production',
      instanceId: 'browser-use-production',
      appOrigin: 'https://app.example.com',
      artifactDriver: 's3',
    });
    expect(JSON.stringify(result)).not.toContain('auth-secret');
    expect(JSON.stringify(result)).not.toContain('api-pepper');
  });

  it('rejects insecure or local production application URLs', () => {
    rejects(
      {
        APP_BASE_URL: 'http://app.example.com',
        BETTER_AUTH_URL: 'http://app.example.com',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://app.example.com',
      },
      'APP_BASE_URL must use HTTPS'
    );
    rejects(
      {
        APP_BASE_URL: 'https://localhost',
        BETTER_AUTH_URL: 'https://localhost',
        BETTER_AUTH_TRUSTED_ORIGINS: 'https://localhost',
      },
      'must not use a local hostname'
    );
  });

  it('rejects missing mandatory connectivity and continuity secrets', () => {
    rejects({ DATABASE_URL: undefined }, 'DATABASE_URL is required');
    rejects({ REDIS_URL: undefined }, 'REDIS_URL is required');
    rejects({ API_KEY_PEPPER: undefined }, 'API_KEY_PEPPER is required');
    rejects(
      { WEBHOOK_SECRET_ENCRYPTION_KEY: 'invalid' },
      'must decode to exactly 32 bytes'
    );
  });

  it('accepts either configured execution provider without exposing its key', () => {
    const nvidiaOnly = {
      ...environment(),
      GROQ_API_KEY: undefined,
      NVIDIA_API_KEY: 'nvapi-test-provider-secret',
      NVIDIA_NIM_ALLOWED_MODELS: 'nvidia_glm-5.2',
    };
    const result = validateDeploymentEnvironment(nvidiaOnly);
    expect(JSON.stringify(result)).not.toContain('nvapi-test-provider-secret');
    expect(() =>
      validateDeploymentEnvironment({
        ...nvidiaOnly,
        NVIDIA_API_KEY: undefined,
      })
    ).toThrow('At least one of GROQ_API_KEY or NVIDIA_API_KEY is required');
  });

  it('rejects wildcard or mismatched trusted origins', () => {
    rejects(
      { BETTER_AUTH_TRUSTED_ORIGINS: 'https://*.example.com' },
      'must not contain wildcards'
    );
    rejects(
      { BETTER_AUTH_TRUSTED_ORIGINS: 'https://other.example.com' },
      'must include BETTER_AUTH_URL'
    );
  });

  it('rejects obvious Stripe environment mixing', () => {
    rejects(
      {
        BILLING_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_placeholder',
        STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
        STRIPE_PRO_MONTHLY_PRICE_ID: 'price_placeholder',
        STRIPE_CHECKOUT_SUCCESS_URL:
          'https://app.example.com/dashboard/billing?checkout=success',
        STRIPE_CHECKOUT_CANCEL_URL:
          'https://app.example.com/dashboard/billing?checkout=canceled',
        STRIPE_PORTAL_RETURN_URL: 'https://app.example.com/dashboard/billing',
      },
      'Production billing must use a Stripe live-mode secret key'
    );
    expect(() =>
      validateDeploymentEnvironment({
        ...environment('staging'),
        BILLING_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_live_placeholder',
        STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
        STRIPE_PRO_MONTHLY_PRICE_ID: 'price_placeholder',
        STRIPE_CHECKOUT_SUCCESS_URL:
          'https://staging.example.com/dashboard/billing?checkout=success',
        STRIPE_CHECKOUT_CANCEL_URL:
          'https://staging.example.com/dashboard/billing?checkout=canceled',
        STRIPE_PORTAL_RETURN_URL:
          'https://staging.example.com/dashboard/billing',
      })
    ).toThrowError('Staging billing must use a Stripe test-mode secret key');
  });

  it('enforces production CSP, secure cookies, and isolated environment values', () => {
    const csp = buildSecurityHeaders(true).find(
      (header) => header.key === 'Content-Security-Policy'
    )?.value;
    expect(csp).not.toContain("'unsafe-eval'");
    expect(getAuthCookiePolicy(true).defaultCookieAttributes.secure).toBe(true);
    expect(() =>
      assertStagingProductionIsolation(
        environment('staging'),
        environment('production')
      )
    ).not.toThrow();
    expect(() =>
      assertStagingProductionIsolation(environment(), environment())
    ).toThrow(DeploymentConfigurationError);
  });

  it('uses guarded additive migration and valid separate process commands', () => {
    const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const dashboard = JSON.parse(
      fs.readFileSync('dashboard/package.json', 'utf8')
    );
    for (const processName of [
      'start:dashboard',
      'start:worker',
      'start:scheduler',
      'start:notifications',
      'start:webhooks',
    ])
      expect(root.scripts[processName]).toBeTruthy();
    const migration = fs.readFileSync(
      'dashboard/scripts/deploy-migrations.ts',
      'utf8'
    );
    expect(migration).toContain("'migrate', 'deploy'");
    expect(migration).toContain('MIGRATION_BACKUP_VERIFIED');
    expect(migration).not.toMatch(/db\s+push|migrate\s+reset/);
    expect(dashboard.scripts['production:preflight']).toBeTruthy();
    expect(fs.existsSync('dashboard/deploy/process-manifest.yaml')).toBe(true);
  });

  it('keeps production smoke checks read-only and bounded', () => {
    const smoke = fs.readFileSync(
      'dashboard/scripts/production-smoke.ts',
      'utf8'
    );
    expect(smoke).toContain('/api/internal/readiness');
    expect(smoke).toContain('/api/internal/metrics');
    expect(smoke).not.toMatch(/method:\s*['"](?:POST|PATCH|DELETE)/);
  });
});
