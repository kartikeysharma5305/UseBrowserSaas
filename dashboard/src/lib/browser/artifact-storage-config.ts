import type { ArtifactStorageProvider } from '@prisma/client';

export interface S3ArtifactStorageConfiguration {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface ArtifactStorageConfiguration {
  driver: 'LOCAL' | 'S3';
  s3?: S3ArtifactStorageConfiguration;
}

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required when ARTIFACT_STORAGE_DRIVER=s3.`);
  }
  return normalized;
}

function optionalHttpUrl(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function booleanSetting(name: string, value: string | undefined): boolean {
  if (!value?.trim()) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export function getArtifactStorageConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): ArtifactStorageConfiguration {
  const rawDriver = environment.ARTIFACT_STORAGE_DRIVER?.trim().toLowerCase();
  const driver = rawDriver || 'local';
  if (driver === 'local') return { driver: 'LOCAL' };
  if (driver !== 's3') {
    throw new Error('ARTIFACT_STORAGE_DRIVER must be local or s3.');
  }

  const s3 = {
    endpoint: optionalHttpUrl('S3_ENDPOINT', environment.S3_ENDPOINT),
    region: required('S3_REGION', environment.S3_REGION),
    bucket: required('S3_BUCKET', environment.S3_BUCKET),
    forcePathStyle: booleanSetting(
      'S3_FORCE_PATH_STYLE',
      environment.S3_FORCE_PATH_STYLE
    ),
  } as S3ArtifactStorageConfiguration;
  Object.defineProperties(s3, {
    accessKeyId: {
      value: required('S3_ACCESS_KEY_ID', environment.S3_ACCESS_KEY_ID),
      enumerable: false,
    },
    secretAccessKey: {
      value: required('S3_SECRET_ACCESS_KEY', environment.S3_SECRET_ACCESS_KEY),
      enumerable: false,
    },
  });
  return {
    driver: 'S3',
    s3,
  };
}

export function configuredArtifactStorageProvider(): ArtifactStorageProvider {
  return getArtifactStorageConfiguration().driver;
}

export function artifactStorageHealth() {
  const configuration = getArtifactStorageConfiguration();
  return {
    driver: configuration.driver.toLowerCase(),
    configured: true,
    endpointConfigured: Boolean(configuration.s3?.endpoint),
  };
}
