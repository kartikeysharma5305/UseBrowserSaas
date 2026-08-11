import { TemplateCatalogue } from '@/components/dashboard/template-catalogue';

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">
          Safe starting points
        </p>
        <h1 className="text-3xl font-semibold">Agent templates</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Choose a bounded public-web task, preview its safety guidance, then
          customize it into an ordinary Agent.
        </p>
      </div>
      <TemplateCatalogue />
    </div>
  );
}
