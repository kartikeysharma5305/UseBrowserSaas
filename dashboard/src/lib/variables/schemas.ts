import { z } from 'zod';

export const VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
export const RESERVED_VARIABLE_KEYS = new Set([
  'agent_id',
  'run_id',
  'user_id',
  'configuration',
  'model',
  'password',
  'token',
]);

const constraintsSchema = z
  .object({
    minLength: z.number().int().min(0).max(4000).optional(),
    maxLength: z.number().int().min(1).max(4000).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minLength !== undefined &&
      value.maxLength !== undefined &&
      value.minLength > value.maxLength
    )
      context.addIssue({ code: 'custom', message: 'Invalid length range.' });
    if (
      value.min !== undefined &&
      value.max !== undefined &&
      value.min > value.max
    )
      context.addIssue({ code: 'custom', message: 'Invalid numeric range.' });
  });

export const agentVariableDefinitionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(
        VARIABLE_KEY_PATTERN,
        'Use lowercase letters, numbers and underscores.'
      )
      .refine(
        (key) => !RESERVED_VARIABLE_KEYS.has(key),
        'This variable name is reserved.'
      ),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).optional().nullable(),
    type: z.enum(['TEXT', 'URL', 'NUMBER', 'BOOLEAN', 'SECRET']),
    required: z.boolean().default(false),
    defaultValue: z.string().max(4000).optional().nullable(),
    constraints: constraintsSchema.optional().default({}),
    displayOrder: z.number().int().min(0).max(49),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === 'SECRET' && value.defaultValue)
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Secret variables cannot have defaults.',
      });
    if (value.defaultValue) {
      if (value.type === 'URL') {
        try {
          const url = new URL(value.defaultValue);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['defaultValue'],
            message: 'Default must be an HTTP(S) URL.',
          });
        }
      }
      if (
        value.type === 'NUMBER' &&
        !Number.isFinite(Number(value.defaultValue))
      )
        context.addIssue({
          code: 'custom',
          path: ['defaultValue'],
          message: 'Default must be a number.',
        });
      if (
        value.type === 'BOOLEAN' &&
        !['true', 'false'].includes(value.defaultValue)
      )
        context.addIssue({
          code: 'custom',
          path: ['defaultValue'],
          message: 'Default must be true or false.',
        });
    }
    if (
      value.type !== 'TEXT' &&
      (value.constraints.minLength !== undefined ||
        value.constraints.maxLength !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints'],
        message: 'Length constraints require a text variable.',
      });
    if (
      value.type !== 'NUMBER' &&
      (value.constraints.min !== undefined ||
        value.constraints.max !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints'],
        message: 'Numeric constraints require a number variable.',
      });
  });

export const agentVariablesSchema = z
  .array(agentVariableDefinitionSchema)
  .max(20)
  .superRefine((variables, context) => {
    const keys = new Set<string>();
    for (const [index, variable] of variables.entries()) {
      if (keys.has(variable.key))
        context.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: 'Variable keys must be unique.',
        });
      keys.add(variable.key);
    }
  });

export const variableValuesSchema = z
  .record(
    z.string().regex(VARIABLE_KEY_PATTERN),
    z.union([z.string().max(4000), z.number().finite(), z.boolean()])
  )
  .superRefine((value, context) => {
    if (Object.keys(value).length > 20)
      context.addIssue({
        code: 'custom',
        message: 'Too many variable values.',
      });
  });

export const replaceVariablesSchema = z
  .object({ variables: agentVariablesSchema })
  .strict();

export type AgentVariableDefinitionInput = z.infer<
  typeof agentVariableDefinitionSchema
>;
export type VariableValuesInput = z.infer<typeof variableValuesSchema>;
