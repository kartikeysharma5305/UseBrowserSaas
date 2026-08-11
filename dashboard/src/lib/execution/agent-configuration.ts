import {
  DEFAULT_EXECUTION_TIMEOUT_MS,
  normalizeExecutionTimeoutMs,
} from './configuration';
import {
  DEFAULT_EXECUTION_MODEL,
  getExecutionModelCandidate,
  type ExecutionProvider,
} from './model-catalogue';

export interface NormalizedAgentConfiguration {
  model: string;
  provider: ExecutionProvider;
  providerModel: string;
  maxSteps: number;
  timeoutMs: number;
  browserSettings: {
    headless: boolean;
    viewportWidth: number;
    viewportHeight: number;
    useVision: boolean;
  };
}

export function normalizeAgentConfiguration(
  raw: Record<string, unknown> | null | undefined
): NormalizedAgentConfiguration {
  const defaults: NormalizedAgentConfiguration = {
    model: DEFAULT_EXECUTION_MODEL.id,
    provider: DEFAULT_EXECUTION_MODEL.provider,
    providerModel: DEFAULT_EXECUTION_MODEL.providerModel,
    maxSteps: 25,
    timeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,
    browserSettings: {
      headless: true,
      viewportWidth: 1280,
      viewportHeight: 720,
      useVision: DEFAULT_EXECUTION_MODEL.useVision,
    },
  };
  const requestedModel =
    typeof raw?.model === 'string' && raw.model.trim()
      ? raw.model.trim()
      : defaults.model;
  const modelPolicy = getExecutionModelCandidate(requestedModel);
  if (!modelPolicy) {
    throw new Error(
      'The stored AI model is unavailable. Select a supported model.'
    );
  }
  const maxSteps =
    typeof raw?.maxSteps === 'number' &&
    Number.isInteger(raw.maxSteps) &&
    raw.maxSteps >= 1
      ? raw.maxSteps
      : defaults.maxSteps;
  const browser =
    typeof raw?.browserSettings === 'object' &&
    raw.browserSettings !== null &&
    !Array.isArray(raw.browserSettings)
      ? (raw.browserSettings as Record<string, unknown>)
      : {};

  return {
    model: modelPolicy.id,
    provider: modelPolicy.provider,
    providerModel: modelPolicy.providerModel,
    maxSteps,
    timeoutMs: normalizeExecutionTimeoutMs(
      raw?.timeoutMs ?? defaults.timeoutMs
    ),
    browserSettings: {
      headless:
        typeof browser.headless === 'boolean'
          ? browser.headless
          : defaults.browserSettings.headless,
      viewportWidth:
        typeof browser.viewportWidth === 'number' &&
        Number.isInteger(browser.viewportWidth)
          ? browser.viewportWidth
          : defaults.browserSettings.viewportWidth,
      viewportHeight:
        typeof browser.viewportHeight === 'number' &&
        Number.isInteger(browser.viewportHeight)
          ? browser.viewportHeight
          : defaults.browserSettings.viewportHeight,
      useVision: modelPolicy.useVision,
    },
  };
}
