'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function stripSensitiveLoginQueryParams() {
  if (typeof window === 'undefined') return;

  const search = new URLSearchParams(window.location.search);
  const hasSensitiveParams = search.has('email') || search.has('password');

  if (!hasSensitiveParams) return;

  search.delete('email');
  search.delete('password');

  const nextUrl = `${window.location.pathname}${search.toString() ? `?${search.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

export async function submitLoginForm(
  event: Pick<
    React.FormEvent<HTMLFormElement>,
    'preventDefault' | 'currentTarget'
  >,
  router: Pick<ReturnType<typeof useRouter>, 'push' | 'refresh'>,
  setError: (value: string | null) => void,
  setIsSubmitting: (value: boolean) => void,
  fetchImpl: typeof fetch = fetch
) {
  event.preventDefault();
  setError(null);
  setIsSubmitting(true);

  const formData =
    event.currentTarget instanceof FormData
      ? event.currentTarget
      : new FormData(event.currentTarget as HTMLFormElement);
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  try {
    if (!email || !password) {
      throw new Error('Email and password are required.');
    }

    const response = await fetchImpl('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(payload?.message ?? 'Unable to sign in.');
    }

    router.push('/dashboard');
    router.refresh();
  } catch (submitError) {
    setError(
      submitError instanceof Error ? submitError.message : 'Unable to sign in.'
    );
  } finally {
    setIsSubmitting(false);
  }
}

export async function handleLoginSubmit(
  event: Pick<
    React.FormEvent<HTMLFormElement>,
    'preventDefault' | 'currentTarget'
  >,
  router: Pick<ReturnType<typeof useRouter>, 'push' | 'refresh'>,
  setError: (value: string | null) => void,
  setIsSubmitting: (value: boolean) => void,
  isSubmitting: boolean,
  fetchImpl: typeof fetch = fetch
) {
  if (isSubmitting) return;
  await submitLoginForm(event, router, setError, setIsSubmitting, fetchImpl);
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    stripSensitiveLoginQueryParams();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    await handleLoginSubmit(
      event,
      router,
      setError,
      setIsSubmitting,
      isSubmitting
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
        />
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Need an account?{' '}
        <Link
          href="/register"
          className="font-semibold text-slate-900 underline underline-offset-2 dark:text-white"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({
  betaMode = false,
  inviteToken = '',
}: {
  betaMode?: boolean;
  inviteToken?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') ?? '');
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const legalAccepted = formData.get('legalAccepted') === 'on';

    if (!legalAccepted) {
      setError('Accept the service terms to create an account.');
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(
        betaMode ? '/api/beta/register' : '/api/auth/sign-up/email',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            betaMode
              ? { name, email, password, inviteToken, legalAccepted: true }
              : { name, email, password, legalAccepted: true }
          ),
        }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? 'Unable to create account.');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to create account.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {betaMode ? (
        <input type="hidden" name="inviteToken" value={inviteToken} />
      ) : null}
      <div>
        <label
          htmlFor="name"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Full name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          placeholder="Alex Morgan"
          required
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
        />
      </div>
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-600"
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input name="legalAccepted" type="checkbox" required className="mt-1" />
        <span>
          By creating an account, you agree to the{' '}
          <Link href="/terms" className="underline underline-offset-2">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/acceptable-use" className="underline underline-offset-2">
            Acceptable Use Policy
          </Link>
          , and acknowledge the{' '}
          <Link href="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {error ? (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
      >
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-semibold text-slate-900 underline underline-offset-2 dark:text-white"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
