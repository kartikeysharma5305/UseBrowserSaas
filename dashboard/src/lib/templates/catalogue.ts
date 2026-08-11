export type TemplateCategory =
  | 'CONTENT'
  | 'MONITORING'
  | 'RESEARCH'
  | 'CONTACTS';
import type { OutputSchemaDefinition } from '@/lib/structured-results';

export interface AgentTemplate {
  id: string;
  version: number;
  title: string;
  description: string;
  category: TemplateCategory;
  suggestedName: string;
  suggestedGoal: string;
  targetWebsiteGuidance: string;
  recommendedTimeoutMs: number;
  recommendedMaxSteps: number;
  expectedResult: string;
  safetyNotes: string;
  successExample: string;
  failureGuidance: string;
  requiredPlaceholders: string[];
  variables?: AgentVariableDefinitionInput[];
  outputSchema?: OutputSchemaDefinition;
}

export const TEMPLATE_CATALOGUE_VERSION = 1;

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'webpage-summarizer',
    version: 1,
    title: 'Webpage summarizer',
    category: 'CONTENT',
    description: 'Read one public page and return a concise factual summary.',
    suggestedName: 'Webpage Summary',
    suggestedGoal:
      'Read {{website}}, summarize its main points in five bullets, include the page title, and stop after producing the summary.',
    variables: [
      {
        key: 'website',
        label: 'Website',
        type: 'URL',
        required: true,
        constraints: {},
        displayOrder: 0,
      },
    ],
    outputSchema: {
      enabled: true,
      version: 1,
      mode: 'PARTIAL',
      fields: [
        { key: 'title', label: 'Title', type: 'string', required: true },
        { key: 'summary', label: 'Summary', type: 'string', required: true },
        {
          key: 'keyPoints',
          label: 'Key points',
          type: 'array',
          required: true,
          item: { type: 'string' },
        },
      ],
    },
    targetWebsiteGuidance:
      'Paste one public article or documentation page URL.',
    recommendedTimeoutMs: 90_000,
    recommendedMaxSteps: 15,
    expectedResult: 'A page title and five concise factual bullets.',
    safetyNotes:
      'Use public pages only. Do not include credentials, private documents, or paywalled content.',
    successExample:
      'Returns the title and five bullets, then stops without following unrelated links.',
    failureGuidance:
      'If the page is blocked or empty, use a directly accessible article URL and narrow the request.',
    requiredPlaceholders: ['target website'],
  },
  {
    id: 'product-availability-checker',
    version: 1,
    title: 'Product availability checker',
    category: 'MONITORING',
    description:
      'Check whether a named product is visibly in stock on a public product page.',
    suggestedName: 'Availability Check',
    suggestedGoal:
      'Inspect {{website}} for {{product_name}}, report whether it is shown as in stock, out of stock, or unclear, quote only the visible availability label, and stop. Do not add to cart or purchase.',
    variables: [
      {
        key: 'website',
        label: 'Website',
        type: 'URL',
        required: true,
        constraints: {},
        displayOrder: 0,
      },
      {
        key: 'product_name',
        label: 'Product name',
        type: 'TEXT',
        required: false,
        defaultValue: 'the selected product',
        constraints: { maxLength: 160 },
        displayOrder: 1,
      },
    ],
    outputSchema: {
      enabled: true,
      version: 1,
      mode: 'PARTIAL',
      fields: [
        {
          key: 'productName',
          label: 'Product name',
          type: 'string',
          required: true,
        },
        {
          key: 'available',
          label: 'Available',
          type: 'boolean',
          required: false,
        },
        {
          key: 'availabilityLabel',
          label: 'Availability label',
          type: 'string',
          required: false,
        },
      ],
    },
    targetWebsiteGuidance: 'Use the exact public product-detail URL.',
    recommendedTimeoutMs: 90_000,
    recommendedMaxSteps: 15,
    expectedResult:
      'One availability classification with the visible supporting label.',
    safetyNotes:
      'Never purchase, reserve, sign in, bypass a CAPTCHA, or submit personal information.',
    successExample:
      'Reports “in stock” and the visible label without taking transactional action.',
    failureGuidance:
      'If availability is location-dependent, specify a public location-free page or report unclear.',
    requiredPlaceholders: ['product page'],
  },
  {
    id: 'price-monitor',
    version: 1,
    title: 'Price monitor',
    category: 'MONITORING',
    description:
      'Capture the currently displayed public price for one product.',
    suggestedName: 'Public Price Check',
    suggestedGoal:
      'Read the target product page, report the displayed item name, current price, currency, and whether a previous price is visibly shown, then stop. Do not purchase or add anything to a cart.',
    targetWebsiteGuidance:
      'Use an exact public product page with a visible price.',
    recommendedTimeoutMs: 90_000,
    recommendedMaxSteps: 15,
    expectedResult:
      'Product name, displayed price, currency, and visible comparison price if present.',
    safetyNotes:
      'Public display prices only; do not perform financial transactions or sign in.',
    successExample: 'Returns one clearly labeled price observation and stops.',
    failureGuidance:
      'If price requires login or location, report that it cannot be verified instead of bypassing controls.',
    requiredPlaceholders: ['product page'],
  },
  {
    id: 'competitor-page-monitor',
    version: 1,
    title: 'Competitor page monitor',
    category: 'MONITORING',
    description:
      'Summarize visible changes or claims on one public competitor page.',
    suggestedName: 'Competitor Page Review',
    suggestedGoal:
      'Review the target public page, list its current headline, primary product claims, and dated announcements visible on the page, then stop. Report facts without guessing intent.',
    targetWebsiteGuidance:
      'Choose one public landing, pricing, or release-notes page.',
    recommendedTimeoutMs: 180_000,
    recommendedMaxSteps: 40,
    expectedResult: 'A bounded factual snapshot suitable for later comparison.',
    safetyNotes: 'Do not sign in, access private data, or evade site controls.',
    successExample:
      'Produces a dated snapshot of visible claims with no speculative conclusions.',
    failureGuidance:
      'Use a narrower single page when navigation becomes ambiguous.',
    requiredPlaceholders: ['competitor page'],
  },
  {
    id: 'job-listing-researcher',
    version: 1,
    title: 'Job listing researcher',
    category: 'RESEARCH',
    description: 'Extract key facts from one public job listing.',
    suggestedName: 'Job Listing Research',
    suggestedGoal:
      'Read the public listing at {{website}} for {{job_title}} in {{city}} and return the role title, company, location, employment type, stated experience, and application deadline if visible, then stop. Do not apply or submit personal data.',
    variables: [
      {
        key: 'website',
        label: 'Website',
        type: 'URL',
        required: true,
        constraints: {},
        displayOrder: 0,
      },
      {
        key: 'job_title',
        label: 'Job title',
        type: 'TEXT',
        required: false,
        defaultValue: 'software engineer',
        constraints: { maxLength: 120 },
        displayOrder: 1,
      },
      {
        key: 'city',
        label: 'City',
        type: 'TEXT',
        required: false,
        defaultValue: 'Gurugram',
        constraints: { maxLength: 100 },
        displayOrder: 2,
      },
    ],
    outputSchema: {
      enabled: true,
      version: 1,
      mode: 'PARTIAL',
      fields: [
        { key: 'title', label: 'Title', type: 'string', required: true },
        { key: 'company', label: 'Company', type: 'string', required: true },
        { key: 'location', label: 'Location', type: 'string', required: false },
        { key: 'url', label: 'URL', type: 'url', required: true },
      ],
    },
    targetWebsiteGuidance:
      'Paste a directly accessible public job-listing URL.',
    recommendedTimeoutMs: 120_000,
    recommendedMaxSteps: 20,
    expectedResult:
      'A structured summary of facts explicitly stated in the listing.',
    safetyNotes:
      'Research only. Never apply, log in, or submit a résumé or personal data.',
    successExample:
      'Returns the requested fields and marks unstated items as not provided.',
    failureGuidance:
      'Use a direct listing URL rather than a search-results page.',
    requiredPlaceholders: ['job listing'],
  },
  {
    id: 'news-page-summary',
    version: 1,
    title: 'News page summary',
    category: 'CONTENT',
    description: 'Summarize one public news article with explicit attribution.',
    suggestedName: 'News Article Summary',
    suggestedGoal:
      'Read {{website}} for the topic {{search_query}}, return its headline, publisher, publication date if visible, and a neutral four-bullet summary. Clearly distinguish quoted claims from verified facts, then stop.',
    variables: [
      {
        key: 'website',
        label: 'Website',
        type: 'URL',
        required: true,
        constraints: {},
        displayOrder: 0,
      },
      {
        key: 'search_query',
        label: 'Search query',
        type: 'TEXT',
        required: false,
        defaultValue: 'the article topic',
        constraints: { maxLength: 200 },
        displayOrder: 1,
      },
    ],
    targetWebsiteGuidance: 'Use one public, directly accessible news article.',
    recommendedTimeoutMs: 90_000,
    recommendedMaxSteps: 15,
    expectedResult:
      'Attributed headline metadata and a neutral four-bullet summary.',
    safetyNotes:
      'Do not bypass subscriptions or authentication. Treat article claims as attributed claims.',
    successExample:
      'Attributes the source and avoids presenting unsupported claims as independent facts.',
    failureGuidance:
      'If blocked by a paywall, choose an accessible source instead of bypassing it.',
    requiredPlaceholders: ['news article'],
  },
  {
    id: 'website-content-checker',
    version: 1,
    title: 'Website content checker',
    category: 'CONTENT',
    description: 'Verify whether specific public text is present on a page.',
    suggestedName: 'Content Presence Check',
    suggestedGoal:
      'Inspect the target page for the specific phrase described in this task, report present, absent, or unclear, include the nearest visible heading when found, and stop after checking that page.',
    targetWebsiteGuidance:
      'Use the exact public page and replace “specific phrase” with the text to check.',
    recommendedTimeoutMs: 60_000,
    recommendedMaxSteps: 10,
    expectedResult:
      'A present/absent/unclear result with limited visible context.',
    safetyNotes:
      'Check public content only and avoid collecting unrelated page data.',
    successExample:
      'Reports the phrase status and one nearby heading, then stops.',
    failureGuidance:
      'Name the exact phrase and page; vague whole-site searches are likely to fail.',
    requiredPlaceholders: ['specific phrase', 'target page'],
  },
  {
    id: 'public-contact-collector',
    version: 1,
    title: 'Public contact-information collector',
    category: 'CONTACTS',
    description:
      'Collect organization contact details intentionally published on one public page.',
    suggestedName: 'Public Contact Details',
    suggestedGoal:
      'Read the organization’s public contact page and return only the organization name, general business email, public phone number, and office address explicitly published there, then stop. Do not collect personal profiles or private data.',
    targetWebsiteGuidance:
      'Use an organization’s official public contact page.',
    recommendedTimeoutMs: 90_000,
    recommendedMaxSteps: 15,
    expectedResult:
      'Only explicitly published organization-level contact fields.',
    safetyNotes:
      'Do not collect personal contacts, infer missing information, sign in, or access private sources.',
    successExample:
      'Returns a general contact inbox and office address from the official page.',
    failureGuidance:
      'If no general contact details are published, report not found without searching private sources.',
    requiredPlaceholders: ['organization contact page'],
  },
] as const;

export function getAgentTemplate(id: string) {
  return AGENT_TEMPLATES.find((template) => template.id === id) ?? null;
}
import type { AgentVariableDefinitionInput } from '@/lib/variables/schemas';
