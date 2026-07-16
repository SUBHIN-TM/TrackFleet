-- Org admins are now invited by email only: the super admin never types a name
-- or password, so the name starts blank and the emailed password is temporary.

CREATE TYPE "OtpPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- Name is supplied by the admin during first-login setup, not by the inviter.
ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL;

-- Null = mailbox not yet proven. Existing users are already trusted (the super
-- admin set them up by hand), so backfill them as verified rather than locking
-- everyone out of a working system.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailOtp_userId_purpose_idx" ON "EmailOtp"("userId", "purpose");
ALTER TABLE "EmailOtp" ADD CONSTRAINT "EmailOtp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
