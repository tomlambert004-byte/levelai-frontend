-- AlterTable: Add gender to Patient, address and phone to Practice
ALTER TABLE "Patient" ADD COLUMN "gender" TEXT;
ALTER TABLE "Practice" ADD COLUMN "address" TEXT;
ALTER TABLE "Practice" ADD COLUMN "phone" TEXT;
