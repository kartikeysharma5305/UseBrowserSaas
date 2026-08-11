export type MetricLabels = Readonly<Record<string, string>>;

const DEFINITIONS = {
  run_admission_rejections_total: ['reason'],
  security_rejections_total: ['control'],
  public_api_requests_total: ['outcome', 'operation'],
  reconciliation_repairs_total: ['subsystem'],
  billing_webhook_requests_total: ['outcome'],
  provider_run_outcomes_total: ['provider', 'provider_outcome'],
  public_api_idempotent_replays_total: [],
} as const;

export type CounterName = keyof typeof DEFINITIONS;

const ALLOWED_VALUES: Record<string, ReadonlySet<string>> = {
  reason: new Set([
    'active_limit',
    'quota',
    'cost',
    'queue_overload',
    'execution_disabled',
    'account_disabled',
    'other',
  ]),
  control: new Set([
    'auth_rate_limit',
    'api_pre_auth_rate_limit',
    'api_rate_limit',
    'run_burst_limit',
    'queue_overload',
    'oversized_body',
    'origin',
    'execution_disabled',
  ]),
  outcome: new Set([
    'allowed',
    'unauthorized',
    'forbidden',
    'rate_limited',
    'unavailable',
    'received',
    'verified',
    'rejected',
    'processed',
    'failed',
    'duplicate',
  ]),
  provider: new Set(['groq', 'nvidia']),
  provider_outcome: new Set([
    'success',
    'rate_limited',
    'auth_failed',
    'timeout',
    'unavailable',
    'bad_response',
    'model_unavailable',
    'failed',
  ]),
  operation: new Set(['general', 'run_create', 'cancel', 'retrieval']),
  subsystem: new Set([
    'run_queue',
    'scheduler',
    'notifications',
    'webhooks',
    'billing',
  ]),
};

interface CounterSample {
  name: CounterName;
  labels: Record<string, string>;
  value: number;
}

const state = globalThis as typeof globalThis & {
  operationsCounters?: Map<string, CounterSample>;
};

function counters() {
  state.operationsCounters ??= new Map();
  return state.operationsCounters;
}

function normalizedLabels(name: CounterName, labels: MetricLabels) {
  const expected = DEFINITIONS[name];
  const output: Record<string, string> = {};
  for (const label of expected) {
    const value = labels[label];
    if (!value || !ALLOWED_VALUES[label]?.has(value)) {
      throw new Error(`Invalid bounded metric label for ${name}.${label}.`);
    }
    output[label] = value;
  }
  if (Object.keys(labels).length !== expected.length) {
    throw new Error(`Unexpected metric labels for ${name}.`);
  }
  return output;
}

function key(name: CounterName, labels: Record<string, string>) {
  return `${name}|${Object.entries(labels)
    .map(([label, value]) => `${label}=${value}`)
    .join('|')}`;
}

export function incrementCounter(
  name: CounterName,
  labels: MetricLabels,
  amount = 1
) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const safeLabels = normalizedLabels(name, labels);
  const sampleKey = key(name, safeLabels);
  const existing = counters().get(sampleKey);
  counters().set(sampleKey, {
    name,
    labels: safeLabels,
    value: (existing?.value ?? 0) + amount,
  });
}

export function getCounterSamples(): CounterSample[] {
  return [...counters().values()].map((sample) => ({
    ...sample,
    labels: { ...sample.labels },
  }));
}

export function resetOperationsMetricsForTests() {
  counters().clear();
}

export interface PrometheusSample {
  name: string;
  value: number;
  labels?: Record<string, string>;
  help?: string;
  type?: 'counter' | 'gauge';
}

function escapeLabel(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"');
}

export function renderPrometheus(samples: PrometheusSample[]) {
  const bounded = samples.slice(0, 500);
  const metadata = new Set<string>();
  const lines: string[] = [];
  for (const sample of bounded) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(sample.name)) continue;
    if (!Number.isFinite(sample.value)) continue;
    if (!metadata.has(sample.name)) {
      if (sample.help)
        lines.push(
          `# HELP ${sample.name} ${sample.help.replace(/[\r\n]/g, ' ')}`
        );
      lines.push(`# TYPE ${sample.name} ${sample.type ?? 'gauge'}`);
      metadata.add(sample.name);
    }
    const labelEntries = Object.entries(sample.labels ?? {}).slice(0, 8);
    const labels = labelEntries.length
      ? `{${labelEntries
          .map(([label, value]) => `${label}="${escapeLabel(value)}"`)
          .join(',')}}`
      : '';
    lines.push(`${sample.name}${labels} ${sample.value}`);
  }
  return `${lines.join('\n')}\n`;
}

export function counterPrometheusSamples(): PrometheusSample[] {
  return getCounterSamples().map((sample) => ({
    name: sample.name,
    labels: sample.labels,
    value: sample.value,
    type: 'counter',
    help: 'Process-lifetime bounded operational counter.',
  }));
}
