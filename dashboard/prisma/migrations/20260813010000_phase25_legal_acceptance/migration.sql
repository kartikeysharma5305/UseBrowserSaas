CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY', 'ACCEPTABLE_USE');

CREATE TABLE "LegalDocumentAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalDocumentAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalDocumentAcceptance_userId_documentType_documentVersion_key"
ON "LegalDocumentAcceptance"("userId", "documentType", "documentVersion");

CREATE INDEX "LegalDocumentAcceptance_userId_acceptedAt_idx"
ON "LegalDocumentAcceptance"("userId", "acceptedAt");

CREATE INDEX "LegalDocumentAcceptance_documentType_documentVersion_idx"
ON "LegalDocumentAcceptance"("documentType", "documentVersion");

ALTER TABLE "LegalDocumentAcceptance"
ADD CONSTRAINT "LegalDocumentAcceptance_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
