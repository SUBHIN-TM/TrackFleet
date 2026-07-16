-- Vertical goes from a hardcoded enum to super-admin-managed data, so new
-- organization types no longer need a migration.

-- 1. The new table.
CREATE TABLE "OrgType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passengerLabel" TEXT NOT NULL,
    "guardianLabel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgType_key_key" ON "OrgType"("key");
CREATE UNIQUE INDEX "OrgType_name_key" ON "OrgType"("name");

-- 2. Seed the three enum members as rows. Fixed ids (not cuids) so the backfill
--    below can reference them and so re-seeding is idempotent.
INSERT INTO "OrgType" ("id", "key", "name", "passengerLabel", "guardianLabel", "updatedAt") VALUES
  ('orgtype_school',   'SCHOOL',   'School',           'Students',         'Parents',     CURRENT_TIMESTAMP),
  ('orgtype_hospital', 'HOSPITAL', 'Hospital',         'Staff / Patients', 'Next of kin', CURRENT_TIMESTAMP),
  ('orgtype_company',  'COMPANY',  'Company / Office', 'Employees',        'Emergency contact', CURRENT_TIMESTAMP);

-- 3. Point Tenant at it. Nullable first so existing rows survive the ALTER.
ALTER TABLE "Tenant" ADD COLUMN "orgTypeId" TEXT;

-- 4. Backfill from the enum column being retired.
UPDATE "Tenant" SET "orgTypeId" = 'orgtype_school'   WHERE "vertical" = 'SCHOOL';
UPDATE "Tenant" SET "orgTypeId" = 'orgtype_hospital' WHERE "vertical" = 'HOSPITAL';
UPDATE "Tenant" SET "orgTypeId" = 'orgtype_company'  WHERE "vertical" = 'COMPANY';

-- Belt and braces: the enum was NOT NULL, so this should already be empty.
UPDATE "Tenant" SET "orgTypeId" = 'orgtype_school' WHERE "orgTypeId" IS NULL;

-- 5. Now it can be required.
ALTER TABLE "Tenant" ALTER COLUMN "orgTypeId" SET NOT NULL;
CREATE INDEX "Tenant_orgTypeId_idx" ON "Tenant"("orgTypeId");
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_orgTypeId_fkey"
  FOREIGN KEY ("orgTypeId") REFERENCES "OrgType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Retire the enum.
ALTER TABLE "Tenant" DROP COLUMN "vertical";
DROP TYPE "Vertical";
