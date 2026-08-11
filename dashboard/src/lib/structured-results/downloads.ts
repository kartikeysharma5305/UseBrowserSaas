import { prisma } from '@/lib/db/prisma';

const MAX_DOWNLOAD_BYTES = 1_000_000;

function publicFileName(runId: string, extension: 'json' | 'csv') {
  return `run-${runId.slice(0, 12)}-result.${extension}`;
}

export async function getOwnedStructuredResult(userId: string, runId: string) {
  const run = await prisma.run.findFirst({
    where: { id: runId, agent: { userId } },
    select: { id: true, structuredStatus: true, structuredResult: true },
  });
  if (
    !run ||
    !['VALID', 'PARTIAL'].includes(run.structuredStatus) ||
    run.structuredResult === null
  )
    return null;
  return run;
}

export async function buildOwnedJsonDownload(userId: string, runId: string) {
  const run = await getOwnedStructuredResult(userId, runId);
  if (!run) return null;
  const body = `${JSON.stringify(run.structuredResult, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > MAX_DOWNLOAD_BYTES) return null;
  return { body, fileName: publicFileName(run.id, 'json') };
}

function safeCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function structuredResultToCsv(value: unknown): string | null {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length || rows.length > 10_000) return null;
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
    return null;
  const keys = [
    ...new Set(
      rows.flatMap((row) => Object.keys(row as Record<string, unknown>))
    ),
  ];
  if (!keys.length || keys.length > 100) return null;
  const body =
    [
      keys.map(safeCell).join(','),
      ...rows.map((row) =>
        keys
          .map((key) => safeCell((row as Record<string, unknown>)[key]))
          .join(',')
      ),
    ].join('\r\n') + '\r\n';
  return Buffer.byteLength(body, 'utf8') <= MAX_DOWNLOAD_BYTES ? body : null;
}

export async function buildOwnedCsvDownload(userId: string, runId: string) {
  const run = await getOwnedStructuredResult(userId, runId);
  if (!run) return null;
  const body = structuredResultToCsv(run.structuredResult);
  return body ? { body, fileName: publicFileName(run.id, 'csv') } : null;
}
