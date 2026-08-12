import { recordCurrentLegalAcceptance } from '@/lib/legal/acceptance';
import { logger } from '@/lib/logger';

type SignupHandler = (request: Request) => Promise<Response>;
type AcceptanceRecorder = (userId: string) => Promise<unknown>;

const LEGAL_ACCEPTANCE_FAILURE =
  'Account created, but legal acknowledgement was not recorded. Retry from Settings.';

function jsonResponseWithAuthHeaders(response: Response, message: string) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json');
  return Response.json({ message }, { status: 503, headers });
}

export async function completeEmailSignupWithLegalAcceptance(
  request: Request,
  signupHandler: SignupHandler,
  recordAcceptance: AcceptanceRecorder = recordCurrentLegalAcceptance
) {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;

  if (!body || body.legalAccepted !== true) {
    return Response.json(
      { message: 'Accept the service terms to create an account.' },
      { status: 400 }
    );
  }

  const { legalAccepted: _legalAccepted, ...authBody } = body;
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const authRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(authBody),
  });
  const response = await signupHandler(authRequest);
  if (!response.ok) return response;

  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { user?: { id?: unknown } } | null;
  const userId = payload?.user?.id;
  if (typeof userId !== 'string' || !userId) {
    return jsonResponseWithAuthHeaders(response, LEGAL_ACCEPTANCE_FAILURE);
  }

  try {
    await recordAcceptance(userId);
    return response;
  } catch (error) {
    const errorCode =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'LEGAL_ACCEPTANCE_WRITE_FAILED';
    logger.operation('error', {
      component: 'dashboard',
      event: 'signup_legal_acceptance_failed',
      errorCode,
    });
    return jsonResponseWithAuthHeaders(response, LEGAL_ACCEPTANCE_FAILURE);
  }
}
