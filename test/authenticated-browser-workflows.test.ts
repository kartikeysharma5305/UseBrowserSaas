import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { EventCollector } from '@/lib/browser/event-collector';
import {
  domainScopedSecrets,
  protectedRunInputFingerprint,
  protectRunSecrets,
  redactRunSecretValue,
  redactRunSecrets,
  revealRunSecrets,
} from '@/lib/variables/run-secrets';

const previousKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

afterEach(() => {
  if (previousKey === undefined)
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  else process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = previousKey;
});

describe('authenticated browser workflow secret boundary', () => {
  it('encrypts a run-scoped secret, authenticates its Run identity, and redacts it', () => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const secret = 'LOGIN_TEST_SECRET_9f31_unique';
    const envelope = protectRunSecrets({ password: secret }, 'run-1', 'agent-1');
    expect(envelope).not.toBeNull();
    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(
      revealRunSecrets(
        { secretEnvelope: envelope } as never,
        'run-1',
        'agent-1'
      )
    ).toEqual({ password: secret });
    expect(() =>
      revealRunSecrets(
        { secretEnvelope: envelope } as never,
        'run-2',
        'agent-1'
      )
    ).toThrow();
    expect(redactRunSecrets(`echo ${secret}`, [secret])).toBe(
      'echo [redacted]'
    );
    const escapedSecret = 'LOGIN_TEST_SECRET_9f31_"quoted"';
    const safeError = redactRunSecretValue(
      { message: `failed with ${escapedSecret}`, nested: [escapedSecret] },
      [escapedSecret]
    );
    expect(JSON.stringify(safeError)).not.toContain('LOGIN_TEST_SECRET_9f31');
    expect(protectedRunInputFingerprint(secret)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('scopes credentials only to explicit allowed-domain patterns', () => {
    expect(
      domainScopedSecrets(
        { password: 'fake-password' },
        ['example.test', '*.example.test']
      )
    ).toEqual({
      'example.test': { password: 'fake-password' },
      '*.example.test': { password: 'fake-password' },
    });
  });

  it('redacts a unique secret from persisted step messages', () => {
    const secret = 'LOGIN_TEST_SECRET_9f31_event';
    const handlers = new Map<string, (event: unknown) => void>();
    const collector = new EventCollector(
      1,
      undefined,
      (value) => redactRunSecrets(value, [secret])
    );
    collector.attach({
      eventbus: {
        on(name, handler) {
          handlers.set(name, handler);
        },
      },
    });
    handlers.get('CreateAgentStepEvent')?.({
      step: 1,
      evaluation_previous_goal: `Typed ${secret}`,
      actions: [{ input_text: { text: secret } }],
    });
    const serialized = JSON.stringify(collector.toArray());
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[redacted]');
  });

  it('keeps the queue payload minimal and passes domain-scoped references to the engine', () => {
    const producer = fs.readFileSync(
      'dashboard/src/lib/queue/run-producer.ts',
      'utf8'
    );
    const processor = fs.readFileSync(
      'dashboard/src/lib/worker/browser-run-processor.ts',
      'utf8'
    );
    const engine = fs.readFileSync('dashboard/src/lib/browser/engine.ts', 'utf8');
    expect(producer).toContain('protectRunSecrets');
    expect(processor).toContain('revealRunSecrets');
    expect(processor).toContain('safeEngineDomainPatterns(safetyPolicy).allowed');
    expect(engine).toContain('sensitive_data: input.sensitiveData ?? null');
    expect(engine).toContain('{ captcha_solver: false }');
  });

  it('requires challenge stop behavior and bounds credential submission to one attempt', () => {
    const prompt = fs.readFileSync('src/agent/system_prompt.md', 'utf8');
    const resolver = fs.readFileSync(
      'dashboard/src/lib/variables/resolver.ts',
      'utf8'
    );
    expect(prompt).toContain('Never attempt to solve or bypass a CAPTCHA');
    expect(resolver).toContain('Submit the supplied credentials at most once');
    expect(resolver).toContain('MFA, OTP, a hardware key');
  });
});
