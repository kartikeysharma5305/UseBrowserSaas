import { describe, expect, it } from 'vitest';

import {
  RELIABILITY_BENCHMARK_CASES,
  SAFETY_BENCHMARK_CASES,
} from '../dashboard/src/lib/reliability/benchmark-catalogue.js';
import { classifyBenchmarkFailure } from '../dashboard/src/lib/reliability/classification.js';

describe('agent reliability benchmark policy', () => {
  it('keeps the external catalogue bounded and on safe public fixtures', () => {
    expect(RELIABILITY_BENCHMARK_CASES).toHaveLength(12);
    expect(
      new Set(RELIABILITY_BENCHMARK_CASES.map((item) => item.category))
    ).toEqual(
      new Set([
        'DIRECT_EXTRACTION',
        'SEARCH_NAVIGATION',
        'MULTI_PAGE',
        'FORM_INTERACTION',
        'STRUCTURED_RESULT',
      ])
    );
    for (const item of RELIABILITY_BENCHMARK_CASES) {
      expect(['example.com', 'en.wikipedia.org']).toContain(
        new URL(item.targetWebsite).hostname
      );
      expect(item.maxSteps).toBeGreaterThanOrEqual(10);
      expect(item.maxSteps).toBeLessThanOrEqual(20);
      expect(item.timeoutMs).toBeGreaterThanOrEqual(300_000);
      expect(item.timeoutMs).toBeLessThanOrEqual(600_000);
    }
    expect(SAFETY_BENCHMARK_CASES).toHaveLength(2);
  });

  it('uses bounded diagnostic categories without raw error labels', () => {
    expect(
      classifyBenchmarkFailure({
        status: 'FAILED',
        failureCode: 'AI_PROVIDER_RATE_LIMITED',
      })
    ).toBe('PROVIDER');
    expect(
      classifyBenchmarkFailure({
        status: 'FAILED',
        failureCode: 'EXECUTION_STEP_LIMIT_EXCEEDED',
      })
    ).toBe('STEP_LIMIT');
    expect(
      classifyBenchmarkFailure({
        status: 'FAILED',
        failureCode: 'PRIVATE_NETWORK_BLOCKED',
      })
    ).toBe('SAFETY_BLOCK');
    expect(
      classifyBenchmarkFailure({
        status: 'SUCCESS',
        structuredStatus: 'PARSE_FAILED',
      })
    ).toBe('STRUCTURED_RESULT');
    expect(
      classifyBenchmarkFailure({
        status: 'SUCCESS',
        expectedUrlMatched: true,
        expectedTextMatched: false,
      })
    ).toBe('EXTRACTION');
  });
});
