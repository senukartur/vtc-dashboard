-- Keep the same UTC instant across all seven tables. Catalog writers must be drained.
SET @vtc_catalog_backfill_at = UTC_TIMESTAMP(3);
--> statement-breakpoint
ALTER TABLE `catalog_cargoes` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
ALTER TABLE `catalog_cities` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
ALTER TABLE `catalog_companies` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
ALTER TABLE `catalog_company_cities` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
ALTER TABLE `catalog_dlcs` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
ALTER TABLE `catalog_regions` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
ALTER TABLE `catalog_trailers` ADD `updated_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;
--> statement-breakpoint
START TRANSACTION;
--> statement-breakpoint
UPDATE `catalog_cargoes` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
UPDATE `catalog_cities` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
UPDATE `catalog_companies` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
UPDATE `catalog_company_cities` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
UPDATE `catalog_dlcs` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
UPDATE `catalog_regions` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
UPDATE `catalog_trailers` SET `updated_at` = @vtc_catalog_backfill_at;
--> statement-breakpoint
COMMIT;
