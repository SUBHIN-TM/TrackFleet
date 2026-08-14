-- AlterTable
ALTER TABLE "LocationPoint" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "held" BOOLEAN NOT NULL DEFAULT false;
