'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

export interface OutputFieldView {
  key: string;
  label: string;
  type:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'url'
    | 'date'
    | 'enum'
    | 'array'
    | 'object';
  required: boolean;
  enumValues?: string[];
  fields?: OutputFieldView[];
  item?: {
    type: Exclude<OutputFieldView['type'], 'array'>;
    fields?: OutputFieldView[];
    enumValues?: string[];
  };
}

function NestedFieldsEditor({
  fields,
  onApply,
}: {
  fields: OutputFieldView[];
  onApply: (fields: OutputFieldView[]) => void;
}) {
  const [draft, setDraft] = useState(JSON.stringify(fields, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(JSON.stringify(fields, null, 2)), [fields]);
  return (
    <div className="space-y-2 md:col-span-4">
      <label className="block text-xs font-medium">Nested object fields</label>
      <textarea
        aria-label="Nested object fields JSON"
        rows={6}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full rounded border p-2 font-mono text-xs dark:bg-slate-800"
      />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          try {
            const parsed = JSON.parse(draft) as unknown;
            if (!Array.isArray(parsed)) throw new Error();
            onApply(parsed as OutputFieldView[]);
            setError(null);
          } catch {
            setError('Enter a JSON array of bounded field definitions.');
          }
        }}
      >
        Apply nested fields
      </Button>
      <p className="text-xs text-slate-500">
        The server validates keys, types, depth, field count, and all bounds
        before saving.
      </p>
    </div>
  );
}

export interface OutputSchemaView {
  enabled: true;
  version: 1;
  mode: 'STRICT' | 'PARTIAL';
  fields: OutputFieldView[];
}

export function OutputSchemaEditor({
  value,
  onChange,
}: {
  value: OutputSchemaView | null;
  onChange: (value: OutputSchemaView | null) => void;
}) {
  const fields = value?.fields ?? [];
  const updateField = (index: number, patch: Partial<OutputFieldView>) => {
    if (!value) return;
    onChange({
      ...value,
      fields: value.fields.map((field, position) =>
        position === index ? { ...field, ...patch } : field
      ),
    });
  };
  const move = (index: number, delta: number) => {
    if (!value) return;
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...value, fields: next });
  };
  return (
    <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <legend className="font-semibold">Output schema</legend>
          <p className="text-sm text-slate-500">
            Validated structured results apply to future Runs only.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? {
                      enabled: true,
                      version: 1,
                      mode: 'STRICT',
                      fields: [
                        {
                          key: 'result',
                          label: 'Result',
                          type: 'string',
                          required: true,
                        },
                      ],
                    }
                  : null
              )
            }
          />
          Enable
        </label>
      </div>
      {value && (
        <>
          <label className="block max-w-xs space-y-1 text-sm">
            <span>Validation policy</span>
            <select
              className="w-full rounded border p-2 dark:bg-slate-800"
              value={value.mode}
              onChange={(event) =>
                onChange({
                  ...value,
                  mode: event.target.value as 'STRICT' | 'PARTIAL',
                })
              }
            >
              <option value="STRICT">Strict</option>
              <option value="PARTIAL">Keep valid partial fields</option>
            </select>
          </label>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={`${index}-${field.key}`}
                className="grid gap-2 rounded border p-3 md:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <input
                  aria-label={`Field ${index + 1} key`}
                  className="rounded border p-2 dark:bg-slate-800"
                  value={field.key}
                  maxLength={64}
                  placeholder="fieldKey"
                  onChange={(event) =>
                    updateField(index, { key: event.target.value })
                  }
                />
                <input
                  aria-label={`Field ${index + 1} label`}
                  className="rounded border p-2 dark:bg-slate-800"
                  value={field.label}
                  maxLength={120}
                  placeholder="Label"
                  onChange={(event) =>
                    updateField(index, { label: event.target.value })
                  }
                />
                <select
                  aria-label={`Field ${index + 1} type`}
                  className="rounded border p-2 dark:bg-slate-800"
                  value={field.type}
                  onChange={(event) =>
                    updateField(index, {
                      type: event.target.value as OutputFieldView['type'],
                    })
                  }
                >
                  {[
                    'string',
                    'number',
                    'integer',
                    'boolean',
                    'url',
                    'date',
                    'enum',
                    'array',
                    'object',
                  ].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <label className="text-xs">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        updateField(index, { required: event.target.checked })
                      }
                    />{' '}
                    Required
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => move(index, 1)}
                    disabled={index === fields.length - 1}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      onChange({
                        ...value,
                        fields: fields.filter(
                          (_, position) => position !== index
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                {field.type === 'enum' && (
                  <input
                    aria-label={`Field ${index + 1} enum values`}
                    className="rounded border p-2 md:col-span-4 dark:bg-slate-800"
                    value={(field.enumValues ?? []).join(', ')}
                    placeholder="Option A, Option B"
                    onChange={(event) =>
                      updateField(index, {
                        enumValues: event.target.value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}
                {field.type === 'object' && (
                  <NestedFieldsEditor
                    fields={field.fields ?? []}
                    onApply={(fields) => updateField(index, { fields })}
                  />
                )}
                {field.type === 'array' && (
                  <div className="space-y-2 md:col-span-4">
                    <label className="block text-xs font-medium">
                      Array item type
                    </label>
                    <select
                      aria-label={`Field ${index + 1} array item type`}
                      className="rounded border p-2 dark:bg-slate-800"
                      value={field.item?.type ?? 'string'}
                      onChange={(event) =>
                        updateField(index, {
                          item: {
                            type: event.target.value as Exclude<
                              OutputFieldView['type'],
                              'array'
                            >,
                          },
                        })
                      }
                    >
                      {[
                        'string',
                        'number',
                        'integer',
                        'boolean',
                        'url',
                        'date',
                        'enum',
                        'object',
                      ].map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    {field.item?.type === 'object' && (
                      <NestedFieldsEditor
                        fields={field.item.fields ?? []}
                        onApply={(fields) =>
                          updateField(index, {
                            item: { type: 'object', fields },
                          })
                        }
                      />
                    )}
                    {field.item?.type === 'enum' && (
                      <input
                        aria-label={`Field ${index + 1} array enum values`}
                        className="ml-2 rounded border p-2 dark:bg-slate-800"
                        value={(field.item.enumValues ?? []).join(', ')}
                        placeholder="Option A, Option B"
                        onChange={(event) =>
                          updateField(index, {
                            item: {
                              type: 'enum',
                              enumValues: event.target.value
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={fields.length >= 50}
            onClick={() =>
              onChange({
                ...value,
                fields: [
                  ...fields,
                  {
                    key: `field${fields.length + 1}`,
                    label: `Field ${fields.length + 1}`,
                    type: 'string',
                    required: false,
                  },
                ],
              })
            }
          >
            Add field
          </Button>
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Preview schema</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-100 p-3 dark:bg-slate-950">
              {JSON.stringify(value, null, 2)}
            </pre>
          </details>
        </>
      )}
    </fieldset>
  );
}
