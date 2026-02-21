-- CreateIndex — prevent duplicate patients per practice (by externalId)
-- Note: externalId is nullable, so this only applies when externalId is NOT NULL.
-- Postgres unique constraints naturally exclude NULL values (two NULLs are not "equal").
CREATE UNIQUE INDEX "Patient_practiceId_externalId_key" ON "Patient"("practiceId", "externalId");
