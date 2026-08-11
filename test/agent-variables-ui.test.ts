import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Phase 9 variable UI and redaction contract', () => {
  const fields = fs.readFileSync(
    'dashboard/src/components/dashboard/agent-variable-fields.tsx',
    'utf8'
  );
  const detail = fs.readFileSync(
    'dashboard/src/components/dashboard/agent-detail-client.tsx',
    'utf8'
  );
  const schedule = fs.readFileSync(
    'dashboard/src/components/dashboard/schedule-form.tsx',
    'utf8'
  );
  const run = fs.readFileSync(
    'dashboard/src/components/dashboard/run-detail-client.tsx',
    'utf8'
  );

  it('provides definition management, ordering and validation controls', () => {
    expect(fields).toContain('Add variable');
    expect(fields).toContain('Move up');
    expect(fields).toContain('Move down');
    expect(fields).toContain('Minimum');
    expect(fields).toContain('Maximum');
  });

  it('uses password fields and never browser storage for secret inputs', () => {
    expect(fields).toContain("variable.type === 'SECRET'");
    expect(fields).toContain("'password'");
    expect(fields).not.toMatch(/localStorage|sessionStorage/);
  });

  it('posts manual values under the existing Run route with busy protection', () => {
    expect(detail).toContain('fetch(`/api/agents/${id}/run`');
    expect(detail).toContain('JSON.stringify({ variables: variableValues })');
    expect(detail).toContain('if (starting || running) return');
  });

  it('captures Schedule values without putting them in URLs', () => {
    expect(schedule).toContain('variables: variableValues');
    expect(schedule).toMatch(/Secret variables cannot\s+be scheduled/);
    expect(schedule).not.toContain('URLSearchParams(variableValues');
  });

  it('renders immutable Run inputs and masks any secret entry', () => {
    expect(run).toContain('Run input snapshot');
    expect(run).toContain("input.type === 'SECRET'");
    expect(run).toContain('••••••••');
  });
});
