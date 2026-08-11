import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  runFindFirst: vi.fn(),
  artifactFindFirst: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  readStream: vi.fn(),
}));

vi.mock('@/lib/api/route-helpers', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuthenticatedUser: vi.fn(() => Promise.resolve(mocks.user)),
    handleValidationError: vi.fn(() =>
      NextResponse.json({ error: 'Validation failed.' }, { status: 400 })
    ),
    jsonError: vi.fn((message: string, status: number) =>
      NextResponse.json({ error: message }, { status })
    ),
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    run: { findFirst: mocks.runFindFirst },
    runArtifact: { findFirst: mocks.artifactFindFirst },
  },
}));

vi.mock('@/lib/browser/artifact-storage-factory', () => ({
  createArtifactStorage: vi.fn(() => ({
    read: mocks.read,
    stat: mocks.stat,
    readStream: mocks.readStream,
  })),
}));

import { GET as listArtifacts } from '../dashboard/src/app/api/runs/[id]/artifacts/route.js';
import { GET as readArtifact } from '../dashboard/src/app/api/runs/[id]/artifacts/[artifactId]/route.js';

const request = new NextRequest(
  'http://localhost:3001/api/runs/run-1/artifacts'
);
const runContext = { params: Promise.resolve({ id: 'run-1' }) };
const artifactContext = {
  params: Promise.resolve({ id: 'run-1', artifactId: 'artifact-1' }),
};
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test'),
]);
const artifact = {
  id: 'artifact-1',
  runId: 'run-1',
  type: 'SCREENSHOT',
  storageKey: 'runs/run-1/private-key.png',
  storageProvider: 'LOCAL',
  fileName: 'screenshot.png',
  mimeType: 'image/png',
  size: png.length,
  stepNumber: 1,
  eventSequence: 2,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('artifact API ownership and response safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'user-1' };
    mocks.runFindFirst.mockResolvedValue({ artifacts: [artifact] });
    mocks.artifactFindFirst.mockResolvedValue(artifact);
    mocks.read.mockResolvedValue(png);
    mocks.stat.mockResolvedValue({ size: png.length });
    mocks.readStream.mockImplementation(async () => Readable.from(png));
  });

  it('requires authentication before listing artifacts', async () => {
    mocks.user = null;
    const response = await listArtifacts(request, runContext);
    expect(response.status).toBe(401);
    expect(mocks.runFindFirst).not.toHaveBeenCalled();
  });

  it('allows an owner to list safe artifact metadata', async () => {
    const response = await listArtifacts(request, runContext);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      id: 'artifact-1',
      url: '/api/runs/run-1/artifacts/artifact-1',
    });
    expect(JSON.stringify(body)).not.toContain('storageKey');
    expect(JSON.stringify(body)).not.toContain('private-key.png');
  });

  it('returns the same 404 for missing and cross-user runs', async () => {
    mocks.runFindFirst.mockResolvedValue(null);
    const missing = await listArtifacts(request, runContext);
    const crossUser = await listArtifacts(request, runContext);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(await crossUser.json());
  });

  it('allows an owner to retrieve the image', async () => {
    const response = await readArtifact(request, artifactContext);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  it('scopes retrieval by user, run, and artifact IDs', async () => {
    await readArtifact(request, artifactContext);
    expect(mocks.artifactFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'artifact-1',
        runId: 'run-1',
        run: { agent: { userId: 'user-1' } },
        type: 'SCREENSHOT',
      },
    });
  });

  it('does not retrieve another run or user artifact', async () => {
    mocks.artifactFindFirst.mockResolvedValue(null);
    const response = await readArtifact(request, artifactContext);
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('sets private image security headers', async () => {
    const response = await readArtifact(request, artifactContext);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('content-disposition')).toContain('inline');
  });

  it('returns a controlled 404 for missing or size-mismatched files', async () => {
    mocks.stat.mockResolvedValue({ size: 2 });
    const response = await readArtifact(request, artifactContext);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(
      artifact.storageKey
    );
  });
});
