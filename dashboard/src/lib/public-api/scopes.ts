export const API_KEY_SCOPES = [
  'agents:read',
  'runs:read',
  'runs:create',
  'runs:cancel',
  'results:read',
  'artifacts:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
