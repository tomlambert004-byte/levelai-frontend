-- AlterTable: Add faxNumber and verificationDaysAhead to Practice
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "faxNumber" TEXT;
ALTER TABLE "Practice" ADD COLUMN IF NOT EXISTS "verificationDaysAhead" INTEGER NOT NULL DEFAULT 7;
