-- Add human-friendly auto-incrementing tenant code (backfills existing rows).
ALTER TABLE "Tenant" ADD COLUMN "code" SERIAL NOT NULL;
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");
