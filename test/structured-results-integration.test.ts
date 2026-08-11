import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createAgentSchema } from '../dashboard/src/lib/api/schemas';
import { AGENT_TEMPLATES } from '../dashboard/src/lib/templates/catalogue';
import { normalizeOutputSchema } from '../dashboard/src/lib/structured-results';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const validSchema = {
  enabled: true,
  version: 1,
  mode: 'STRICT',
  fields: [{ key: 'title', label: 'Title', type: 'string', required: true }],
};

describe('Phase 12 pipeline integration', () => {
  it('validates output schemas through the Agent API boundary', () => {
    const base = {
      name: 'Agent',
      goal: 'Read page',
      targetWebsite: 'https://example.com',
    };
    expect(
      createAgentSchema.safeParse({ ...base, outputSchema: validSchema })
        .success
    ).toBe(true);
    expect(
      createAgentSchema.safeParse({
        ...base,
        outputSchema: {
          ...validSchema,
          fields: [
            { key: '__proto__', label: 'Bad', type: 'string', required: true },
          ],
        },
      }).success
    ).toBe(false);
  });

  it('stores Agent definitions and immutable Run snapshots in one additive migration', () => {
    const schema = read('dashboard/prisma/schema.prisma');
    const migration = read(
      'dashboard/prisma/migrations/20260808010000_phase12_structured_results/migration.sql'
    );
    expect(schema).toMatch(/outputSchema\s+Json\?/);
    expect(schema).toContain('outputSchemaSnapshot');
    expect(migration).toContain('structuredStatus');
  });

  it('uses the shared admission path for manual and scheduled Runs', () => {
    const producer = read('dashboard/src/lib/queue/run-producer.ts');
    expect(producer).toContain('outputSchemaSnapshot');
    expect(producer).toContain('input.scheduled');
    expect(producer).toContain('structuredOutputInstruction');
    expect(producer.match(/transaction\.run\.create/g)).toHaveLength(1);
  });

  it('validates from the Run snapshot in terminal persistence and preserves summary', () => {
    const persistence = read('dashboard/src/lib/browser/run-persistence.ts');
    expect(persistence).toContain('existing.outputSchemaSnapshot');
    expect(persistence).toContain('summary: input.result.summary');
    expect(persistence).toContain('structuredValidatedAt');
  });

  it('keeps raw and candidate output out of the ordinary Run API', () => {
    const api = read('dashboard/src/lib/api/run-record.ts');
    expect(api).not.toContain('structuredRawResult:');
    expect(api).not.toContain('structuredCandidate:');
    expect(api).toContain('structuredResult:');
  });

  it('enforces ownership in both result-download service and routes', () => {
    const service = read('dashboard/src/lib/structured-results/downloads.ts');
    const route = read('dashboard/src/app/api/runs/[id]/result.json/route.ts');
    expect(service).toContain('agent: { userId }');
    expect(route).toContain('requireAuthenticatedUser');
    expect(route).toContain('buildOwnedJsonDownload(user.id');
  });

  it('provides authenticated JSON and CSV routes with safe headers', () => {
    for (const extension of ['json', 'csv']) {
      const route = read(
        `dashboard/src/app/api/runs/[id]/result.${extension}/route.ts`
      );
      expect(route).toContain('Content-Disposition');
      expect(route).toContain('private, no-store');
      expect(route).not.toContain('structuredRawResult');
    }
  });

  it('includes trusted source-controlled template schemas', () => {
    const templates = AGENT_TEMPLATES.filter(
      (template) => template.outputSchema
    );
    expect(templates.length).toBeGreaterThanOrEqual(3);
    for (const template of templates)
      expect(() => normalizeOutputSchema(template.outputSchema)).not.toThrow();
  });

  it('provides field editing, ordering, preview, partial warnings and downloads in the UI', () => {
    const editor = read(
      'dashboard/src/components/dashboard/output-schema-editor.tsx'
    );
    const run = read(
      'dashboard/src/components/dashboard/run-detail-client.tsx'
    );
    expect(editor).toContain('Add field');
    expect(editor).toContain('Preview schema');
    expect(editor).toContain('move(index');
    expect(run).toContain('Partial result');
    expect(run).toContain('Download JSON');
    expect(run).toContain('Download CSV');
  });

  it('does not interpolate variables into schema definitions', () => {
    const producer = read('dashboard/src/lib/queue/run-producer.ts');
    expect(producer.indexOf('resolveAgentInput')).toBeLessThan(
      producer.indexOf('normalizeOutputSchema')
    );
    expect(producer).not.toContain(
      'resolveAgentInput({\n          outputSchema'
    );
  });
});
