import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

export function parsePostgresUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A valid PostgreSQL target URL is required.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('A PostgreSQL target URL is required.');
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !url.username || !databaseName)
    throw new Error('The PostgreSQL URL is incomplete.');
  return { url, databaseName };
}

export function postgresEnvironment(value: string, base = process.env) {
  const { url, databaseName } = parsePostgresUrl(value);
  return {
    ...base,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName,
  };
}

export function sameDatabase(left: string, right: string) {
  const a = parsePostgresUrl(left);
  const b = parsePostgresUrl(right);
  return (
    a.url.hostname.toLowerCase() === b.url.hostname.toLowerCase() &&
    (a.url.port || '5432') === (b.url.port || '5432') &&
    a.databaseName === b.databaseName
  );
}

export function findPostgresTool(name: string, environment = process.env) {
  const configured = environment.POSTGRES_BIN?.trim();
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    configured ? path.join(configured, executable) : '',
    ...(process.platform === 'win32'
      ? ['18', '17', '16', '15'].map((version) =>
          path.join('C:\\Program Files\\PostgreSQL', version, 'bin', executable)
        )
      : []),
  ].filter(Boolean);
  return candidates.find(existsSync) ?? executable;
}

export async function runNative(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; capture?: boolean } = {}
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += String(chunk)));
    child.stderr?.on('data', (chunk) => (output += String(chunk)));
    child.once('error', () =>
      reject(
        new Error(
          `Required PostgreSQL tool ${path.basename(command)} is unavailable.`
        )
      )
    );
    child.once('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${path.basename(command)} failed with exit code ${code}.`
            )
          )
    );
  });
}

export async function migrationFingerprint(migrationsRoot: string) {
  const entries = (await fs.readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry);
    hash.update('\0');
    hash.update(
      await fs.readFile(path.join(migrationsRoot, entry, 'migration.sql'))
    );
    hash.update('\0');
  }
  return { count: entries.length, sha256: hash.digest('hex') };
}
