import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Browser Use Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600">
          Milestone 1 scaffold complete.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="rounded-md border px-4 py-2 text-sm font-medium"
          >
            Open Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
