-- Add optional human-friendly fleet/bus number to Vehicle, unique per tenant.
ALTER TABLE "Vehicle" ADD COLUMN "fleetNo" TEXT;

CREATE UNIQUE INDEX "Vehicle_tenantId_fleetNo_key" ON "Vehicle"("tenantId", "fleetNo");
