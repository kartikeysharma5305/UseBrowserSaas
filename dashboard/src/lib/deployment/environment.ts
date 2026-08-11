export type DeploymentEnvironment = 'development' | 'staging' | 'production';

export interface DeploymentConfiguration {
  environment: DeploymentEnvironment;
  instanceId: string;
  appOrigin: string;
  databaseUrl: string;
  redisUrl: string;
  billingEnabled: boolean;
  emailEnabled: boolean;
  artifactDriver: 'local' | 's3';
  warnings: string[];
}

export class DeploymentConfigurationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Deployment configuration is invalid:\n- ${issues.join('\n- ')}`);
  }
}

const ISOLATED_VALUES = [
  'DATABASE_URL',
  'REDIS_URL',
  'BETTER_AUTH_SECRET',
  'API_KEY_PEPPER',
  'WEBHOOK_SECRET_ENCRYPTION_KEY',
  'OBSERVABILITY_TOKEN',
] as const;

export function assertStagingProductionIsolation(
  staging: NodeJS.ProcessEnv,
  production: NodeJS.ProcessEnv
) {
  const issues: string[] = [];
  for (const name of ISOLATED_VALUES) {
    const stagingValue = value(staging, name);
    const productionValue = value(production, name);
    if (!stagingValue || !productionValue || stagingValue === productionValue)
      issues.push(
        `${name} must be separately configured for staging and production.`
      );
  }
  const stagingBucket = value(staging, 'S3_BUCKET');
  const productionBucket = value(production, 'S3_BUCKET');
  if (stagingBucket && productionBucket && stagingBucket === productionBucket)
    issues.push('S3_BUCKET must not be shared by staging and production.');
  if (issues.length) throw new DeploymentConfigurationError(issues);
}

function value(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() ?? '';
}

function booleanValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
  issues: string[]
) {
  const raw = value(environment, name).toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  issues.push(`${name} must be true or false.`);
  return fallback;
}

function required(
  environment: NodeJS.ProcessEnv,
  name: string,
  issues: string[]
) {
  const result = value(environment, name);
  if (!result) issues.push(`${name} is required.`);
  return result;
}

function urlValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  protocols: readonly string[],
  issues: string[]
) {
  const raw = required(environment, name, issues);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol)) {
      issues.push(`${name} must use ${protocols.join(' or ')}.`);
      return null;
    }
    return url;
  } catch {
    issues.push(`${name} must be a valid absolute URL.`);
    return null;
  }
}

function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  );
}

function validateOrigin(name: string, url: URL, issues: string[]) {
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    issues.push(
      `${name} must be an origin without credentials, path, query, or fragment.`
    );
}

export function validateDeploymentEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): DeploymentConfiguration {
  const issues: string[] = [];
  const warnings: string[] = [];
  const rawEnvironment = required(
    environment,
    'DEPLOYMENT_ENVIRONMENT',
    issues
  );
  const deploymentEnvironment = (
    ['development', 'staging', 'production'].includes(rawEnvironment)
      ? rawEnvironment
      : 'development'
  ) as DeploymentEnvironment;
  if (
    rawEnvironment &&
    !['development', 'staging', 'production'].includes(rawEnvironment)
  )
    issues.push(
      'DEPLOYMENT_ENVIRONMENT must be development, staging, or production.'
    );

  const productionLike = deploymentEnvironment !== 'development';
  const stagingLocalDrill =
    deploymentEnvironment === 'staging' &&
    booleanValue(environment, 'STAGING_LOCAL_DRILL', false, issues);
  if (productionLike && value(environment, 'NODE_ENV') !== 'production')
    issues.push(
      'NODE_ENV must be production for staging and production deployments.'
    );

  const instanceId = required(environment, 'DEPLOYMENT_INSTANCE_ID', issues);
  if (instanceId && !/^[a-z0-9][a-z0-9-]{2,47}$/.test(instanceId))
    issues.push(
      'DEPLOYMENT_INSTANCE_ID must be a lowercase deployment identifier.'
    );
  if (
    productionLike &&
    ['default', 'shared', 'development'].includes(instanceId)
  )
    issues.push(
      'DEPLOYMENT_INSTANCE_ID must identify an isolated environment.'
    );

  const databaseUrl = urlValue(
    environment,
    'DATABASE_URL',
    ['postgres:', 'postgresql:'],
    issues
  );
  const redisUrl = urlValue(
    environment,
    'REDIS_URL',
    ['redis:', 'rediss:'],
    issues
  );
  const appUrl = urlValue(
    environment,
    'APP_BASE_URL',
    ['http:', 'https:'],
    issues
  );
  const authUrl = urlValue(
    environment,
    'BETTER_AUTH_URL',
    ['http:', 'https:'],
    issues
  );
  if (appUrl) validateOrigin('APP_BASE_URL', appUrl, issues);
  if (authUrl) validateOrigin('BETTER_AUTH_URL', authUrl, issues);
  if (appUrl && authUrl && appUrl.origin !== authUrl.origin)
    issues.push('APP_BASE_URL and BETTER_AUTH_URL must use the same origin.');
  if (productionLike && !stagingLocalDrill) {
    for (const [name, url] of [
      ['APP_BASE_URL', appUrl],
      ['BETTER_AUTH_URL', authUrl],
    ] as const) {
      if (url?.protocol !== 'https:') issues.push(`${name} must use HTTPS.`);
      if (url && isLocalHost(url.hostname))
        issues.push(`${name} must not use a local hostname.`);
    }
  }

  const nextPublicUrl = value(environment, 'NEXT_PUBLIC_APP_URL');
  if (nextPublicUrl && appUrl) {
    try {
      if (new URL(nextPublicUrl).origin !== appUrl.origin)
        issues.push('NEXT_PUBLIC_APP_URL must match APP_BASE_URL.');
    } catch {
      issues.push('NEXT_PUBLIC_APP_URL must be a valid absolute URL.');
    }
  }

  const origins = required(environment, 'BETTER_AUTH_TRUSTED_ORIGINS', issues)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.some((origin) => origin.includes('*')))
    issues.push('BETTER_AUTH_TRUSTED_ORIGINS must not contain wildcards.');
  const normalizedOrigins: string[] = [];
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      validateOrigin('BETTER_AUTH_TRUSTED_ORIGINS', parsed, issues);
      if (productionLike && !stagingLocalDrill && parsed.protocol !== 'https:')
        issues.push('Trusted origins must use HTTPS outside development.');
      if (productionLike && !stagingLocalDrill && isLocalHost(parsed.hostname))
        issues.push(
          'Trusted origins must not use local hostnames outside development.'
        );
      normalizedOrigins.push(parsed.origin);
    } catch {
      issues.push('BETTER_AUTH_TRUSTED_ORIGINS contains an invalid URL.');
    }
  }
  if (authUrl && !normalizedOrigins.includes(authUrl.origin))
    issues.push('BETTER_AUTH_TRUSTED_ORIGINS must include BETTER_AUTH_URL.');

  const authSecret = required(environment, 'BETTER_AUTH_SECRET', issues);
  const apiKeyPepper = required(environment, 'API_KEY_PEPPER', issues);
  if (authSecret && authSecret.length < 32)
    issues.push('BETTER_AUTH_SECRET must contain at least 32 characters.');
  if (apiKeyPepper && apiKeyPepper.length < 32)
    issues.push('API_KEY_PEPPER must contain at least 32 characters.');
  const webhookKey = required(
    environment,
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
    issues
  );
  if (webhookKey && Buffer.from(webhookKey, 'base64').length !== 32)
    issues.push(
      'WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes.'
    );

  const executionEnabled = booleanValue(
    environment,
    'EXECUTION_ENABLED',
    true,
    issues
  );
  if (
    executionEnabled &&
    !value(environment, 'GROQ_API_KEY') &&
    !value(environment, 'NVIDIA_API_KEY')
  )
    issues.push(
      'At least one of GROQ_API_KEY or NVIDIA_API_KEY is required when execution is enabled.'
    );
  if (
    value(environment, 'NVIDIA_API_KEY') &&
    !value(environment, 'NVIDIA_NIM_ALLOWED_MODELS')
  )
    warnings.push(
      'NVIDIA_API_KEY is configured, but no compatibility-proven NVIDIA NIM model IDs are enabled.'
    );
  if (productionLike) {
    const token = required(environment, 'OBSERVABILITY_TOKEN', issues);
    if (token && token.length < 32)
      issues.push('OBSERVABILITY_TOKEN must contain at least 32 characters.');
    if (
      booleanValue(
        environment,
        'WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS',
        false,
        issues
      )
    )
      issues.push(
        'WEBHOOK_ALLOW_LOOPBACK_ENDPOINTS must be false outside development.'
      );
  }

  const billingEnabled = booleanValue(
    environment,
    'BILLING_ENABLED',
    false,
    issues
  );
  if (billingEnabled) {
    const stripeKey = required(environment, 'STRIPE_SECRET_KEY', issues);
    required(environment, 'STRIPE_WEBHOOK_SECRET', issues);
    required(environment, 'STRIPE_PRO_MONTHLY_PRICE_ID', issues);
    for (const name of [
      'STRIPE_CHECKOUT_SUCCESS_URL',
      'STRIPE_CHECKOUT_CANCEL_URL',
      'STRIPE_PORTAL_RETURN_URL',
    ]) {
      const redirect = urlValue(environment, name, ['https:'], issues);
      if (redirect && appUrl && redirect.origin !== appUrl.origin)
        issues.push(`${name} must use APP_BASE_URL origin.`);
    }
    if (
      deploymentEnvironment === 'staging' &&
      !stripeKey.startsWith('sk_test_')
    )
      issues.push('Staging billing must use a Stripe test-mode secret key.');
    if (
      deploymentEnvironment === 'production' &&
      !stripeKey.startsWith('sk_live_')
    )
      issues.push('Production billing must use a Stripe live-mode secret key.');
  }

  const emailEnabled = booleanValue(
    environment,
    'EMAIL_ENABLED',
    false,
    issues
  );
  if (emailEnabled) {
    const provider = required(environment, 'EMAIL_PROVIDER', issues);
    required(environment, 'EMAIL_FROM', issues);
    if (provider === 'resend') required(environment, 'EMAIL_API_KEY', issues);
    if (deploymentEnvironment === 'production' && provider !== 'resend')
      issues.push('Production email must use the configured resend provider.');
    if (
      deploymentEnvironment === 'staging' &&
      value(environment, 'STAGING_EMAIL_MODE') !== 'sandbox'
    )
      issues.push('Staging email requires STAGING_EMAIL_MODE=sandbox.');
  }

  const artifactDriver =
    value(environment, 'ARTIFACT_STORAGE_DRIVER') || 'local';
  if (!['local', 's3'].includes(artifactDriver))
    issues.push('ARTIFACT_STORAGE_DRIVER must be local or s3.');
  if (artifactDriver === 's3') {
    for (const name of [
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ])
      required(environment, name, issues);
    const endpoint = value(environment, 'S3_ENDPOINT');
    if (endpoint) {
      try {
        const parsed = new URL(endpoint);
        if (productionLike && parsed.protocol !== 'https:')
          issues.push('S3_ENDPOINT must use HTTPS outside development.');
      } catch {
        issues.push('S3_ENDPOINT must be a valid URL.');
      }
    }
  } else if (productionLike) {
    warnings.push(
      'Local artifact storage is host-bound; S3-compatible private storage is recommended.'
    );
  }

  if (deploymentEnvironment === 'production') {
    for (const name of [
      'LEGAL_ENTITY_NAME',
      'PRIVACY_CONTACT_EMAIL',
      'SECURITY_CONTACT_EMAIL',
    ])
      required(environment, name, issues);
  }
  if (databaseUrl && productionLike && !databaseUrl.searchParams.has('sslmode'))
    warnings.push(
      'DATABASE_URL does not declare sslmode; verify provider-enforced TLS.'
    );
  if (redisUrl && productionLike && redisUrl.protocol !== 'rediss:')
    warnings.push(
      'REDIS_URL is not rediss://; verify private-network or provider TLS controls.'
    );
  if (stagingLocalDrill)
    warnings.push(
      'STAGING_LOCAL_DRILL permits local HTTP only for the disposable local staging drill.'
    );

  if (issues.length)
    throw new DeploymentConfigurationError([...new Set(issues)]);
  return {
    environment: deploymentEnvironment,
    instanceId,
    appOrigin: appUrl!.origin,
    databaseUrl: databaseUrl!.toString(),
    redisUrl: redisUrl!.toString(),
    billingEnabled,
    emailEnabled,
    artifactDriver: artifactDriver as 'local' | 's3',
    warnings,
  };
}
