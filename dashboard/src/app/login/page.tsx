import { LoginForm } from '@/components/auth/auth-forms';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Browser Use
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
            Sign in to your dashboard
          </h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
