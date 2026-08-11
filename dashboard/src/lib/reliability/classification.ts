import type { RunStatus, StructuredResultStatus } from '@prisma/client';

export const BENCHMARK_FAILURE_CATEGORIES = [
  'PROVIDER',
  'PLANNING',
  'WRONG_NAVIGATION',
  'ELEMENT_INTERACTION',
  'EXTRACTION',
  'REPEATED_ACTION',
  'FINALIZATION',
  'STRUCTURED_RESULT',
  'TIMEOUT',
  'STEP_LIMIT',
  'SAFETY_BLOCK',
  'BROWSER_RUNTIME',
  'WORKER_INFRASTRUCTURE',
  'NETWORK',
  'UNKNOWN',
] as const;
export type BenchmarkFailureCategory =
  (typeof BENCHMARK_FAILURE_CATEGORIES)[number];

export function classifyBenchmarkFailure(input: {
  status: RunStatus | string;
  failureCode?: string | null;
  structuredStatus?: StructuredResultStatus | string | null;
  expectedUrlMatched?: boolean;
  expectedTextMatched?: boolean;
  structuredMatched?: boolean;
  repeatedActions?: boolean;
}): BenchmarkFailureCategory | null {
  if (input.status === 'SUCCESS') {
    if (
      input.structuredMatched === false ||
      ['INVALID', 'PARSE_FAILED', 'TOO_LARGE'].includes(
        input.structuredStatus ?? ''
      )
    )
      return 'STRUCTURED_RESULT';
    if (input.expectedUrlMatched === false) return 'WRONG_NAVIGATION';
    if (input.expectedTextMatched === false) return 'EXTRACTION';
    return null;
  }
  const code = input.failureCode ?? '';
  if (/RATE|QUOTA|PROVIDER|MODEL|LLM/.test(code)) return 'PROVIDER';
  if (
    /DOMAIN|PRIVATE_NETWORK|UNSAFE|PAYMENT|DESTRUCTIVE|NAVIGATION_LIMIT|PAGE_LIMIT/.test(
      code
    )
  )
    return 'SAFETY_BLOCK';
  if (/TIME/.test(code) || input.status === 'TIMED_OUT') return 'TIMEOUT';
  if (/STEP/.test(code)) return 'STEP_LIMIT';
  if (/QUEUE|LEASE|HEARTBEAT|WORKER/.test(code)) return 'WORKER_INFRASTRUCTURE';
  if (/NETWORK|DNS|CONNECTION/.test(code)) return 'NETWORK';
  if (/BROWSER/.test(code)) return 'BROWSER_RUNTIME';
  if (
    ['INVALID', 'PARSE_FAILED', 'TOO_LARGE'].includes(
      input.structuredStatus ?? ''
    )
  )
    return 'STRUCTURED_RESULT';
  if (input.repeatedActions) return 'REPEATED_ACTION';
  return 'UNKNOWN';
}
