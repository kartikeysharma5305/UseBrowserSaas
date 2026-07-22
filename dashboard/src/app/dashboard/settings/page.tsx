import { Card } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">Workspace settings</p>
        <h1 className="text-3xl font-semibold text-slate-900">Settings</h1>
      </div>

      <Card className="p-6">
        <p className="text-sm text-slate-600">
          Settings and workspace preferences will be added in the next
          milestone.
        </p>
      </Card>
    </div>
  );
}
