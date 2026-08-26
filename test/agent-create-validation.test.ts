import { beforeEach, describe, expect, it } from 'vitest';

import { createAgentSchema } from '../dashboard/src/lib/api/schemas';
import { parseDomainListInput } from '../dashboard/src/lib/execution-safety/domain-input';
import { parseValidatedBody } from '../dashboard/src/lib/api/route-helpers';

const payload = {
  name: 'Production test agent',
  description: '',
  goal: 'Visit the target and return a concise result.',
  targetWebsite: 'https://example.com',
  status: 'ACTIVE',
  scheduleType: 'MANUAL',
  scheduleConfig: {},
  configuration: {
    model: 'nvidia_nemotron-3-ultra-550b-a55b',
    maxSteps: 25,
    timeoutMs: 900_000,
    browserSettings: {
      headless: true,
      viewportWidth: 1440,
      viewportHeight: 900,
    },
  },
  variables: [],
  safetyPolicy: {
    allowedDomains: ['example.com', 'www.example.com'],
    blockedDomains: [],
    allowSubdomains: true,
    redirectPolicy: 'SAME_DOMAIN',
    allowDownloads: false,
    allowUploads: false,
    formSubmissionMode: 'BLOCKED',
    allowDestructiveActions: false,
    maxNavigations: 20,
    maxPages: 6,
    sensitiveDomainMode: 'BLOCK',
  },
  outputSchema: null,
} as const;

function request(body: unknown) {
  return new Request('https://app.test/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Agent creation validation', () => {
  beforeEach(() => {
    process.env.NVIDIA_NIM_ALLOWED_MODELS = 'nvidia_nemotron-3-ultra-550b-a55b';
  });

  it('accepts the reported PRO configuration', () => {
    expect(createAgentSchema.safeParse(payload).success).toBe(true);
  });

  it('identifies the enforced download field instead of returning Invalid input', async () => {
    const result = await parseValidatedBody(
      request({
        ...payload,
        safetyPolicy: { ...payload.safetyPolicy, allowDownloads: true },
      }),
      createAgentSchema
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      error: 'Allow Downloads: Downloads must remain blocked.',
    });
  });

  it.each([
    {
      safetyPolicy: { ...payload.safetyPolicy, maxPages: 11 },
      message: 'Max Pages: Too big: expected number to be <=10',
    },
    {
      safetyPolicy: { ...payload.safetyPolicy, allowedDomains: [''] },
      message: 'Allowed Domains contains an empty entry.',
    },
  ])(
    'returns a field-level message for malformed safety input',
    async (testCase) => {
      const result = await parseValidatedBody(
        request({ ...payload, safetyPolicy: testCase.safetyPolicy }),
        createAgentSchema
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      await expect(result.response.json()).resolves.toEqual({
        error: testCase.message,
      });
    }
  );

  it('removes empty blocked-domain and trailing-comma entries in the form serializer', () => {
    expect(parseDomainListInput(' example.com, api.example.com, ')).toEqual([
      'example.com',
      'api.example.com',
    ]);
    expect(parseDomainListInput('   ')).toEqual([]);
    expect(parseDomainListInput(null)).toEqual([]);
  });
});
