-- Globalize the school-only "grade" label into a neutral "category" that fits
-- every vertical (school class, hospital ward, office team), and give the
-- passenger their own phone number.
ALTER TABLE "Passenger" RENAME COLUMN "grade" TO "category";
ALTER TABLE "Passenger" ADD COLUMN "phone" TEXT;
