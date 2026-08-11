import { spawnSync } from 'node:child_process';

import { validateDeploymentEnvironment } from '../src/lib/deployment/environment';

try {
  const config = validateDeploymentEnvironment();
  if (!['staging', 'production'].includes(config.environment))
    throw new Error(
      'Migration deployment is only available for staging or production.'
    );
  if (process.env.MIGRATION_BACKUP_VERIFIED !== 'true')
    throw new Error(
      'Set MIGRATION_BACKUP_VERIFIED=true only after verifying a current database backup.'
    );
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath!, 'exec', 'prisma', 'migrate', 'deploy'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    }
  );
  if (result.status !== 0) throw new Error('prisma migrate deploy failed.');
  console.info(
    `[migration-deploy] Applied additive migrations to ${config.environment}/${config.instanceId}.`
  );
} catch (error) {
  console.error(
    `[migration-deploy] ERROR ${error instanceof Error ? error.message : 'Migration deployment failed.'}`
  );
  process.exitCode = 1;
}
