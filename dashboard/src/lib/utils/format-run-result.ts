import type { BrowserRunResult, JsonValue } from '@/lib/types';

const EMPTY_RESULT = '—';
const TABLE_RESULT_LIMIT = 180;
const DETAIL_RESULT_LIMIT = 20_000;
const SEARCH_RESULT_LIMIT = 50_000;

export function isJsonObject(
  value: unknown
): value is { [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isBrowserRunResult(value: unknown): value is BrowserRunResult {
  if (!isJsonObject(value)) {
    return false;
  }

  const hasSummary = Object.prototype.hasOwnProperty.call(value, 'summary');
  const hasVisitedUrls = Object.prototype.hasOwnProperty.call(
    value,
    'visitedUrls'
  );

  if (!hasSummary && !hasVisitedUrls) {
    return false;
  }

  const summaryIsValid =
    !hasSummary || value.summary === null || typeof value.summary === 'string';
  const visitedUrlsAreValid =
    !hasVisitedUrls ||
    (Array.isArray(value.visitedUrls) &&
      value.visitedUrls.every((url) => typeof url === 'string'));

  return summaryIsValid && visitedUrlsAreValid;
}

export function getRunSummary(value: JsonValue | undefined): string | null {
  if (!isJsonObject(value) || typeof value.summary !== 'string') {
    return null;
  }

  const summary = value.summary.trim();
  return summary.length > 0 ? summary : null;
}

export function getVisitedUrls(value: JsonValue | undefined): string[] {
  if (!isJsonObject(value) || !Array.isArray(value.visitedUrls)) {
    return [];
  }

  return value.visitedUrls
    .filter((url): url is string => typeof url === 'string')
    .map((url) => url.trim())
    .filter(Boolean);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}…`;
}

function serializeJson(value: JsonValue, pretty: boolean): string {
  try {
    return JSON.stringify(value, null, pretty ? 2 : undefined) ?? EMPTY_RESULT;
  } catch {
    return 'Unable to display result.';
  }
}

export function formatRunResult(
  result: JsonValue | undefined,
  limit = TABLE_RESULT_LIMIT
): string {
  if (result === null || result === undefined) {
    return EMPTY_RESULT;
  }

  if (typeof result === 'string') {
    const value = result.trim();
    return value ? truncate(value, limit) : EMPTY_RESULT;
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }

  if (isBrowserRunResult(result)) {
    const summary = getRunSummary(result);
    if (summary) {
      return truncate(summary, limit);
    }

    const visitedUrls = getVisitedUrls(result);
    if (visitedUrls.length > 0) {
      return truncate(visitedUrls.join(' → '), limit);
    }

    return EMPTY_RESULT;
  }

  return truncate(serializeJson(result, false), limit);
}

export function formatRunResultDetails(result: JsonValue | undefined): string {
  if (result === null || result === undefined) {
    return EMPTY_RESULT;
  }

  if (typeof result === 'string') {
    return result.trim() || EMPTY_RESULT;
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }

  return truncate(serializeJson(result, true), DETAIL_RESULT_LIMIT);
}

export function getRunResultSearchText(result: JsonValue | undefined): string {
  if (result === null || result === undefined) {
    return '';
  }

  if (
    typeof result === 'string' ||
    typeof result === 'number' ||
    typeof result === 'boolean'
  ) {
    return String(result);
  }

  if (isBrowserRunResult(result)) {
    return truncate(
      [getRunSummary(result), ...getVisitedUrls(result)]
        .filter((value): value is string => Boolean(value))
        .join(' '),
      SEARCH_RESULT_LIMIT
    );
  }

  return truncate(serializeJson(result, false), SEARCH_RESULT_LIMIT);
}
