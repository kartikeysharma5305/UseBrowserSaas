import { describe, expect, it } from 'vitest';

import {
  detectedPlaceholders,
  publicSnapshot,
  resolveAgentInput,
  VariableResolutionError,
  type VariableDefinition,
} from '@/lib/variables/resolver';
import {
  agentVariablesSchema,
  variableValuesSchema,
} from '@/lib/variables/schemas';

const definitions: VariableDefinition[] = [
  {
    key: 'website',
    label: 'Website',
    type: 'URL',
    required: true,
    defaultValue: null,
    constraints: {},
    displayOrder: 0,
  },
  {
    key: 'city',
    label: 'City',
    type: 'TEXT',
    required: false,
    defaultValue: 'Gurugram',
    constraints: { minLength: 2, maxLength: 100 },
    displayOrder: 1,
  },
  {
    key: 'count',
    label: 'Count',
    type: 'NUMBER',
    required: true,
    defaultValue: null,
    constraints: { min: 1, max: 20 },
    displayOrder: 2,
  },
  {
    key: 'enabled',
    label: 'Enabled',
    type: 'BOOLEAN',
    required: true,
    defaultValue: 'true',
    constraints: {},
    displayOrder: 3,
  },
];

describe('Phase 9 variable definitions', () => {
  it('accepts bounded definitions and rejects duplicates and reserved keys', () => {
    expect(
      agentVariablesSchema.safeParse(
        definitions.map((value) => ({
          ...value,
          constraints: value.constraints,
        }))
      ).success
    ).toBe(true);
    expect(
      agentVariablesSchema.safeParse([
        { ...definitions[0] },
        { ...definitions[0], displayOrder: 1 },
      ]).success
    ).toBe(false);
    expect(
      agentVariablesSchema.safeParse([{ ...definitions[0], key: 'run_id' }])
        .success
    ).toBe(false);
  });

  it('rejects invalid type constraints and secret defaults', () => {
    expect(
      agentVariablesSchema.safeParse([
        { ...definitions[0], constraints: { min: 1 } },
      ]).success
    ).toBe(false);
    expect(
      agentVariablesSchema.safeParse([
        {
          ...definitions[0],
          key: 'credential',
          type: 'SECRET',
          defaultValue: 'plaintext',
        },
      ]).success
    ).toBe(false);
  });

  it('bounds value count, keys and primitive shapes', () => {
    expect(variableValuesSchema.safeParse({ city: 'Gurugram' }).success).toBe(
      true
    );
    expect(variableValuesSchema.safeParse({ City: 'invalid' }).success).toBe(
      false
    );
    expect(
      variableValuesSchema.safeParse({ city: { nested: true } }).success
    ).toBe(false);
  });
});

describe('Phase 9 centralized resolution', () => {
  it('normalizes text, URL, number, boolean and server defaults', () => {
    const resolved = resolveAgentInput({
      goal: 'Check {{count}} results in {{city}} when {{enabled}}.',
      targetWebsite: '{{website}}',
      definitions,
      supplied: { website: 'https://example.com/path', count: '3' },
      definitionVersion: 4,
    });
    expect(resolved.snapshot).toMatchObject({
      schemaVersion: 1,
      definitionVersion: 4,
      rendered: {
        goal: 'Check 3 results in Gurugram when true.',
        targetWebsite: 'https://example.com/path',
      },
    });
    expect(resolved.snapshot.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'city', source: 'default' }),
        expect.objectContaining({ key: 'count', value: 3 }),
        expect.objectContaining({ key: 'enabled', value: true }),
      ])
    );
  });

  it.each([
    [{ website: 'https://example.com' }, 'MISSING_VARIABLE'],
    [
      { website: 'https://example.com', count: 2, extra: 'no' },
      'UNKNOWN_VARIABLE',
    ],
    [{ website: 'javascript:alert(1)', count: 2 }, 'INVALID_VARIABLE_VALUE'],
    [{ website: 'https://example.com', count: 99 }, 'INVALID_VARIABLE_VALUE'],
  ])(
    'fails safely for missing, unknown or invalid values',
    (supplied, code) => {
      expect(() =>
        resolveAgentInput({
          goal: 'Check {{count}} in {{city}}.',
          targetWebsite: '{{website}}',
          definitions,
          supplied,
          definitionVersion: 1,
        })
      ).toThrowError(expect.objectContaining({ code }));
    }
  );

  it('rejects undeclared placeholders and detects declared placeholders', () => {
    expect(detectedPlaceholders('Hello {{city}}', '\\{{literal}}')).toEqual([
      'city',
    ]);
    expect(() =>
      resolveAgentInput({
        goal: 'Use {{unknown}}',
        targetWebsite: 'https://example.com',
        definitions,
        supplied: { website: 'https://example.com', count: 1 },
        definitionVersion: 1,
      })
    ).toThrowError(expect.objectContaining({ code: 'UNDECLARED_PLACEHOLDER' }));
  });

  it('performs one plain-text interpolation pass without expression evaluation', () => {
    const resolved = resolveAgentInput({
      goal: 'Search {{city}} and preserve \\{{literal}}.',
      targetWebsite: '{{website}}',
      definitions,
      supplied: {
        website: 'https://example.com',
        city: '{{count}}; ${process.exit()}',
        count: 2,
      },
      definitionVersion: 1,
    });
    expect(resolved.snapshot.rendered.goal).toContain(
      '{{count}}; ${process.exit()}'
    );
    expect(resolved.snapshot.rendered.goal).toContain('{{literal}}');
  });

  it('bounds rendered output', () => {
    const largeDefinitions = definitions.map((definition) =>
      definition.key === 'city'
        ? { ...definition, constraints: { maxLength: 4000 } }
        : definition
    );
    expect(() =>
      resolveAgentInput({
        goal: '{{city}}'.repeat(4),
        targetWebsite: '{{website}}',
        definitions: largeDefinitions,
        supplied: {
          website: 'https://example.com',
          city: 'x'.repeat(4000),
          count: 1,
        },
        definitionVersion: 1,
      })
    ).toThrowError(
      expect.objectContaining({ code: 'RENDERED_INPUT_TOO_LARGE' })
    );
  });

  it('explicitly blocks secret execution without persisting or echoing plaintext', () => {
    const secretDefinitions: VariableDefinition[] = [
      {
        key: 'credential',
        label: 'Credential',
        type: 'SECRET',
        required: true,
        defaultValue: null,
        constraints: {},
        displayOrder: 0,
      },
    ];
    let caught: unknown;
    try {
      resolveAgentInput({
        goal: 'Use {{credential}}',
        targetWebsite: 'https://example.com',
        definitions: secretDefinitions,
        supplied: { credential: 'never-store-this' },
        definitionVersion: 1,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VariableResolutionError);
    expect(caught).toMatchObject({ code: 'SECRET_VARIABLE_UNAVAILABLE' });
    expect(String(caught)).not.toContain('never-store-this');
  });

  it('defensively redacts a secret-shaped public snapshot', () => {
    const snapshot = publicSnapshot({
      schemaVersion: 1,
      definitionVersion: 1,
      values: [
        {
          key: 'credential',
          label: 'Credential',
          type: 'SECRET',
          value: 'legacy-plaintext',
          source: 'supplied',
          redacted: false,
        },
      ],
      rendered: {
        goal: 'Safe rendered goal',
        targetWebsite: 'https://example.com',
      },
    });
    expect(snapshot?.values[0]).toMatchObject({
      value: '••••••••',
      redacted: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('legacy-plaintext');
  });

  it('keeps an admitted snapshot independent of later definitions', () => {
    const first = resolveAgentInput({
      goal: 'Visit {{city}}',
      targetWebsite: '{{website}}',
      definitions,
      supplied: { website: 'https://example.com', city: 'Delhi', count: 1 },
      definitionVersion: 1,
    }).snapshot;
    const serialized = JSON.stringify(first);
    definitions[1].defaultValue = 'Mumbai';
    expect(JSON.stringify(first)).toBe(serialized);
  });
});
