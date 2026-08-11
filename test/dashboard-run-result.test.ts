import { describe, expect, it } from 'vitest';

import {
  formatRunResult,
  formatRunResultDetails,
  getRunResultSearchText,
  getRunSummary,
  getVisitedUrls,
  isBrowserRunResult,
  isHttpUrl,
  isJsonObject,
} from '../dashboard/src/lib/utils/format-run-result.js';
import type { JsonValue } from '../dashboard/src/lib/types.js';

describe('dashboard run result utilities', () => {
  it('formats null and undefined as empty results', () => {
    expect(formatRunResult(null)).toBe('—');
    expect(formatRunResult(undefined)).toBe('—');
    expect(getRunResultSearchText(null)).toBe('');
    expect(getRunResultSearchText(undefined)).toBe('');
  });

  it('formats string values and trims empty strings', () => {
    expect(formatRunResult('  completed  ')).toBe('completed');
    expect(formatRunResult('   ')).toBe('—');
    expect(formatRunResultDetails('  full result  ')).toBe('full result');
  });

  it('formats number and boolean primitives', () => {
    expect(formatRunResult(42)).toBe('42');
    expect(formatRunResult(true)).toBe('true');
    expect(formatRunResult(false)).toBe('false');
  });

  it('formats empty and mixed arrays as JSON', () => {
    expect(formatRunResult([])).toBe('[]');
    expect(formatRunResult(['value', 2, true, null])).toBe(
      '["value",2,true,null]'
    );
  });

  it('extracts the expected summary and visited URLs', () => {
    const result = {
      summary: '  Finished successfully  ',
      visitedUrls: ['https://example.com', ' https://example.com/docs '],
    };

    expect(isBrowserRunResult(result)).toBe(true);
    expect(getRunSummary(result)).toBe('Finished successfully');
    expect(getVisitedUrls(result)).toEqual([
      'https://example.com',
      'https://example.com/docs',
    ]);
    expect(formatRunResult(result)).toBe('Finished successfully');
  });

  it('supports an expected result with only a summary', () => {
    const result = { summary: 'Summary only' };

    expect(isBrowserRunResult(result)).toBe(true);
    expect(formatRunResult(result)).toBe('Summary only');
    expect(getVisitedUrls(result)).toEqual([]);
  });

  it('uses visited URLs when an expected result has no summary', () => {
    const result = {
      visitedUrls: ['https://example.com', 'https://example.com/next'],
    };

    expect(isBrowserRunResult(result)).toBe(true);
    expect(formatRunResult(result)).toBe(
      'https://example.com → https://example.com/next'
    );
  });

  it('rejects malformed visitedUrls while safely extracting string entries', () => {
    const result = {
      summary: null,
      visitedUrls: ['https://example.com', 17, false],
    };

    expect(isBrowserRunResult(result)).toBe(false);
    expect(getVisitedUrls(result)).toEqual(['https://example.com']);
    expect(formatRunResult(result)).toContain('"visitedUrls"');
  });

  it('formats unexpected objects without object coercion', () => {
    const result = { count: 3, complete: true };

    expect(formatRunResult(result)).toBe('{"count":3,"complete":true}');
    expect(formatRunResult(result)).not.toContain('[object Object]');
  });

  it('formats deeply nested reasonable JSON for detail display', () => {
    const result = {
      level1: {
        level2: {
          values: [1, 2, { complete: true }],
        },
      },
    };

    expect(formatRunResultDetails(result)).toContain('"level2"');
    expect(formatRunResultDetails(result)).toContain('"complete": true');
  });

  it('truncates large values for compact list display', () => {
    const formatted = formatRunResult('x'.repeat(500));

    expect(formatted).toHaveLength(180);
    expect(formatted.endsWith('…')).toBe(true);
  });

  it('builds searchable text from expected and generic JSON values', () => {
    const expected = {
      summary: 'Checkout complete',
      visitedUrls: ['https://example.com/cart'],
    };

    expect(getRunResultSearchText(expected)).toBe(
      'Checkout complete https://example.com/cart'
    );
    expect(getRunResultSearchText({ code: 200 })).toContain('"code":200');
    expect(getRunResultSearchText(false)).toBe('false');
  });

  it('identifies plain objects and safe external URLs', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://localhost:3001/path')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('does not throw for any supported JSON shape', () => {
    const values: Array<JsonValue | undefined> = [
      null,
      undefined,
      '',
      'text',
      0,
      true,
      [],
      ['text', 1, false, null],
      { summary: 'Done', visitedUrls: ['https://example.com'] },
      { nested: { values: [1, 2, 3] } },
    ];

    for (const value of values) {
      expect(() => formatRunResult(value)).not.toThrow();
      expect(() => formatRunResultDetails(value)).not.toThrow();
      expect(() => getRunResultSearchText(value)).not.toThrow();
    }
  });
});
