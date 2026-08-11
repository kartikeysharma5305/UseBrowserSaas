export type BenchmarkCategory =
  | 'DIRECT_EXTRACTION'
  | 'SEARCH_NAVIGATION'
  | 'MULTI_PAGE'
  | 'FORM_INTERACTION'
  | 'STRUCTURED_RESULT';

export interface ReliabilityBenchmarkCase {
  id: string;
  category: BenchmarkCategory;
  goal: string;
  targetWebsite: string;
  expectedText: string[];
  expectedUrlIncludes?: string;
  maxSteps: number;
  timeoutMs: number;
  outputSchema?: Record<string, unknown>;
}

const objectSchema = (
  fields: Array<Record<string, unknown>>,
  mode: 'STRICT' | 'PARTIAL' = 'STRICT'
) => ({ enabled: true, version: 1, mode, fields });

export const RELIABILITY_BENCHMARK_VERSION = 1;

export const RELIABILITY_BENCHMARK_CASES: readonly ReliabilityBenchmarkCase[] =
  [
    {
      id: 'direct-example-title',
      category: 'DIRECT_EXTRACTION',
      targetWebsite: 'https://example.com/',
      maxSteps: 10,
      timeoutMs: 300_000,
      goal: 'Open the public page, report its exact page title and the destination of the More information link, then finish.',
      expectedText: ['Example Domain', 'iana.org'],
      expectedUrlIncludes: 'example.com',
    },
    {
      id: 'direct-wikipedia-ai',
      category: 'DIRECT_EXTRACTION',
      targetWebsite: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      maxSteps: 14,
      timeoutMs: 420_000,
      goal: 'Report the exact article title, a two-sentence introduction summary, and the first three visible section headings, then finish.',
      expectedText: ['Artificial intelligence'],
      expectedUrlIncludes: '/wiki/Artificial_intelligence',
    },
    {
      id: 'direct-wikipedia-typescript',
      category: 'DIRECT_EXTRACTION',
      targetWebsite: 'https://en.wikipedia.org/wiki/TypeScript',
      maxSteps: 14,
      timeoutMs: 420_000,
      goal: 'Report the exact article title, who developed it, and the year it first appeared, then finish.',
      expectedText: ['TypeScript', 'Microsoft', '2012'],
      expectedUrlIncludes: '/wiki/TypeScript',
    },
    {
      id: 'search-wikipedia-ai',
      category: 'SEARCH_NAVIGATION',
      targetWebsite: 'https://en.wikipedia.org/wiki/Main_Page',
      maxSteps: 16,
      timeoutMs: 480_000,
      goal: 'Use the visible search interface to search for the exact named entity "Artificial intelligence". Open the exact-title article, report its title and final URL, then finish. Prefer an exact title match over associated people or topics.',
      expectedText: ['Artificial intelligence'],
      expectedUrlIncludes: '/wiki/Artificial_intelligence',
    },
    {
      id: 'search-wikipedia-turing',
      category: 'SEARCH_NAVIGATION',
      targetWebsite: 'https://en.wikipedia.org/wiki/Main_Page',
      maxSteps: 16,
      timeoutMs: 480_000,
      goal: 'Use the visible search interface to search for the exact named entity "Alan Turing". Open the exact-title article, report its title and final URL, then finish.',
      expectedText: ['Alan Turing'],
      expectedUrlIncludes: '/wiki/Alan_Turing',
    },
    {
      id: 'navigate-wikipedia-machine-learning',
      category: 'SEARCH_NAVIGATION',
      targetWebsite: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      maxSteps: 14,
      timeoutMs: 420_000,
      goal: 'Follow a visible article link to the exact "Machine learning" article. Report the destination title and final URL, then finish.',
      expectedText: ['Machine learning'],
      expectedUrlIncludes: '/wiki/Machine_learning',
    },
    {
      id: 'compare-wikipedia-ai-ml',
      category: 'MULTI_PAGE',
      targetWebsite: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      maxSteps: 18,
      timeoutMs: 540_000,
      goal: 'Using only English Wikipedia, visit the Artificial intelligence and Machine learning articles. Report both exact titles and one concise factual distinction supported by their introductions, then finish.',
      expectedText: ['Artificial intelligence', 'Machine learning'],
      expectedUrlIncludes: '/wiki/Machine_learning',
    },
    {
      id: 'collect-wikipedia-links',
      category: 'MULTI_PAGE',
      targetWebsite: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      maxSteps: 16,
      timeoutMs: 480_000,
      goal: 'Collect the exact titles and URLs of three directly linked Wikipedia articles about AI subfields. Return exactly three items, then finish.',
      expectedText: ['http', 'wiki'],
      expectedUrlIncludes: '/wiki/Artificial_intelligence',
    },
    {
      id: 'form-wikipedia-typescript',
      category: 'FORM_INTERACTION',
      targetWebsite: 'https://en.wikipedia.org/wiki/Main_Page',
      maxSteps: 16,
      timeoutMs: 480_000,
      goal: 'Use the Wikipedia search form to search for "TypeScript", open the exact-title result, report the page title, then finish.',
      expectedText: ['TypeScript'],
      expectedUrlIncludes: '/wiki/TypeScript',
    },
    {
      id: 'structured-example',
      category: 'STRUCTURED_RESULT',
      targetWebsite: 'https://example.com/',
      maxSteps: 10,
      timeoutMs: 300_000,
      goal: 'Extract the exact page title, its visible explanatory sentence, and the current page URL, then finish.',
      expectedText: ['Example Domain'],
      expectedUrlIncludes: 'example.com',
      outputSchema: objectSchema([
        { key: 'title', label: 'Title', type: 'string', required: true },
        { key: 'summary', label: 'Summary', type: 'string', required: true },
        { key: 'url', label: 'URL', type: 'url', required: true },
      ]),
    },
    {
      id: 'structured-wikipedia-headings',
      category: 'STRUCTURED_RESULT',
      targetWebsite: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      maxSteps: 14,
      timeoutMs: 420_000,
      goal: 'Extract the exact article title, final URL, and first three visible section headings, then finish.',
      expectedText: ['Artificial intelligence'],
      expectedUrlIncludes: '/wiki/Artificial_intelligence',
      outputSchema: objectSchema([
        { key: 'title', label: 'Title', type: 'string', required: true },
        { key: 'url', label: 'URL', type: 'url', required: true },
        {
          key: 'headings',
          label: 'Headings',
          type: 'array',
          required: true,
          item: { type: 'string' },
        },
      ]),
    },
    {
      id: 'structured-wikipedia-nested',
      category: 'STRUCTURED_RESULT',
      targetWebsite: 'https://en.wikipedia.org/wiki/TypeScript',
      maxSteps: 14,
      timeoutMs: 420_000,
      goal: 'Extract the exact title and a facts object containing developer and firstReleaseYear. Set confidence to HIGH only when both facts are visible, otherwise LOW, then finish.',
      expectedText: ['TypeScript'],
      expectedUrlIncludes: '/wiki/TypeScript',
      outputSchema: objectSchema([
        { key: 'title', label: 'Title', type: 'string', required: true },
        {
          key: 'facts',
          label: 'Facts',
          type: 'object',
          required: true,
          fields: [
            {
              key: 'developer',
              label: 'Developer',
              type: 'string',
              required: true,
            },
            {
              key: 'firstReleaseYear',
              label: 'First release year',
              type: 'integer',
              required: true,
            },
          ],
        },
        {
          key: 'confidence',
          label: 'Confidence',
          type: 'enum',
          required: true,
          enumValues: ['HIGH', 'LOW'],
        },
      ]),
    },
  ];

export const SAFETY_BENCHMARK_CASES = [
  { id: 'private-loopback', targetWebsite: 'http://127.0.0.1/' },
  {
    id: 'private-metadata',
    targetWebsite: 'http://169.254.169.254/latest/meta-data/',
  },
] as const;
