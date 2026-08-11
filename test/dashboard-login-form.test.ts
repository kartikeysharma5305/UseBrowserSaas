import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  handleLoginSubmit,
  stripSensitiveLoginQueryParams,
  submitLoginForm,
} from '../dashboard/src/components/auth/auth-forms.js';

describe('dashboard login form regression checks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          pathname: '/login',
          search: '',
          hash: '',
        },
        history: {
          replaceState: vi.fn(),
        },
      },
      configurable: true,
    });
  });

  it('prevents native navigation and posts credentials as JSON instead of query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    const router = {
      push: vi.fn(),
      refresh: vi.fn(),
    };
    const setError = vi.fn();
    const setSubmitting = vi.fn();
    const formData = new FormData();
    formData.set('email', 'user@example.com');
    formData.set('password', 'example-password');

    const event = {
      preventDefault: vi.fn(),
      currentTarget: formData,
    } as Pick<React.FormEvent<HTMLFormElement>, 'preventDefault' | 'currentTarget'> & {
      currentTarget: FormData;
    };

    await handleLoginSubmit(
      event,
      router,
      setError,
      setSubmitting,
      false,
      fetchMock
    );

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sign-in/email',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'example-password',
        }),
      })
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain('?');
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(setSubmitting.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenCalledWith(null);
  });

  it('blocks duplicate submissions while authentication is already pending', async () => {
    const fetchMock = vi.fn();
    const router = {
      push: vi.fn(),
      refresh: vi.fn(),
    };
    const event = {
      preventDefault: vi.fn(),
      currentTarget: new FormData(),
    } as any;

    await handleLoginSubmit(
      event,
      router,
      vi.fn(),
      vi.fn(),
      true,
      fetchMock
    );

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('removes legacy email/password query params from the URL', () => {
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          pathname: '/login',
          search: '?email=user@example.com&password=example-password',
          hash: '',
        },
        history: {
          replaceState,
        },
      },
      configurable: true,
    });

    stripSensitiveLoginQueryParams();

    expect(replaceState).toHaveBeenCalledWith({}, '', '/login');
  });

  it('shows a safe failure message without exposing internal password/provider details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Invalid credentials.' }),
    });
    const router = {
      push: vi.fn(),
      refresh: vi.fn(),
    };
    const setError = vi.fn();
    const formData = new FormData();
    formData.set('email', 'user@example.com');
    formData.set('password', 'wrong-password');

    await submitLoginForm(
      {
        preventDefault: vi.fn(),
        currentTarget: formData,
      } as any,
      router,
      setError,
      vi.fn(),
      fetchMock
    );

    expect(setError).toHaveBeenCalledWith('Invalid credentials.');
    const finalError = setError.mock.calls.at(-1)?.[0];
    expect(finalError).toBe('Invalid credentials.');
    expect(String(finalError)).not.toContain('password');
    expect(String(finalError)).not.toContain('database');
  });

  it('does not render a form with native action/method attributes that would leak credentials', () => {
    const authFormsSource = readFileSync(
      './dashboard/src/components/auth/auth-forms.tsx',
      'utf8'
    );
    const loginFormMatch = authFormsSource.match(
      /export\s+function\s+LoginForm\(\)[\s\S]*?return\s*\(([\s\S]*?)\)\s*;/
    );
    expect(loginFormMatch).not.toBeNull();
    const formJsx = loginFormMatch![1];
    expect(formJsx).not.toMatch(/<form[^>]*\baction\b/);
    expect(formJsx).not.toMatch(/<form[^>]*\bmethod\s*=\s*["'][^"']*get["']/i);
  });

  it('allows Next.js dev eval-based source maps in the CSP', () => {
    const nextConfigSource = readFileSync(
      './dashboard/next.config.ts',
      'utf8'
    );
    expect(nextConfigSource).toMatch(/script-src[^;]*'unsafe-eval'/);
  });
});
