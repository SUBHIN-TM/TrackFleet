-- Drivers sign in with a per-org login code (e.g. DRV-01) instead of an email,
-- so email becomes optional and a unique loginId is added.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "loginId" TEXT;

-- Unique per tenant; Postgres allows many NULLs, so email-based users (null
-- loginId) and future drivers coexist without collision.
CREATE UNIQUE INDEX "User_tenantId_loginId_key" ON "User"("tenantId", "loginId");
