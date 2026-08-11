export interface ExecutionModelOption {
  id: string;
  provider: 'groq' | 'nvidia';
  label: string;
}

export function providerLabel(provider: ExecutionModelOption['provider']) {
  return provider === 'nvidia' ? 'NVIDIA NIM' : 'Groq';
}
