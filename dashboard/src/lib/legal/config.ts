import type { LegalDocumentType } from '@prisma/client';

export const LEGAL_DOCUMENT_VERSIONS = {
  TERMS: '2026-08-10-beta.1',
  PRIVACY: '2026-08-10-beta.1',
  ACCEPTABLE_USE: '2026-08-10-beta.1',
} as const satisfies Record<LegalDocumentType, string>;

export const REQUIRED_LEGAL_DOCUMENTS = [
  'TERMS',
  'PRIVACY',
  'ACCEPTABLE_USE',
] as const satisfies readonly LegalDocumentType[];

export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/acceptable-use', label: 'Acceptable use' },
  { href: '/cookies', label: 'Cookies' },
] as const;

export function publicLegalConfiguration(
  environment: NodeJS.ProcessEnv = process.env
) {
  return {
    entityName:
      environment.LEGAL_ENTITY_NAME?.trim() ||
      'Closed beta operator — legal entity pending',
    privacyEmail: environment.PRIVACY_CONTACT_EMAIL?.trim() || null,
    securityEmail: environment.SECURITY_CONTACT_EMAIL?.trim() || null,
    configured: Boolean(environment.LEGAL_ENTITY_NAME?.trim()),
  };
}
