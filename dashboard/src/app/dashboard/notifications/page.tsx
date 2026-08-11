import { NotificationsDashboard } from '@/components/dashboard/notifications-dashboard';

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">
          Operational history
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          Notifications
        </h1>
      </div>
      <NotificationsDashboard />
    </div>
  );
}
