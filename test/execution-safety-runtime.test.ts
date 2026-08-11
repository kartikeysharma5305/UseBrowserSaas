import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { normalizeSafetyPolicy } from '@/lib/execution-safety/policy';
import { ExecutionSafetyGuard, installExecutionSafetyGuard } from '@/lib/execution-safety/runtime-guard';
import { ExecutionServiceError } from '@/lib/execution/errors';
import { isRetryableExecutionFailure } from '@/lib/worker/browser-run-processor';

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('worker execution safety guard', () => {
  it('retries transient DNS resolution but not deterministic safety rejection', () => {
    expect(isRetryableExecutionFailure(new ExecutionServiceError('NETWORK_RESOLUTION_FAILED'))).toBe(true);
    expect(isRetryableExecutionFailure(new ExecutionServiceError('PRIVATE_NETWORK_BLOCKED'))).toBe(false);
    expect(isRetryableExecutionFailure(new ExecutionServiceError('DOMAIN_NOT_ALLOWED'))).toBe(false);
  });

  it('blocks disallowed initial/model navigation and unsafe redirects', async () => {
    const guard = new ExecutionSafetyGuard(normalizeSafetyPolicy({ allowedDomains: ['example.com', 'example.org'] }, 'https://example.com'), 'https://example.com', publicResolver);
    await expect(guard.assertNavigation('https://attacker.test')).rejects.toMatchObject({ code: 'DOMAIN_NOT_ALLOWED' });
    await expect(guard.assertNavigation('https://example.org', 'redirect')).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' });
  });

  it('enforces deterministic navigation and page limits', async () => {
    const guard = new ExecutionSafetyGuard(normalizeSafetyPolicy({ allowedDomains: ['example.com'], maxNavigations: 1, maxPages: 1 }, 'https://example.com'), 'https://example.com', publicResolver);
    await guard.assertNavigation('https://example.com/a');
    await expect(guard.assertNavigation('https://example.com/b')).rejects.toMatchObject({ code: 'NAVIGATION_LIMIT_EXCEEDED' });
    expect(() => guard.assertPageCount(2)).toThrowError('Page limit exceeded.');
  });

  it('blocks payment, destructive, unsafe-form and upload actions', () => {
    const safeOnly = new ExecutionSafetyGuard(normalizeSafetyPolicy(null, 'https://example.com'), 'https://example.com', publicResolver);
    expect(() => safeOnly.assertClick({ tag_name: 'button', inner_text: 'Confirm purchase' })).toThrowError('Payment action blocked by execution safety policy.');
    expect(() => safeOnly.assertClick({ tag_name: 'button', inner_text: 'Delete account' })).toThrowError();
    const blockedForms = new ExecutionSafetyGuard(normalizeSafetyPolicy({ formSubmissionMode: 'BLOCKED' }, 'https://example.com'), 'https://example.com', publicResolver);
    expect(() => blockedForms.assertClick({ attributes: { type: 'submit' }, inner_text: 'Submit' })).toThrowError('Form submission blocked by execution safety policy.');
  });

  it('wraps worker session navigation, clicks, pages and uploads', async () => {
    const page = { url: () => 'https://example.com' };
    const session: Record<string, any> = {
      browser_context: { pages: () => [page] },
      navigate_to: vi.fn(async () => undefined),
      create_new_tab: vi.fn(async () => undefined),
      validate_page_after_action: vi.fn(async () => undefined),
      _click_element_node: vi.fn(async () => undefined),
      upload_file: vi.fn(async () => undefined),
    };
    const guard = new ExecutionSafetyGuard(normalizeSafetyPolicy(null, 'https://example.com'), 'https://example.com', publicResolver);
    installExecutionSafetyGuard(session, guard);
    await expect(session.navigate_to('https://attacker.test')).rejects.toMatchObject({ code: 'DOMAIN_NOT_ALLOWED' });
    await expect(session._click_element_node({ inner_text: 'Buy now' })).rejects.toMatchObject({ code: 'PAYMENT_ACTION_BLOCKED' });
    await expect(session.upload_file({}, 'worker-secret')).rejects.toMatchObject({ code: 'UPLOAD_BLOCKED' });
  });

  it('wires immutable snapshots through admission, scheduling, retries and worker execution', () => {
    const root = process.cwd();
    const producer = fs.readFileSync(path.join(root, 'dashboard/src/lib/queue/run-producer.ts'), 'utf8');
    const processor = fs.readFileSync(path.join(root, 'dashboard/src/lib/worker/browser-run-processor.ts'), 'utf8');
    const schema = fs.readFileSync(path.join(root, 'dashboard/prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('executionSafetyPolicy');
    expect(producer).toContain('executionSafetyPolicy: safetyPolicyInput(safetyPolicy)');
    expect(producer).toContain('resolved.targetWebsite');
    expect(processor).toContain('claimed.executionSafetyPolicy');
    expect(processor).not.toContain('claimed.agent.safetyPolicy');
  });

  it('keeps API ownership checks and exposes the responsive safety editor', () => {
    const root = process.cwd();
    const route = fs.readFileSync(path.join(root, 'dashboard/src/app/api/agents/[id]/route.ts'), 'utf8');
    const create = fs.readFileSync(path.join(root, 'dashboard/src/app/dashboard/agents/create/page.tsx'), 'utf8');
    const detail = fs.readFileSync(path.join(root, 'dashboard/src/components/dashboard/agent-detail-client.tsx'), 'utf8');
    expect(route).toContain('verifyAgentAccess(parsedId.data.id, user.id)');
    expect(create).toContain('Execution safety');
    expect(detail).toContain('Worker-enforced rules');
    expect(detail).toContain('md:grid-cols-2');
  });
});
