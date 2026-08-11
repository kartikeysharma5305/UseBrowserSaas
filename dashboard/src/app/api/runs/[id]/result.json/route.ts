import { jsonError, requireAuthenticatedUser } from '@/lib/api/route-helpers';
import { runIdSchema } from '@/lib/api/schemas';
import { buildOwnedJsonDownload } from '@/lib/structured-results/downloads';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuthenticatedUser();
  if (!user) return jsonError('Unauthorized.', 401);
  const parsed = runIdSchema.safeParse(await params);
  if (!parsed.success) return jsonError('Run not found.', 404);
  const download = await buildOwnedJsonDownload(user.id, parsed.data.id);
  if (!download) return jsonError('Structured result not found.', 404);
  return new Response(download.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${download.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
