'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { AgentVariableView } from '@/lib/variables/client-types';

export type PublicTemplate = {
  id: string;
  version: number;
  title: string;
  description: string;
  category: string;
  suggestedName: string;
  suggestedGoal: string;
  targetWebsiteGuidance: string;
  expectedResult: string;
  safetyNotes: string;
  successExample: string;
  failureGuidance: string;
  requiredPlaceholders: string[];
  recommendedTimeoutMs: number;
  recommendedMaxSteps: number;
  appliedRecommendation: {
    timeoutMs: number;
    maxSteps: number;
    adjusted: boolean;
  };
  variables?: AgentVariableView[];
};

export function TemplateCatalogue() {
  const [templates, setTemplates] = useState<PublicTemplate[] | null>(null);
  const [category, setCategory] = useState('ALL');
  const [selected, setSelected] = useState<PublicTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/templates', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setTemplates((await response.json()).data.templates);
      })
      .catch((loadError) => {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        )
          return;
        setError('Unable to load templates. Please try again.');
      });
    return () => controller.abort();
  }, []);
  const categories = useMemo(
    () => ['ALL', ...new Set((templates ?? []).map((item) => item.category))],
    [templates]
  );
  const visible = (templates ?? []).filter(
    (template) => category === 'ALL' || template.category === category
  );

  if (!templates && !error)
    return (
      <div
        aria-label="Loading templates"
        className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
      />
    );
  if (error)
    return (
      <Card className="p-6 text-sm text-red-700 dark:text-red-300">
        {error}
      </Card>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" aria-label="Template categories">
        {categories.map((item) => (
          <Button
            key={item}
            variant={category === item ? 'primary' : 'secondary'}
            onClick={() => setCategory(item)}
          >
            {item === 'ALL' ? 'All templates' : item.toLowerCase()}
          </Button>
        ))}
      </div>
      {visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No templates in this category.
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((template) => (
          <Card key={template.id} className="flex flex-col p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {template.category}
            </p>
            <h2 className="mt-2 text-lg font-semibold">{template.title}</h2>
            <p className="mt-2 flex-1 text-sm text-slate-600 dark:text-slate-300">
              {template.description}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => setSelected(template)}>
                Preview
              </Button>
              <Link
                href={`/dashboard/agents/create?template=${encodeURIComponent(template.id)}`}
              >
                <Button>Use template</Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
      {selected ? (
        <Card className="p-6" role="region" aria-label="Template preview">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Preview
              </p>
              <h2 className="text-xl font-semibold">{selected.title}</h2>
            </div>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Close preview
            </Button>
          </div>
          <dl className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <dt className="text-sm font-medium">Suggested task</dt>
              <dd className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {selected.suggestedGoal}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium">Expected result</dt>
              <dd className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {selected.expectedResult}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium">Safety</dt>
              <dd className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {selected.safetyNotes}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium">If it fails</dt>
              <dd className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {selected.failureGuidance}
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
