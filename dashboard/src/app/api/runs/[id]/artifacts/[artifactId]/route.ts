import { NextRequest, NextResponse } from 'next/server';

import {
  handleValidationError,
  jsonError,
  requireAuthenticatedUser,
} from '@/lib/api/route-helpers';
import { artifactIdSchema, runIdSchema } from '@/lib/api/schemas';
import { openOwnedArtifact } from '@/lib/public-api/artifact-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);

  const values = await params;
  const runId = runIdSchema.safeParse({ id: values.id });
  const artifactId = artifactIdSchema.safeParse({
    artifactId: values.artifactId,
  });
  if (!runId.success) return handleValidationError(runId.error);
  if (!artifactId.success) return handleValidationError(artifactId.error);

  const artifact = await openOwnedArtifact(
    user.id,
    artifactId.data.artifactId,
    runId.data.id
  );
  if (!artifact) return jsonError('Artifact not found.', 404);
  return new NextResponse(artifact.stream, {
    headers: {
      'Content-Type': artifact.mimeType,
      'Content-Length': String(artifact.size),
      'Content-Disposition': `inline; filename="${artifact.fileName}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
