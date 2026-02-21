-- DropForeignKey: VerificationResult → Patient
ALTER TABLE "VerificationResult" DROP CONSTRAINT IF EXISTS "VerificationResult_patientId_fkey";

-- DropForeignKey: VerificationResult → Practice
ALTER TABLE "VerificationResult" DROP CONSTRAINT IF EXISTS "VerificationResult_practiceId_fkey";

-- DropForeignKey: Patient → Practice
ALTER TABLE "Patient" DROP CONSTRAINT IF EXISTS "Patient_practiceId_fkey";

-- DropTable: VerificationResult (depends on Patient, so drop first)
DROP TABLE IF EXISTS "VerificationResult";

-- DropTable: Patient
DROP TABLE IF EXISTS "Patient";

-- HIPAA COMPLIANCE NOTE:
-- These tables stored PHI (patient names, DOBs, member IDs, insurance details)
-- and are no longer used. Patient data is now stored exclusively in encrypted
-- Redis cache (AES-256-GCM) with automatic 24-hour TTL expiry.
-- See: lib/patientCache.js, lib/encryption.js
