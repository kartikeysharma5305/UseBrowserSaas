import { artifactIdSchema } from '@/lib/api/schemas';
import { authorizePublicApi, publicApiError } from '@/lib/public-api/auth';
import { openOwnedArtifact } from '@/lib/public-api/artifact-access';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizePublicApi(request, 'artifacts:read', 'retrieval');
  if (!auth.ok) return auth.response;
  const parsed = artifactIdSchema.safeParse({ artifactId: (await params).id });
  if (!parsed.success)
    return publicApiError('NOT_FOUND', 'Artifact not found.', 404);
  const artifact = await openOwnedArtifact(
    auth.principal.user.id,
    parsed.data.artifactId
  );
  if (!artifact) return publicApiError('NOT_FOUND', 'Artifact not found.', 404);
  return new Response(artifact.stream, {
    headers: {
      'Content-Type': artifact.mimeType,
      'Content-Length': String(artifact.size),
      'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
