import type { LegalDocumentType, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { LEGAL_DOCUMENT_VERSIONS, REQUIRED_LEGAL_DOCUMENTS } from './config';

type Database = Pick<PrismaClient, 'legalDocumentAcceptance'>;

export async function recordCurrentLegalAcceptance(
  userId: string,
  documents: readonly LegalDocumentType[] = REQUIRED_LEGAL_DOCUMENTS,
  database: Database = prisma
) {
  const unique = [...new Set(documents)].filter((document) =>
    REQUIRED_LEGAL_DOCUMENTS.includes(document)
  );
  await database.legalDocumentAcceptance.createMany({
    data: unique.map((documentType) => ({
      userId,
      documentType,
      documentVersion: LEGAL_DOCUMENT_VERSIONS[documentType],
    })),
    skipDuplicates: true,
  });
  return legalAcceptanceStatus(userId, database);
}

export async function legalAcceptanceStatus(
  userId: string,
  database: Database = prisma
) {
  const accepted = await database.legalDocumentAcceptance.findMany({
    where: { userId },
    select: { documentType: true, documentVersion: true, acceptedAt: true },
    orderBy: { acceptedAt: 'asc' },
  });
  const current = Object.fromEntries(
    REQUIRED_LEGAL_DOCUMENTS.map((documentType) => [
      documentType,
      accepted.some(
        (item) =>
          item.documentType === documentType &&
          item.documentVersion === LEGAL_DOCUMENT_VERSIONS[documentType]
      ),
    ])
  ) as Record<LegalDocumentType, boolean>;
  return {
    versions: LEGAL_DOCUMENT_VERSIONS,
    current,
    requiresAcceptance: Object.values(current).some((value) => !value),
    accepted: accepted.map((item) => ({
      documentType: item.documentType,
      documentVersion: item.documentVersion,
      acceptedAt: item.acceptedAt.toISOString(),
    })),
  };
}
