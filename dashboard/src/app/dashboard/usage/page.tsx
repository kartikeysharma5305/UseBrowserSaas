import { UsageDashboard } from '@/components/dashboard/usage-dashboard';

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Plan and metering
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          Usage
        </h1>
      </div>
      <UsageDashboard />
    </div>
  );
}
