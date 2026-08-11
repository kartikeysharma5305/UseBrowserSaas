import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(process.cwd(), 'dashboard');
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Phase 8 onboarding and template UI contract', () => {
  const catalogue = source('src/components/dashboard/template-catalogue.tsx');
  const wizard = source('src/components/dashboard/template-agent-wizard.tsx');
  const onboarding = source('src/components/dashboard/onboarding-card.tsx');

  it('supports loading, safe errors, category filtering, preview, and empty state', () => {
    expect(catalogue).toContain('Loading templates');
    expect(catalogue).toContain('Unable to load templates. Please try again.');
    expect(catalogue).toContain("category === 'ALL'");
    expect(catalogue).toContain('Template preview');
    expect(catalogue).toContain('No templates in this category.');
  });

  it('customizes templates and prevents duplicate Create and test submissions', () => {
    expect(wizard).toContain('Agent name');
    expect(wizard).toContain('Target website');
    expect(wizard).toContain('Agent task');
    expect(wizard).toContain('if (!template || busy) return');
    expect(wizard).toContain('Create only');
    expect(wizard).toContain('Create and test');
    expect(wizard).toContain('busy !== null');
    expect(wizard).toContain('Open the created Agent');
  });

  it('shows plan adjustment and safe task/failure guidance', () => {
    expect(wizard).toContain('Applied plan-safe limits');
    expect(wizard).toContain('adjusted to your current plan');
    expect(wizard).toContain('Write a reliable task');
    expect(wizard).toContain('Too vague:');
    expect(wizard).toContain('do not bypass');
    expect(wizard).not.toMatch(/stack|Prisma|apiKey|stripe/i);
  });

  it('shows authoritative checklist, skip, and settings reopen controls', () => {
    expect(onboarding).toContain("fetch('/api/onboarding'");
    expect(onboarding).toContain('First-run checklist');
    expect(onboarding).toContain('Skip for now');
    expect(onboarding).not.toContain("action: 'COMPLETE'");
    expect(
      source('src/components/dashboard/onboarding-controls.tsx')
    ).toContain("action: 'REOPEN'");
  });

  it('integrates responsive Templates navigation and the ordinary creation page', () => {
    expect(source('src/components/layout/sidebar.tsx')).toContain(
      "label: 'Templates'"
    );
    expect(source('src/components/layout/mobile-navigation.tsx')).toContain(
      "label: 'Templates'"
    );
    expect(source('src/app/dashboard/agents/create/page.tsx')).toContain(
      '<TemplateAgentWizard'
    );
    expect(catalogue).toContain('md:grid-cols-2');
  });
});
