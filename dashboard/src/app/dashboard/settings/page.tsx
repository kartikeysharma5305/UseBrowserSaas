import { AccountDeletionCard } from '@/components/dashboard/account-deletion-card';
import { NotificationPreferences } from '@/components/dashboard/notification-preferences';
import { OnboardingControls } from '@/components/dashboard/onboarding-controls';
import { ApiKeyManagement } from '@/components/dashboard/api-key-management';
import { WebhookManagement } from '@/components/dashboard/webhook-management';
import { PrivacyDataCard } from '@/components/dashboard/privacy-data-card';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Workspace settings
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          Settings
        </h1>
      </div>

      <NotificationPreferences />
      <PrivacyDataCard />
      <OnboardingControls />
      <ApiKeyManagement />
      <WebhookManagement />
      <AccountDeletionCard />
    </div>
  );
}
