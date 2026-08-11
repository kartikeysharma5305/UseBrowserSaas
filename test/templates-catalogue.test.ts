import { describe, expect, it } from 'vitest';

import {
  AGENT_TEMPLATES,
  getAgentTemplate,
  TEMPLATE_CATALOGUE_VERSION,
} from '@/lib/templates/catalogue';
import {
  createFromTemplateSchema,
  templateIdSchema,
} from '@/lib/templates/schemas';
import { listTemplatesForPlan } from '@/lib/templates/service';

describe('Phase 8 server template catalogue', () => {
  it('contains eight stable, unique, versioned templates', () => {
    expect(TEMPLATE_CATALOGUE_VERSION).toBe(1);
    expect(AGENT_TEMPLATES).toHaveLength(8);
    expect(new Set(AGENT_TEMPLATES.map((item) => item.id)).size).toBe(8);
    for (const template of AGENT_TEMPLATES) {
      expect(template.id).toMatch(/^[a-z0-9-]+$/);
      expect(template.version).toBeGreaterThan(0);
      expect(template.requiredPlaceholders.length).toBeGreaterThan(0);
      expect(template.expectedResult).toBeTruthy();
      expect(template.safetyNotes).toBeTruthy();
      expect(template.failureGuidance).toBeTruthy();
    }
  });

  it('includes the required safe public-web use cases', () => {
    expect(AGENT_TEMPLATES.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'webpage-summarizer',
        'product-availability-checker',
        'price-monitor',
        'competitor-page-monitor',
        'job-listing-researcher',
        'news-page-summary',
        'website-content-checker',
        'public-contact-collector',
      ])
    );
  });

  it('contains no client-selectable model or hidden execution configuration', () => {
    const keys = new Set(
      AGENT_TEMPLATES.flatMap((template) => Object.keys(template))
    );
    expect([...keys].join(',')).not.toMatch(
      /model|apiKey|browserSettings|configuration/i
    );
    const serialized = JSON.stringify(AGENT_TEMPLATES);
    expect(serialized).not.toMatch(
      /captcha bypass|purchase the item|private data source/i
    );
  });

  it('keeps recommendations within global Agent validation and clamps to plan limits', () => {
    for (const template of AGENT_TEMPLATES) {
      expect(template.recommendedMaxSteps).toBeGreaterThanOrEqual(1);
      expect(template.recommendedMaxSteps).toBeLessThanOrEqual(200);
      expect(template.recommendedTimeoutMs).toBeGreaterThanOrEqual(5_000);
      expect(template.recommendedTimeoutMs).toBeLessThanOrEqual(900_000);
    }
    const free = listTemplatesForPlan('FREE').templates.find(
      (item) => item.id === 'competitor-page-monitor'
    )!;
    const pro = listTemplatesForPlan('PRO').templates.find(
      (item) => item.id === 'competitor-page-monitor'
    )!;
    expect(free.appliedRecommendation).toEqual({
      maxSteps: 25,
      timeoutMs: 120_000,
      adjusted: true,
    });
    expect(pro.appliedRecommendation).toEqual({
      maxSteps: 40,
      timeoutMs: 180_000,
      adjusted: false,
    });
  });

  it('strictly validates IDs and user customizations', () => {
    expect(
      templateIdSchema.safeParse({ id: 'webpage-summarizer' }).success
    ).toBe(true);
    expect(templateIdSchema.safeParse({ id: '../private' }).success).toBe(
      false
    );
    expect(
      createFromTemplateSchema.safeParse({
        name: 'Summary',
        goal: 'Summarize and stop.',
        targetWebsite: 'https://example.com',
        createAndTest: true,
        model: 'unsupported-client-choice',
        userId: 'other',
      }).success
    ).toBe(false);
    expect(getAgentTemplate('unknown-template')).toBeNull();
  });
});
