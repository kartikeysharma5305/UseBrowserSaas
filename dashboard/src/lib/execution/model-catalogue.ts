export type ExecutionProvider = 'groq' | 'nvidia';

export interface ExecutionModelPolicy {
  id: string;
  provider: ExecutionProvider;
  providerModel: string;
  label: string;
  toolCalling: boolean;
  structuredOutput: 'native' | 'prompted';
  useVision: boolean;
  benchmarkEligible: boolean;
  candidate?: boolean;
}

export const EXECUTION_MODEL_CATALOGUE = [
  {
    id: 'groq_llama-3.3-70b-versatile',
    provider: 'groq',
    providerModel: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B Versatile',
    toolCalling: true,
    structuredOutput: 'native',
    useVision: false,
    benchmarkEligible: true,
  },
  {
    id: 'nvidia_nemotron-3-ultra-550b-a55b',
    provider: 'nvidia',
    providerModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'Nemotron 3 Ultra 550B A55B',
    toolCalling: true,
    structuredOutput: 'prompted',
    useVision: false,
    benchmarkEligible: true,
    candidate: true,
  },
  {
    id: 'nvidia_glm-5.2',
    provider: 'nvidia',
    providerModel: 'z-ai/glm-5.2',
    label: 'GLM-5.2',
    toolCalling: true,
    structuredOutput: 'prompted',
    useVision: false,
    benchmarkEligible: true,
    candidate: true,
  },
  {
    id: 'nvidia_minimax-m3',
    provider: 'nvidia',
    providerModel: 'minimaxai/minimax-m3',
    label: 'MiniMax M3',
    toolCalling: true,
    structuredOutput: 'prompted',
    useVision: false,
    benchmarkEligible: true,
    candidate: true,
  },
  {
    id: 'nvidia_laguna-xs-2.1',
    provider: 'nvidia',
    providerModel: 'poolside/laguna-xs-2.1',
    label: 'Laguna XS 2.1',
    toolCalling: true,
    structuredOutput: 'prompted',
    useVision: false,
    benchmarkEligible: true,
    candidate: true,
  },
] as const satisfies readonly ExecutionModelPolicy[];

export type ExecutionModelId = (typeof EXECUTION_MODEL_CATALOGUE)[number]['id'];
export const DEFAULT_EXECUTION_MODEL = EXECUTION_MODEL_CATALOGUE[0];

function approvedNvidiaIds(environment: NodeJS.ProcessEnv = process.env) {
  return new Set(
    (environment.NVIDIA_NIM_ALLOWED_MODELS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

/**
 * A candidate becomes selectable only after an operator records its exact ID
 * in NVIDIA_NIM_ALLOWED_MODELS following the compatibility probe.
 */
export function getSupportedExecutionModels(
  environment: NodeJS.ProcessEnv = process.env
): ExecutionModelPolicy[] {
  const approved = approvedNvidiaIds(environment);
  return EXECUTION_MODEL_CATALOGUE.filter(
    (model) => model.provider === 'groq' || approved.has(model.id)
  );
}

export function getExecutionModelCandidate(
  value: unknown
): ExecutionModelPolicy | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return (
    EXECUTION_MODEL_CATALOGUE.find((model) => model.id === normalized) ?? null
  );
}

export function getSupportedExecutionModel(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env
): ExecutionModelPolicy | null {
  const model = getExecutionModelCandidate(value);
  return model &&
    getSupportedExecutionModels(environment).some(
      (item) => item.id === model.id
    )
    ? model
    : null;
}

export function isSupportedExecutionModelId(
  value: unknown
): value is ExecutionModelId {
  return getSupportedExecutionModel(value) !== null;
}

export function isExecutionProviderConfigured(
  provider: ExecutionProvider,
  environment: NodeJS.ProcessEnv = process.env
) {
  return Boolean(
    (provider === 'groq'
      ? environment.GROQ_API_KEY
      : environment.NVIDIA_API_KEY
    )?.trim()
  );
}

export function getAvailableExecutionModels(
  environment: NodeJS.ProcessEnv = process.env
) {
  return getSupportedExecutionModels(environment).filter((model) =>
    isExecutionProviderConfigured(model.provider, environment)
  );
}

export function assertExecutionModelAvailable(
  modelId: string,
  environment: NodeJS.ProcessEnv = process.env
) {
  const model = getSupportedExecutionModel(modelId, environment);
  if (!model || !isExecutionProviderConfigured(model.provider, environment)) {
    throw new Error('The selected AI provider is unavailable.');
  }
  return model;
}
