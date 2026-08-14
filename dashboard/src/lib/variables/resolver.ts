import type { AgentVariableType, Prisma } from '@prisma/client';

import type { VariableValuesInput } from './schemas';

const PLACEHOLDER = /{{\s*([a-z][a-z0-9_]{0,47})\s*}}/g;
const ESCAPED_OPEN = '\u0000phase9-open\u0000';
const MAX_RENDERED_GOAL = 10_000;
const MAX_RENDERED_TARGET = 2_048;
export const REDACTED_SECRET = '••••••••';

export type VariableDefinition = {
  key: string;
  label: string;
  description?: string | null;
  type: AgentVariableType;
  required: boolean;
  defaultValue: string | null;
  constraints: Prisma.JsonValue | null;
  displayOrder: number;
};

export type PublicInputSnapshot = {
  schemaVersion: 1;
  definitionVersion: number;
  values: Array<{
    key: string;
    label: string;
    type: AgentVariableType;
    value: string | number | boolean;
    source: 'supplied' | 'default';
    redacted: boolean;
  }>;
  rendered: { goal: string; targetWebsite: string };
};

export type ResolvedAgentInput = {
  task: string;
  targetWebsite: string;
  snapshot: PublicInputSnapshot;
  secretValues: Record<string, string>;
};

export class VariableResolutionError extends Error {
  constructor(
    readonly code:
      | 'UNKNOWN_VARIABLE'
      | 'UNDECLARED_PLACEHOLDER'
      | 'MISSING_VARIABLE'
      | 'INVALID_VARIABLE_VALUE'
      | 'SECRET_VARIABLE_UNAVAILABLE'
      | 'RENDERED_INPUT_TOO_LARGE',
    message: string
  ) {
    super(message);
    this.name = 'VariableResolutionError';
  }
}

function constraints(definition: VariableDefinition) {
  return definition.constraints &&
    typeof definition.constraints === 'object' &&
    !Array.isArray(definition.constraints)
    ? (definition.constraints as Record<string, unknown>)
    : {};
}

function normalize(
  definition: VariableDefinition,
  raw: string | number | boolean
) {
  const rules = constraints(definition);
  if (definition.type === 'BOOLEAN') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new VariableResolutionError(
      'INVALID_VARIABLE_VALUE',
      `${definition.label} must be true or false.`
    );
  }
  if (definition.type === 'NUMBER') {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value))
      throw new VariableResolutionError(
        'INVALID_VARIABLE_VALUE',
        `${definition.label} must be a number.`
      );
    if (typeof rules.min === 'number' && value < rules.min)
      throw new VariableResolutionError(
        'INVALID_VARIABLE_VALUE',
        `${definition.label} is below its minimum.`
      );
    if (typeof rules.max === 'number' && value > rules.max)
      throw new VariableResolutionError(
        'INVALID_VARIABLE_VALUE',
        `${definition.label} is above its maximum.`
      );
    return value;
  }
  if (typeof raw !== 'string')
    throw new VariableResolutionError(
      'INVALID_VARIABLE_VALUE',
      `${definition.label} must be text.`
    );
  const value = definition.type === 'SECRET' ? raw : raw.trim();
  if (definition.type === 'URL') {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new VariableResolutionError(
        'INVALID_VARIABLE_VALUE',
        `${definition.label} must be an HTTP(S) URL.`
      );
    }
  }
  if (typeof rules.minLength === 'number' && value.length < rules.minLength)
    throw new VariableResolutionError(
      'INVALID_VARIABLE_VALUE',
      `${definition.label} is too short.`
    );
  if (typeof rules.maxLength === 'number' && value.length > rules.maxLength)
    throw new VariableResolutionError(
      'INVALID_VARIABLE_VALUE',
      `${definition.label} is too long.`
    );
  return value;
}

function render(
  template: string,
  values: Map<string, string | number | boolean>,
  declared: Set<string>
) {
  const escaped = template.replace(/\\{{/g, ESCAPED_OPEN);
  const rendered = escaped.replace(PLACEHOLDER, (_match, key: string) => {
    if (!declared.has(key))
      throw new VariableResolutionError(
        'UNDECLARED_PLACEHOLDER',
        `Declare the ${key} variable before running.`
      );
    if (!values.has(key))
      throw new VariableResolutionError(
        'MISSING_VARIABLE',
        `Provide a value for ${key}.`
      );
    return String(values.get(key));
  });
  return rendered.replaceAll(ESCAPED_OPEN, '{{');
}

export function detectedPlaceholders(...templates: string[]) {
  const keys = new Set<string>();
  for (const template of templates) {
    const candidate = template.replace(/\\{{/g, ESCAPED_OPEN);
    for (const match of candidate.matchAll(PLACEHOLDER)) keys.add(match[1]);
  }
  return [...keys];
}

export function resolveAgentInput(input: {
  goal: string;
  targetWebsite: string;
  definitions: VariableDefinition[];
  supplied?: VariableValuesInput;
  definitionVersion: number;
}): ResolvedAgentInput {
  const supplied = input.supplied ?? {};
  const definitions = [...input.definitions].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );
  const byKey = new Map(
    definitions.map((definition) => [definition.key, definition])
  );
  for (const key of Object.keys(supplied))
    if (!byKey.has(key))
      throw new VariableResolutionError(
        'UNKNOWN_VARIABLE',
        `Unknown variable: ${key}.`
      );
  const placeholders = detectedPlaceholders(input.goal, input.targetWebsite);
  for (const key of placeholders)
    if (!byKey.has(key))
      throw new VariableResolutionError(
        'UNDECLARED_PLACEHOLDER',
        `Declare the ${key} variable before running.`
      );

  const targetPlaceholders = new Set(detectedPlaceholders(input.targetWebsite));
  for (const definition of definitions)
    if (definition.type === 'SECRET') {
      if (definition.key.endsWith('bu_2fa_code'))
        throw new VariableResolutionError(
          'INVALID_VARIABLE_VALUE',
          'MFA and OTP secrets are not supported.'
        );
      if (targetPlaceholders.has(definition.key))
        throw new VariableResolutionError(
          'INVALID_VARIABLE_VALUE',
          'Secret variables cannot be used in the target URL.'
        );
    }

  const values = new Map<string, string | number | boolean>();
  const secretValues: Record<string, string> = Object.create(null);
  const snapshotValues: PublicInputSnapshot['values'] = [];
  for (const definition of definitions) {
    const hasSupplied = Object.prototype.hasOwnProperty.call(
      supplied,
      definition.key
    );
    const raw = hasSupplied
      ? supplied[definition.key]
      : definition.defaultValue;
    const needed = definition.required || placeholders.includes(definition.key);
    if (raw === null || raw === undefined || raw === '') {
      if (needed)
        throw new VariableResolutionError(
          'MISSING_VARIABLE',
          `Provide a value for ${definition.label}.`
        );
      continue;
    }
    const value = normalize(definition, raw);
    const secret = definition.type === 'SECRET';
    if (secret) {
      secretValues[definition.key] = String(value);
      values.set(definition.key, `<secret>${definition.key}</secret>`);
    } else {
      values.set(definition.key, value);
    }
    snapshotValues.push({
      key: definition.key,
      label: definition.label,
      type: definition.type,
      value: secret ? REDACTED_SECRET : value,
      source: hasSupplied ? 'supplied' : 'default',
      redacted: secret,
    });
  }
  const goal = render(input.goal, values, new Set(byKey.keys()));
  const targetWebsite = render(
    input.targetWebsite,
    values,
    new Set(byKey.keys())
  );
  if (
    goal.length > MAX_RENDERED_GOAL ||
    targetWebsite.length > MAX_RENDERED_TARGET
  )
    throw new VariableResolutionError(
      'RENDERED_INPUT_TOO_LARGE',
      'Resolved input is too large.'
    );
  try {
    const url = new URL(targetWebsite);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new VariableResolutionError(
      'INVALID_VARIABLE_VALUE',
      'Resolved target website must be an HTTP(S) URL.'
    );
  }
  const snapshot: PublicInputSnapshot = {
    schemaVersion: 1,
    definitionVersion: input.definitionVersion,
    values: snapshotValues,
    rendered: { goal, targetWebsite },
  };
  return {
    task: `${goal} Navigate to ${targetWebsite}.${
      Object.keys(secretValues).length
        ? ' Use secret references only in their intended editable sign-in fields. Submit the supplied credentials at most once. If login is rejected, or CAPTCHA, MFA, OTP, a hardware key, account lock, or another verification challenge appears, stop and report that user interaction is required. Never reveal a secret in the result.'
        : ''
    }`,
    targetWebsite,
    snapshot,
    secretValues,
  };
}

export function publicSnapshot(
  value: Prisma.JsonValue | null
): PublicInputSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.definitionVersion !== 'number' ||
    !Array.isArray(candidate.values) ||
    !candidate.rendered ||
    typeof candidate.rendered !== 'object' ||
    Array.isArray(candidate.rendered)
  )
    return null;
  const rendered = candidate.rendered as Record<string, unknown>;
  if (
    typeof rendered.goal !== 'string' ||
    typeof rendered.targetWebsite !== 'string'
  )
    return null;
  const values = candidate.values.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (
      typeof item.key !== 'string' ||
      typeof item.label !== 'string' ||
      !['TEXT', 'URL', 'NUMBER', 'BOOLEAN', 'SECRET'].includes(
        String(item.type)
      ) ||
      !['supplied', 'default'].includes(String(item.source))
    )
      return [];
    const secret = item.type === 'SECRET' || item.redacted === true;
    const safeValue = secret ? REDACTED_SECRET : item.value;
    if (
      typeof safeValue !== 'string' &&
      typeof safeValue !== 'number' &&
      typeof safeValue !== 'boolean'
    )
      return [];
    return [
      {
        key: item.key.slice(0, 48),
        label: item.label.slice(0, 80),
        type: item.type as AgentVariableType,
        value: safeValue,
        source: item.source as 'supplied' | 'default',
        redacted: secret,
      },
    ];
  });
  return {
    schemaVersion: 1,
    definitionVersion: candidate.definitionVersion,
    values,
    rendered: {
      goal: rendered.goal.slice(0, MAX_RENDERED_GOAL),
      targetWebsite: rendered.targetWebsite.slice(0, MAX_RENDERED_TARGET),
    },
  };
}
