const isDebug = process.env.NODE_ENV === 'development';

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|token|api.?key|session|stripe|encryption.?key|credential)/i;
const SECRET_TEXT =
  /(?:Bearer\s+[^\s"'<>]+|nvapi-[A-Za-z0-9_-]+|gsk_[A-Za-z0-9_-]+|bua_(?:live|test)_[a-f0-9]{16}\.[A-Za-z0-9_-]{20,}|whsec_[A-Za-z0-9_-]+|(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+)/gi;

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string')
    return value.replace(SECRET_TEXT, '[redacted]');
  if (value instanceof Error)
    return {
      name: value.name,
      message: redactLogValue(value.message, depth + 1),
      ...(value.stack ? { stack: redactLogValue(value.stack, depth + 1) } : {}),
    };
  if (Array.isArray(value))
    return value.slice(0, 100).map((entry) => redactLogValue(entry, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, entry]) => [
          key,
          SENSITIVE_KEY.test(key)
            ? '[redacted]'
            : redactLogValue(entry, depth + 1),
        ])
    );
  return value;
}

function safe(args: unknown[]) {
  return args.map((argument) => redactLogValue(argument));
}

export type OperationalComponent =
  | 'dashboard'
  | 'browser-worker'
  | 'scheduler'
  | 'notification-worker'
  | 'webhook-worker'
  | 'billing'
  | 'public-api'
  | 'security'
  | 'reconciliation';

function operational(
  level: 'info' | 'warn' | 'error',
  input: {
    component: OperationalComponent;
    event: string;
    [key: string]: unknown;
  }
) {
  const record = redactLogValue({
    timestamp: new Date().toISOString(),
    level,
    ...input,
  });
  console[level](JSON.stringify(record));
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDebug) {
      console.debug('[DEBUG]', ...safe(args));
    }
  },
  info: (...args: unknown[]) => {
    console.info('[INFO]', ...safe(args));
  },
  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...safe(args));
  },
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...safe(args));
  },
  operation: operational,
};
