import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = path.join(process.cwd(), 'dashboard');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(dashboard, relativePath), 'utf8');
}

describe('Phase 3B UI and API contract wiring', () => {
  it('locks an agents-table run action immediately per agent', () => {
    const page = source('src/app/dashboard/agents/page.tsx');
    const table = source('src/components/dashboard/agent-table.tsx');
    expect(page).toContain('runningAgentIds.has(agentId)');
    expect(page).toContain('new Set(current).add(agentId)');
    expect(table).toContain('disabled={runningAgentIds.has(agent.id)}');
    expect(table).toContain("'Starting...'");
  });

  it('locks the detail run action while starting or active', () => {
    const detail = source('src/components/dashboard/agent-detail-client.tsx');
    expect(detail).toContain('if (starting || running) return');
    expect(detail).toContain('disabled={starting || running}');
    expect(detail).toContain("'Starting...'");
  });

  it('renders a safe active-run link for duplicate conflicts', () => {
    for (const relativePath of [
      'src/app/dashboard/agents/page.tsx',
      'src/components/dashboard/agent-detail-client.tsx',
    ]) {
      const content = source(relativePath);
      expect(content).toContain("payload?.code === 'AGENT_RUN_ALREADY_ACTIVE'");
      expect(content).toContain('/dashboard/runs/${activeRunId}');
      expect(content).toContain('View active run');
    }
  });

  it('renders TIMED_OUT in badges and run filters', () => {
    expect(source('src/components/dashboard/status-badge.tsx')).toContain(
      "normalized === 'TIMED_OUT'"
    );
    expect(source('src/app/dashboard/runs/page.tsx')).toContain(
      '<option value="TIMED_OUT">Timed out</option>'
    );
  });

  it('keeps request disconnection independent from execution cancellation', () => {
    const route = source('src/app/api/agents/[id]/run/route.ts');
    const engine = source('src/lib/browser/engine.ts');
    expect(route).not.toContain('request.signal');
    expect(engine).not.toContain('AbortController');
    expect(engine).toContain('withWallClockTimeout');
  });

  it('contains database-backed active-agent race protection', () => {
    const migration = source(
      'prisma/migrations/20260725010000_phase3b_reliable_execution/migration.sql'
    );
    expect(migration).toContain('CREATE UNIQUE INDEX');
    expect(migration).toContain("WHERE \"status\" IN ('QUEUED', 'RUNNING')");
    const producer = source('src/lib/queue/run-producer.ts');
    expect(producer).toContain('pg_advisory_xact_lock');
    expect(producer).toContain('enforceAdmissionQuota');
  });

  it('provides explicit dry-run maintenance scripts', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['maintenance:recover-stale-runs']).toBeTruthy();
    expect(packageJson.scripts['maintenance:cleanup-artifacts']).toBeTruthy();
    expect(source('scripts/cleanup-artifacts.ts')).toContain(
      "!process.argv.includes('--apply')"
    );
  });
});
