export const NVIDIA_NIM_MODEL_ALIASES = {
  'nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b',
  'glm-5.2': 'z-ai/glm-5.2',
  'minimax-m3': 'minimaxai/minimax-m3',
  'laguna-xs-2.1': 'poolside/laguna-xs-2.1',
} as const;

export type NvidiaNimModelAlias = keyof typeof NVIDIA_NIM_MODEL_ALIASES;

export function resolveNvidiaNimModel(alias: string): string | null {
  return NVIDIA_NIM_MODEL_ALIASES[alias as NvidiaNimModelAlias] ?? null;
}
