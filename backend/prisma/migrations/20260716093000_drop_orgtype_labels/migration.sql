-- Display wording ("Students", "Parents") does not belong on the org type:
-- two schools may want different words, so it varies per organization, not per
-- type. Dropped rather than left unused. If per-org wording is wanted later it
-- goes on Tenant, where it can actually vary.
ALTER TABLE "OrgType" DROP COLUMN "passengerLabel";
ALTER TABLE "OrgType" DROP COLUMN "guardianLabel";
