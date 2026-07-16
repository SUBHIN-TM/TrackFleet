-- Bring existing login ids onto the TF- standard: "greenvalley" -> "tf-greenvalley".
-- Guarded by the NOT LIKE so re-running can't produce "tf-tf-greenvalley".
UPDATE "Tenant" SET "slug" = 'tf-' || "slug" WHERE "slug" NOT LIKE 'tf-%';
