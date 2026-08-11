import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import {
  RELIABILITY_BENCHMARK_CASES,
  RELIABILITY_BENCHMARK_VERSION,
  SAFETY_BENCHMARK_CASES,
} from '../src/lib/reliability/benchmark-catalogue';
import { classifyBenchmarkFailure } from '../src/lib/reliability/classification';
import {
  assertExecutionModelAvailable,
  DEFAULT_EXECUTION_MODEL,
  getSupportedExecutionModel,
} from '../src/lib/execution/model-catalogue';

if (!/^(1|true|yes)$/i.test(process.env.AGENT_BENCHMARK_EXTERNAL ?? ''))
  throw new Error(
    'Set AGENT_BENCHMARK_EXTERNAL=true to permit bounded external execution.'
  );
const argument = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim();
const requestedModel =
  argument('model') ||
  process.env.AGENT_BENCHMARK_MODEL?.trim() ||
  DEFAULT_EXECUTION_MODEL.id;
const benchmarkModel = getSupportedExecutionModel(requestedModel);
if (!benchmarkModel || !benchmarkModel.benchmarkEligible)
  throw new Error('Select a supported benchmark-eligible model ID.');
const requestedProvider =
  argument('provider') || process.env.AGENT_BENCHMARK_PROVIDER?.trim();
if (requestedProvider && requestedProvider !== benchmarkModel.provider)
  throw new Error('The selected provider does not match the selected model.');
assertExecutionModelAvailable(benchmarkModel.id);
const prisma = new PrismaClient();
const origin =
  process.env.AGENT_BENCHMARK_URL?.trim() || 'http://localhost:3018';
const repeats = Math.min(
  Math.max(Number(process.env.AGENT_BENCHMARK_REPEATS ?? 2), 1),
  3
);
const maximumRuns = Math.min(
  Math.max(Number(process.env.AGENT_BENCHMARK_MAX_RUNS ?? 24), 1),
  40
);
const selected = new Set(
  (process.env.AGENT_BENCHMARK_CASES ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);
const cases = RELIABILITY_BENCHMARK_CASES.filter(
  (item) => !selected.size || selected.has(item.id)
);
if (!cases.length)
  throw new Error('No benchmark cases matched the requested filter.');
const planned = cases
  .flatMap((item) =>
    Array.from({ length: repeats }, (_, index) => ({
      item,
      attempt: index + 1,
    }))
  )
  .slice(0, maximumRuns);
const suffix = randomBytes(6).toString('hex');
const email = `agent-benchmark-${suffix}@example.invalid`;
const password = `Benchmark-${randomBytes(18).toString('base64url')}!`;
let cookie = '';

function cookies(response: Response) {
  const values: string[] = (response.headers as any).getSetCookie?.() ?? [
    response.headers.get('set-cookie') ?? '',
  ];
  return values
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}
async function request(route: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${route}`, init);
  return { response, body: await response.json().catch(() => null) };
}
const headers = () => ({
  'Content-Type': 'application/json',
  Cookie: cookie,
  Origin: origin,
});
const text = (value: unknown) => JSON.stringify(value ?? '').toLowerCase();
const terminalRunStatuses = new Set([
  'SUCCESS',
  'FAILED',
  'TIMED_OUT',
  'CANCELED',
]);

async function loadRun(runId: string) {
  return prisma.run.findUnique({
    where: { id: runId },
    select: {
      status: true,
      structuredStatus: true,
      structuredResult: true,
      lastFailureCode: true,
      duration: true,
      attempt: true,
      result: true,
      queuedAt: true,
      startedAt: true,
      completedAt: true,
      events: {
        orderBy: { sequence: 'asc' },
        select: { type: true, message: true },
      },
    },
  });
}

async function waitForTerminalRun(runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let run = await loadRun(runId);
  while (run && !terminalRunStatuses.has(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    run = await loadRun(runId);
  }
  return run;
}

const results: Array<Record<string, unknown>> = [];
const safetyResults: Array<Record<string, unknown>> = [];
try {
  const signup = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password, name: 'Reliability benchmark' }),
  });
  if (!signup.response.ok)
    throw new Error(
      `Benchmark signup failed safely (${signup.response.status}).`
    );
  cookie = cookies(signup.response);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      planCode: 'INTERNAL',
      planSource: 'INTERNAL',
      planAssignedAt: new Date(),
    },
  });

  for (const { item, attempt } of planned) {
    const agentResponse = await request('/api/agents', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: `Benchmark ${item.id}`,
        goal: item.goal,
        targetWebsite: item.targetWebsite,
        status: 'ACTIVE',
        configuration: {
          model: benchmarkModel.id,
          maxSteps: item.maxSteps,
          timeoutMs: item.timeoutMs,
          browserSettings: {
            headless: true,
            viewportWidth: 1280,
            viewportHeight: 720,
          },
        },
        safetyPolicy: {
          schemaVersion: 1,
          allowedDomains: [new URL(item.targetWebsite).hostname],
          blockedDomains: [],
          allowSubdomains: false,
          redirectPolicy: 'SAME_DOMAIN',
          allowDownloads: false,
          allowUploads: false,
          formSubmissionMode: 'SAFE_ONLY',
          allowDestructiveActions: false,
          maxNavigations: 12,
          maxPages: 3,
          sensitiveDomainMode: 'BLOCK',
        },
        outputSchema: item.outputSchema ?? null,
      }),
    });
    if (agentResponse.response.status !== 201)
      throw new Error(
        `Agent fixture failed for ${item.id} (${agentResponse.response.status}).`
      );
    const agentId = agentResponse.body.data.id as string;
    const admitted = await request(`/api/agents/${agentId}/run`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ variables: {} }),
    });
    if (admitted.response.status !== 202) {
      results.push({
        caseId: item.id,
        category: item.category,
        attempt,
        terminalStatus: 'NOT_ADMITTED',
        success: false,
        failureCategory: classifyBenchmarkFailure({
          status: 'FAILED',
          failureCode: admitted.body?.code,
        }),
        diagnosticCode: admitted.body?.code ?? 'ADMISSION_FAILED',
      });
      continue;
    }
    const runId = admitted.body.data.runId as string;
    const deadline = Date.now() + item.timeoutMs + 45_000;
    let run = await waitForTerminalRun(runId, deadline - Date.now());
    if (run && ['QUEUED', 'RUNNING'].includes(run.status)) {
      await request(`/api/runs/${runId}/cancel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          reason: 'Benchmark case exceeded its bounded observation window.',
        }),
      });
      run = await waitForTerminalRun(runId, 15_000);
    }
    const resultText = text({
      result: run?.result,
      structuredResult: run?.structuredResult,
    });
    const persistedResult =
      run?.result &&
      typeof run.result === 'object' &&
      !Array.isArray(run.result)
        ? run.result
        : null;
    const visitedUrls: string[] = Array.isArray(persistedResult?.visitedUrls)
      ? persistedResult.visitedUrls.filter(
          (value): value is string => typeof value === 'string'
        )
      : [];
    const tokenUsage =
      persistedResult?.tokenUsage &&
      typeof persistedResult.tokenUsage === 'object' &&
      !Array.isArray(persistedResult.tokenUsage)
        ? persistedResult.tokenUsage
        : null;
    const expectedUrlMatched = item.expectedUrlIncludes
      ? visitedUrls.some((url) => url.includes(item.expectedUrlIncludes!))
      : true;
    const expectedTextMatched = item.expectedText.every((expected) =>
      resultText.includes(expected.toLowerCase())
    );
    const structuredMatched = item.outputSchema
      ? ['VALID', 'PARTIAL'].includes(run?.structuredStatus ?? '')
      : true;
    const success =
      run?.status === 'SUCCESS' &&
      expectedUrlMatched &&
      expectedTextMatched &&
      structuredMatched;
    const completedStepMessages = (run?.events ?? [])
      .filter((event) => event.type === 'STEP_COMPLETED')
      .map((event) => event.message)
      .filter(
        (message: unknown): message is string => typeof message === 'string'
      );
    const repeatedActions =
      new Set(completedStepMessages.slice(-5)).size <= 2 &&
      completedStepMessages.length >= 5;
    results.push({
      caseId: item.id,
      category: item.category,
      goal: item.goal,
      targetDomain: new URL(item.targetWebsite).hostname,
      expected: {
        text: item.expectedText,
        urlIncludes: item.expectedUrlIncludes ?? null,
        structured: Boolean(item.outputSchema),
      },
      attempt,
      runId,
      terminalStatus: run?.status ?? 'MISSING',
      structuredStatus: run?.structuredStatus ?? null,
      steps: completedStepMessages.length,
      durationMs: run?.duration ?? null,
      queueWaitMs:
        run?.queuedAt && run?.startedAt
          ? Math.max(
              0,
              new Date(run.startedAt).getTime() -
                new Date(run.queuedAt).getTime()
            )
          : null,
      retryCount: Math.max((run?.attempt ?? 1) - 1, 0),
      tokenUsage,
      finalUrl: visitedUrls.at(-1) ?? null,
      success,
      failureCategory: success
        ? null
        : classifyBenchmarkFailure({
            status: run?.status ?? 'FAILED',
            failureCode: run?.lastFailureCode,
            structuredStatus: run?.structuredStatus,
            expectedUrlMatched,
            expectedTextMatched,
            structuredMatched,
            repeatedActions,
          }),
      diagnosticCode: success
        ? null
        : (run?.lastFailureCode ??
          (run?.status === 'SUCCESS'
            ? 'CRITERIA_NOT_MET'
            : 'EXECUTION_FAILED')),
      notes:
        run?.status === 'SUCCESS' && !success
          ? 'Run completed but deterministic benchmark criteria were not met.'
          : null,
      criteria: { expectedUrlMatched, expectedTextMatched, structuredMatched },
      configuredMaxSteps: item.maxSteps,
      configuredTimeoutMs: item.timeoutMs,
    });
  }

  for (const item of SAFETY_BENCHMARK_CASES) {
    const agent = await request('/api/agents', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: `Safety ${item.id}`,
        goal: 'Open the target and report its title.',
        targetWebsite: item.targetWebsite,
        status: 'ACTIVE',
        configuration: {
          model: benchmarkModel.id,
          maxSteps: 10,
          timeoutMs: 300_000,
          browserSettings: {
            headless: true,
            viewportWidth: 1280,
            viewportHeight: 720,
          },
        },
      }),
    });
    if (agent.response.status !== 201) {
      safetyResults.push({
        caseId: item.id,
        safe: true,
        stage: 'configuration',
        status: agent.response.status,
      });
      continue;
    }
    const admitted = await request(`/api/agents/${agent.body.data.id}/run`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ variables: {} }),
    });
    if (admitted.response.status !== 202) {
      safetyResults.push({
        caseId: item.id,
        safe: admitted.response.status >= 400,
        stage: 'admission',
        status: admitted.response.status,
        diagnosticCode: admitted.body?.code ?? null,
      });
      continue;
    }
    const run = await waitForTerminalRun(admitted.body.data.runId, 45_000);
    const safe =
      run?.status === 'FAILED' &&
      [
        'DOMAIN_NOT_ALLOWED',
        'DOMAIN_BLOCKED',
        'PRIVATE_NETWORK_BLOCKED',
        'UNSAFE_SCHEME_BLOCKED',
      ].includes(run.lastFailureCode ?? '');
    safetyResults.push({
      caseId: item.id,
      safe,
      stage: 'execution',
      status: run?.status ?? 'MISSING',
      diagnosticCode: run?.lastFailureCode ?? null,
    });
  }

  const successful = results.filter((item) => item.success).length;
  const structured = results.filter(
    (item) => item.expected && (item.expected as any).structured
  );
  const completedDurations = results
    .map((item) => item.durationMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  const durationMidpoint = Math.floor(completedDurations.length / 2);
  const medianDurationMs = !completedDurations.length
    ? null
    : completedDurations.length % 2
      ? completedDurations[durationMidpoint]
      : (completedDurations[durationMidpoint - 1] +
          completedDurations[durationMidpoint]) /
        2;
  const measuredSteps = results
    .map((item) => item.steps)
    .filter((value): value is number => typeof value === 'number');
  const averageSteps = measuredSteps.length
    ? measuredSteps.reduce((total, value) => total + value, 0) /
      measuredSteps.length
    : null;
  const failureCategories = Object.fromEntries(
    Array.from(
      new Set(
        results
          .map((item) => item.failureCategory)
          .filter((value): value is string => typeof value === 'string')
      )
    )
      .sort()
      .map((category) => [
        category,
        results.filter((item) => item.failureCategory === category).length,
      ])
  );
  const resultsByCategory = Object.fromEntries(
    Array.from(new Set(results.map((item) => item.category)))
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .map((category) => {
        const categoryResults = results.filter(
          (item) => item.category === category
        );
        const categorySuccesses = categoryResults.filter(
          (item) => item.success
        ).length;
        return [
          category,
          {
            total: categoryResults.length,
            successful: categorySuccesses,
            successRate: categorySuccesses / categoryResults.length,
          },
        ];
      })
  );
  const report = {
    benchmarkVersion: RELIABILITY_BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    environment: process.env.APP_RELEASE_ID ?? 'local',
    provider: benchmarkModel.provider,
    model: benchmarkModel.id,
    configuration: { repeats, maximumRuns, actualRuns: results.length },
    summary: {
      total: results.length,
      successful,
      failed: results.length - successful,
      successRate: results.length ? successful / results.length : 0,
      structuredTotal: structured.length,
      structuredValidOrPartial: structured.filter((item) =>
        ['VALID', 'PARTIAL'].includes(String(item.structuredStatus))
      ).length,
      medianDurationMs,
      averageSteps,
      failureCategories,
      resultsByCategory,
      safetyPassed: safetyResults.filter((item) => item.safe).length,
      safetyTotal: safetyResults.length,
    },
    results,
    safetyResults,
  };
  const output = path.resolve(
    process.env.AGENT_BENCHMARK_REPORT ??
      'benchmark-results/agent-reliability-latest.json'
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary));
} finally {
  const user = await prisma.user
    .findUnique({ where: { email }, select: { id: true } })
    .catch(() => null);
  if (user) {
    const activeRuns = await prisma.run.findMany({
      where: {
        agent: { userId: user.id },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: { id: true },
    });
    for (const run of activeRuns) {
      await request(`/api/runs/${run.id}/cancel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          reason: 'Benchmark cleanup canceled an unfinished fixture run.',
        }),
      }).catch(() => undefined);
      await waitForTerminalRun(run.id, 15_000).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}
