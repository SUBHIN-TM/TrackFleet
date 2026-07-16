-- Retrievable provisioning password for drivers: lets an admin re-share a
-- driver's sign-in details. Cleared the moment the driver sets their own
-- password (see auth set-password / reset-password). Null for everyone else.
ALTER TABLE "User" ADD COLUMN "provisionalPassword" TEXT;
