import {
  DEFAULT_EXECUTION_MODEL,
  EXECUTION_MODEL_CATALOGUE,
} from './model-catalogue';

export const GROQ_MODEL_POLICY_VERIFIED_AT = '2026-07-25';

export const SUPPORTED_GROQ_MODELS = EXECUTION_MODEL_CATALOGUE.filter(
  (model) => model.provider === 'groq'
);

export type SupportedGroqModel = (typeof SUPPORTED_GROQ_MODELS)[number];
export type SupportedGroqModelId = SupportedGroqModel['id'];

export const DEFAULT_GROQ_MODEL = DEFAULT_EXECUTION_MODEL;

export function getSupportedGroqModel(
  value: unknown
): SupportedGroqModel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return SUPPORTED_GROQ_MODELS.find((model) => model.id === normalized) ?? null;
}

export function isSupportedGroqModelId(
  value: unknown
): value is SupportedGroqModelId {
  return getSupportedGroqModel(value) !== null;
}
