import { BillingDashboard } from '@/components/dashboard/billing-dashboard';

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Subscription and plan
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          Billing
        </h1>
      </div>
      <BillingDashboard />
    </div>
  );
}
