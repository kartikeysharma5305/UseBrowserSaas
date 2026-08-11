import type { ZodType } from 'zod';
import { handleValidationError, jsonError } from '@/lib/api/route-helpers';
import { SECURITY_POLICY } from '@/lib/security/policy';

export async function parseWebhookManagementBody<T>(
  request: Request,
  schema: ZodType<T>
) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (
    Number.isFinite(declared) &&
    declared > SECURITY_POLICY.bodyBytes.webhookManagement
  )
    return {
      ok: false as const,
      response: jsonError('Request body is too large.', 413),
    };
  try {
    const text = await request.text();
    if (
      Buffer.byteLength(text, 'utf8') >
      SECURITY_POLICY.bodyBytes.webhookManagement
    )
      return {
        ok: false as const,
        response: jsonError('Request body is too large.', 413),
      };
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return {
        ok: false as const,
        response: handleValidationError(parsed.error),
      };
    return { ok: true as const, data: parsed.data };
  } catch {
    return {
      ok: false as const,
      response: jsonError('Invalid request body.', 400),
    };
  }
}
