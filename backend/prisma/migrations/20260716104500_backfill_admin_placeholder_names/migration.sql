-- Admins invited by email briefly had no name at all, which rendered as a blank
-- row. They now get a placeholder at creation ("Primary Admin", "Admin 2", …);
-- this backfills any row created before that, numbering per organization in the
-- order the admins were invited.
--
-- Guarded by `name IS NULL`, so re-running can't overwrite a real name.
UPDATE "User" u
SET "name" = CASE WHEN r.rn = 1 THEN 'Primary Admin' ELSE 'Admin ' || r.rn END
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt") AS rn
  FROM "User"
  WHERE "role" = 'TENANT_ADMIN'
) r
WHERE u."id" = r."id" AND u."name" IS NULL;

-- Any other role without a name (none expected) falls back to something
-- readable rather than blank.
UPDATE "User" SET "name" = 'User' WHERE "name" IS NULL;
