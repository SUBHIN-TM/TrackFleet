-- Schedules get a human name ("Schedule 3") so the admin can identify them at a
-- glance. Backfill existing rows with an incrementing number per tenant.
ALTER TABLE "TripSchedule" ADD COLUMN "name" TEXT;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt") AS rn
  FROM "TripSchedule"
)
UPDATE "TripSchedule" t SET "name" = 'Schedule ' || n.rn FROM numbered n WHERE t.id = n.id;
ALTER TABLE "TripSchedule" ALTER COLUMN "name" SET NOT NULL;
