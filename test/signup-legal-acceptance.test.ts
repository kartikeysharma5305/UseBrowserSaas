import { describe, expect, it, vi } from 'vitest';

import { completeEmailSignupWithLegalAcceptance } from '../dashboard/src/lib/auth/legal-signup';

function request(body: Record<string, unknown>) {
  return new Request('https://app.example.test/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('signup legal acknowledgement lifecycle', () => {
  it('persists acknowledgement for the user returned by signup before succeeding', async () => {
    const signup = vi.fn().mockResolvedValue(
      Response.json(
        { user: { id: 'created-user' }, token: 'not-inspected' },
        { headers: { 'set-cookie': 'session=opaque; HttpOnly; Secure' } }
      )
    );
    const record = vi.fn().mockResolvedValue(undefined);

    const response = await completeEmailSignupWithLegalAcceptance(
      request({
        name: 'User',
        email: 'user@example.test',
        password: 'valid-password',
        legalAccepted: true,
        userId: 'another-user',
      }),
      signup,
      record
    );

    expect(response.ok).toBe(true);
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith('created-user');
    const forwarded = await signup.mock.calls[0][0].json();
    expect(forwarded).not.toHaveProperty('legalAccepted');
  });

  it('rejects signup when explicit acknowledgement is absent', async () => {
    const signup = vi.fn();
    const record = vi.fn();
    const response = await completeEmailSignupWithLegalAcceptance(
      request({ name: 'User' }),
      signup,
      record
    );
    expect(response.status).toBe(400);
    expect(signup).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('preserves the authenticated recovery session when persistence fails', async () => {
    const signup = vi.fn().mockResolvedValue(
      Response.json(
        { user: { id: 'created-user' } },
        { headers: { 'set-cookie': 'session=opaque; HttpOnly; Secure' } }
      )
    );
    const response = await completeEmailSignupWithLegalAcceptance(
      request({ legalAccepted: true }),
      signup,
      vi.fn().mockRejectedValue(new Error('database detail'))
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await response.json()).toEqual({
      message:
        'Account created, but legal acknowledgement was not recorded. Retry from Settings.',
    });
  });

  it('does not record anything when auth fails or returns no authoritative user', async () => {
    const record = vi.fn();
    const authFailure = await completeEmailSignupWithLegalAcceptance(
      request({ legalAccepted: true }),
      vi.fn().mockResolvedValue(Response.json({}, { status: 422 })),
      record
    );
    expect(authFailure.status).toBe(422);
    expect(record).not.toHaveBeenCalled();

    const missingUser = await completeEmailSignupWithLegalAcceptance(
      request({ legalAccepted: true }),
      vi.fn().mockResolvedValue(Response.json({ token: 'opaque' })),
      record
    );
    expect(missingUser.status).toBe(503);
    expect(record).not.toHaveBeenCalled();
  });
});
