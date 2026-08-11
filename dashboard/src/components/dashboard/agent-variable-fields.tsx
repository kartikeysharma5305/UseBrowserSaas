'use client';

import { Button } from '@/components/ui/button';
import type {
  AgentVariableView,
  VariableValues,
} from '@/lib/variables/client-types';

const fieldClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

export function VariableValueFields({
  variables,
  values,
  onChange,
  idPrefix,
}: {
  variables: AgentVariableView[];
  values: VariableValues;
  onChange: (values: VariableValues) => void;
  idPrefix: string;
}) {
  if (!variables.length) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {variables.map((variable) => {
        const id = `${idPrefix}-${variable.key}`;
        const current = values[variable.key] ?? variable.defaultValue ?? '';
        return (
          <label key={variable.key} htmlFor={id} className="space-y-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {variable.label}
              {variable.required ? ' *' : ''}
            </span>
            {variable.type === 'BOOLEAN' ? (
              <select
                id={id}
                className={fieldClass}
                value={String(current)}
                onChange={(event) =>
                  onChange({
                    ...values,
                    [variable.key]: event.target.value === 'true',
                  })
                }
              >
                <option value="">Select…</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : (
              <input
                id={id}
                className={fieldClass}
                type={
                  variable.type === 'SECRET'
                    ? 'password'
                    : variable.type === 'NUMBER'
                      ? 'number'
                      : variable.type === 'URL'
                        ? 'url'
                        : 'text'
                }
                autoComplete={
                  variable.type === 'SECRET' ? 'new-password' : 'off'
                }
                required={variable.required && variable.type !== 'SECRET'}
                value={String(current)}
                onChange={(event) =>
                  onChange({ ...values, [variable.key]: event.target.value })
                }
              />
            )}
            {variable.description ? (
              <span className="block text-xs text-slate-500">
                {variable.description}
              </span>
            ) : null}
            {variable.type === 'SECRET' ? (
              <span className="block text-xs text-amber-700 dark:text-amber-300">
                Secure secret execution is deferred; this value will not be
                stored.
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

function reordered(variables: AgentVariableView[]) {
  return variables.map((variable, displayOrder) => ({
    ...variable,
    displayOrder,
  }));
}

export function AgentVariableEditor({
  variables,
  onChange,
}: {
  variables: AgentVariableView[];
  onChange: (variables: AgentVariableView[]) => void;
}) {
  const update = (index: number, changes: Partial<AgentVariableView>) =>
    onChange(
      variables.map((variable, current) =>
        current === index ? { ...variable, ...changes } : variable
      )
    );
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= variables.length) return;
    const next = [...variables];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(reordered(next));
  };
  return (
    <div className="space-y-3" aria-label="Agent variables">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reusable variables</h2>
          <p className="text-sm text-slate-500">
            Use declared keys as {'{{variable_name}}'} in the goal or target.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={variables.length >= 20}
          onClick={() =>
            onChange([
              ...variables,
              {
                key: `variable_${variables.length + 1}`,
                label: `Variable ${variables.length + 1}`,
                type: 'TEXT',
                required: false,
                defaultValue: '',
                constraints: {},
                displayOrder: variables.length,
              },
            ])
          }
        >
          Add variable
        </Button>
      </div>
      {variables.map((variable, index) => (
        <div
          key={`${index}-${variable.key}`}
          className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              Key
              <input
                aria-label={`Variable ${index + 1} key`}
                className={fieldClass}
                value={variable.key}
                onChange={(event) => update(index, { key: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              Label
              <input
                aria-label={`Variable ${index + 1} label`}
                className={fieldClass}
                value={variable.label}
                onChange={(event) =>
                  update(index, { label: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              Type
              <select
                aria-label={`Variable ${index + 1} type`}
                className={fieldClass}
                value={variable.type}
                onChange={(event) =>
                  update(index, {
                    type: event.target.value as AgentVariableView['type'],
                    defaultValue:
                      event.target.value === 'SECRET'
                        ? null
                        : variable.defaultValue,
                    constraints: {},
                  })
                }
              >
                <option value="TEXT">Text</option>
                <option value="URL">URL</option>
                <option value="NUMBER">Number</option>
                <option value="BOOLEAN">Boolean</option>
                <option value="SECRET">Secret (deferred)</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            Description
            <input
              aria-label={`Variable ${index + 1} description`}
              className={fieldClass}
              value={variable.description ?? ''}
              onChange={(event) =>
                update(index, { description: event.target.value })
              }
            />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={variable.required}
                onChange={(event) =>
                  update(index, { required: event.target.checked })
                }
              />
              Required
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              Default value
              <input
                aria-label={`Variable ${index + 1} default value`}
                className={fieldClass}
                type={variable.type === 'SECRET' ? 'password' : 'text'}
                disabled={variable.type === 'SECRET'}
                value={variable.defaultValue ?? ''}
                onChange={(event) =>
                  update(index, { defaultValue: event.target.value })
                }
              />
            </label>
          </div>
          {(variable.type === 'TEXT' || variable.type === 'NUMBER') && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                Minimum {variable.type === 'TEXT' ? 'length' : 'value'}
                <input
                  className={fieldClass}
                  type="number"
                  value={
                    variable.type === 'TEXT'
                      ? (variable.constraints?.minLength ?? '')
                      : (variable.constraints?.min ?? '')
                  }
                  onChange={(event) =>
                    update(index, {
                      constraints: {
                        ...variable.constraints,
                        [variable.type === 'TEXT' ? 'minLength' : 'min']:
                          event.target.value === ''
                            ? undefined
                            : Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                Maximum {variable.type === 'TEXT' ? 'length' : 'value'}
                <input
                  className={fieldClass}
                  type="number"
                  value={
                    variable.type === 'TEXT'
                      ? (variable.constraints?.maxLength ?? '')
                      : (variable.constraints?.max ?? '')
                  }
                  onChange={(event) =>
                    update(index, {
                      constraints: {
                        ...variable.constraints,
                        [variable.type === 'TEXT' ? 'maxLength' : 'max']:
                          event.target.value === ''
                            ? undefined
                            : Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => move(index, -1)}
              disabled={index === 0}
            >
              Move up
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => move(index, 1)}
              disabled={index === variables.length - 1}
            >
              Move down
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() =>
                onChange(
                  reordered(variables.filter((_, current) => current !== index))
                )
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
