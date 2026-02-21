-- AlterTable — add customer tracking fields to activation codes
ALTER TABLE "ActivationCode" ADD COLUMN "label" TEXT;
ALTER TABLE "ActivationCode" ADD COLUMN "customerEmail" TEXT;
