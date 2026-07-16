-- A passenger belongs to exactly one route (or none). Route membership lives on
-- the passenger as a single FK, so reassigning simply moves it — a passenger can
-- never be in two routes at once. ON DELETE SET NULL keeps passengers if a route
-- is removed.
ALTER TABLE "Passenger" ADD COLUMN "routeId" TEXT;
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Passenger_routeId_idx" ON "Passenger"("routeId");
