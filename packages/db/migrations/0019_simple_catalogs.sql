-- VTC-084: replace the versioned catalog system with five plain per-game lists.
-- Destructive and intentionally non-additive (see docs/development/persistence.md).
-- The release stops the app before migrating; a failed run stops at the sticky
-- applying marker and is recovered by restoring the pre-release export.
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_facts_base_fact_id_trip_facts_id_fk`;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_facts_resolution_revision_id_trip_resolutions_id_fk`;
--> statement-breakpoint
ALTER TABLE `manual_reports` DROP FOREIGN KEY `manual_report_current_revision_fk`;
--> statement-breakpoint
UPDATE `trips` SET `alias_of` = NULL;
--> statement-breakpoint
DELETE FROM `job_effect_receipts` WHERE `job_id` IN (SELECT `j`.`id` FROM `durable_jobs` `j` LEFT JOIN `outbox_events` `o` ON `o`.`id` = `j`.`event_id` WHERE `j`.`kind` IN ('catalog.import','trips.reevaluate','reconciliation.search') OR `o`.`type` IN ('catalog.published','trip.correction_recorded','trip.proposal_reviewed','trip.decision_changed','trip.lifecycle_changed','trip.facts_changed','source.snapshot_stored','manual.draft_saved','manual.report_submitted','manual.correction_requested','qualification.rules_changed','qualification.progress_changed','qualification.promoted','promotion.review_required'));
--> statement-breakpoint
DELETE `j` FROM `durable_jobs` `j` LEFT JOIN `outbox_events` `o` ON `o`.`id` = `j`.`event_id` WHERE `j`.`kind` IN ('catalog.import','trips.reevaluate','reconciliation.search') OR `o`.`type` IN ('catalog.published','trip.correction_recorded','trip.proposal_reviewed','trip.decision_changed','trip.lifecycle_changed','trip.facts_changed','source.snapshot_stored','manual.draft_saved','manual.report_submitted','manual.correction_requested','qualification.rules_changed','qualification.progress_changed','qualification.promoted','promotion.review_required');
--> statement-breakpoint
DELETE FROM `outbox_events` WHERE `type` IN ('catalog.published','trip.correction_recorded','trip.proposal_reviewed','trip.decision_changed','trip.lifecycle_changed','trip.facts_changed','source.snapshot_stored','manual.draft_saved','manual.report_submitted','manual.correction_requested','qualification.rules_changed','qualification.progress_changed','qualification.promoted','promotion.review_required');
--> statement-breakpoint
DELETE FROM `notifications` WHERE `subject_kind` IN ('trip','qualification');
--> statement-breakpoint
DELETE FROM `trip_decision_commands`;
--> statement-breakpoint
DELETE FROM `trip_proposal_reviews`;
--> statement-breakpoint
DELETE FROM `trip_proposals`;
--> statement-breakpoint
DELETE FROM `trip_decisions`;
--> statement-breakpoint
DELETE FROM `trip_review_work`;
--> statement-breakpoint
DELETE FROM `trip_event_associations`;
--> statement-breakpoint
DELETE FROM `trip_decision_catchup`;
--> statement-breakpoint
DELETE FROM `trip_resolutions`;
--> statement-breakpoint
DELETE FROM `reconciliation_searches`;
--> statement-breakpoint
DELETE FROM `reconciliation_commands`;
--> statement-breakpoint
DELETE FROM `reconciliation_history`;
--> statement-breakpoint
DELETE FROM `reconciliations`;
--> statement-breakpoint
DELETE FROM `reconciliation_candidates`;
--> statement-breakpoint
DELETE FROM `manual_commands`;
--> statement-breakpoint
DELETE FROM `manual_draft_history`;
--> statement-breakpoint
DELETE FROM `manual_draft_evidence`;
--> statement-breakpoint
DELETE FROM `manual_drafts`;
--> statement-breakpoint
DELETE FROM `manual_correction_history`;
--> statement-breakpoint
DELETE FROM `manual_correction_requests`;
--> statement-breakpoint
DELETE FROM `manual_evidence_refs`;
--> statement-breakpoint
DELETE FROM `manual_revisions`;
--> statement-breakpoint
DELETE FROM `manual_reports`;
--> statement-breakpoint
DELETE FROM `manual_review_gates`;
--> statement-breakpoint
DELETE FROM `trip_contribution_history`;
--> statement-breakpoint
DELETE FROM `trip_contributions`;
--> statement-breakpoint
DELETE FROM `qualification_promotion_reviews`;
--> statement-breakpoint
DELETE FROM `qualification_promotions`;
--> statement-breakpoint
DELETE FROM `qualification_rule_versions`;
--> statement-breakpoint
DELETE FROM `trip_history`;
--> statement-breakpoint
DELETE FROM `trip_fact_trailers`;
--> statement-breakpoint
DELETE FROM `trip_facts`;
--> statement-breakpoint
DELETE FROM `source_payloads`;
--> statement-breakpoint
DELETE FROM `source_messages`;
--> statement-breakpoint
DELETE FROM `source_trips`;
--> statement-breakpoint
DELETE FROM `trips`;
--> statement-breakpoint
DELETE FROM `telemetry_commands`;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP FOREIGN KEY `trip_trailer_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP FOREIGN KEY `trip_trailer_adapter_scope_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP FOREIGN KEY `trip_trailer_legacy_source_catalog_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_facts_catalog_revision_id_catalog_revisions_id_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_origin_individual_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_fact_origin_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_destination_individual_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_fact_destination_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_cargo_individual_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_fact_cargo_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_adr_individual_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP FOREIGN KEY `trip_fact_adr_pin_fk`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP CONSTRAINT `trip_trailer_shape`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP CONSTRAINT `trip_fact_format2_pin_mode`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP CONSTRAINT `trip_fact_origin_shape`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP CONSTRAINT `trip_fact_destination_shape`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP CONSTRAINT `trip_fact_cargo_shape`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP CONSTRAINT `trip_fact_adr_shape`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP INDEX `trip_fact_catalog_scope`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP INDEX `trip_fact_adapter_scope`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP COLUMN `catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP COLUMN `source_adapter_version`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP COLUMN `legacy_catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP COLUMN `entity_id`;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP COLUMN `catalog_fact_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `origin_catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `origin_entity_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `origin_fact_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `destination_catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `destination_entity_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `destination_fact_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `cargo_catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `cargo_entity_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `cargo_fact_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `adr_catalog_revision_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `adr_entity_id`;;
--> statement-breakpoint
ALTER TABLE `trip_facts` DROP COLUMN `adr_fact_id`;;
--> statement-breakpoint
DROP TABLE `event_catalog_pins`;
--> statement-breakpoint
DROP TABLE `catalog_mapping_reviews`, `catalog_mapping_issues`, `catalog_aliases`, `catalog_relations`, `catalog_mappings`, `catalog_changes`, `catalog_coverage`, `catalog_facts`, `catalog_entities`, `catalog_publications`, `catalog_operations`, `catalog_revisions`, `catalog_artifacts`, `catalog_commands`;
--> statement-breakpoint
CREATE TABLE `catalog_dlcs` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256),
	`steam_app_id` int unsigned,
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_dlcs_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_dlc_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_dlc_id_game` UNIQUE(`id`,`game`),
	CONSTRAINT `catalog_dlc_code_nonempty` CHECK(octet_length(`catalog_dlcs`.`code`) > 0),
	CONSTRAINT `catalog_dlc_name_ru_nonempty` CHECK(`catalog_dlcs`.`name_ru` IS NULL OR char_length(`catalog_dlcs`.`name_ru`) > 0),
	CONSTRAINT `catalog_dlc_steam_positive` CHECK(`catalog_dlcs`.`steam_app_id` IS NULL OR `catalog_dlcs`.`steam_app_id` > 0)
);;
--> statement-breakpoint
CREATE TABLE `catalog_regions` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256),
	`dlc_id` binary(36),
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_regions_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_region_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_region_id_game` UNIQUE(`id`,`game`),
	CONSTRAINT `catalog_region_code_nonempty` CHECK(octet_length(`catalog_regions`.`code`) > 0),
	CONSTRAINT `catalog_region_name_ru_nonempty` CHECK(`catalog_regions`.`name_ru` IS NULL OR char_length(`catalog_regions`.`name_ru`) > 0)
);;
--> statement-breakpoint
CREATE TABLE `catalog_cities` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256),
	`region_id` binary(36),
	`dlc_id` binary(36),
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_cities_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_city_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_city_id_game` UNIQUE(`id`,`game`),
	CONSTRAINT `catalog_city_code_nonempty` CHECK(octet_length(`catalog_cities`.`code`) > 0),
	CONSTRAINT `catalog_city_name_ru_nonempty` CHECK(`catalog_cities`.`name_ru` IS NULL OR char_length(`catalog_cities`.`name_ru`) > 0)
);;
--> statement-breakpoint
CREATE TABLE `catalog_cargoes` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256),
	`adr_class` enum('1','2','3','4','6','8'),
	`dlc_id` binary(36),
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_cargoes_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_cargo_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_cargo_id_game` UNIQUE(`id`,`game`),
	CONSTRAINT `catalog_cargo_code_nonempty` CHECK(octet_length(`catalog_cargoes`.`code`) > 0),
	CONSTRAINT `catalog_cargo_name_ru_nonempty` CHECK(`catalog_cargoes`.`name_ru` IS NULL OR char_length(`catalog_cargoes`.`name_ru`) > 0)
);;
--> statement-breakpoint
CREATE TABLE `catalog_trailers` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256),
	`dlc_id` binary(36),
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_trailers_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_trailer_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_trailer_id_game` UNIQUE(`id`,`game`),
	CONSTRAINT `catalog_trailer_code_nonempty` CHECK(octet_length(`catalog_trailers`.`code`) > 0),
	CONSTRAINT `catalog_trailer_name_ru_nonempty` CHECK(`catalog_trailers`.`name_ru` IS NULL OR char_length(`catalog_trailers`.`name_ru`) > 0)
);;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD `trailer_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD `origin_city_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD `destination_city_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD `cargo_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD `adr_class` enum('1','2','3','4','6','8');;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD `origin_city_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD `destination_city_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD `prescribed_cargo_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD `prescribed_trailer_id` binary(36);;
--> statement-breakpoint
ALTER TABLE `catalog_cargoes` ADD CONSTRAINT `catalog_cargo_dlc_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `catalog_cities` ADD CONSTRAINT `catalog_city_region_fk` FOREIGN KEY (`region_id`,`game`) REFERENCES `catalog_regions`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `catalog_cities` ADD CONSTRAINT `catalog_city_dlc_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `catalog_regions` ADD CONSTRAINT `catalog_region_dlc_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `catalog_trailers` ADD CONSTRAINT `catalog_trailer_dlc_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_trailer_shape` CHECK ((`trip_fact_trailers`.`trailer_id` IS NULL AND `trip_fact_trailers`.`source_field` IS NULL AND `trip_fact_trailers`.`unknown_reason` IS NOT NULL) OR (`trip_fact_trailers`.`trailer_id` IS NOT NULL AND `trip_fact_trailers`.`source_field` IS NOT NULL AND `trip_fact_trailers`.`unknown_reason` IS NULL));;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_adr_requires_cargo` CHECK (`trip_facts`.`adr_class` IS NULL OR `trip_facts`.`cargo_id` IS NOT NULL);;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_trailer_catalog_fk` FOREIGN KEY (`trailer_id`) REFERENCES `catalog_trailers`(`id`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_origin_city_fk` FOREIGN KEY (`origin_city_id`) REFERENCES `catalog_cities`(`id`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_destination_city_fk` FOREIGN KEY (`destination_city_id`) REFERENCES `catalog_cities`(`id`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_cargo_fk` FOREIGN KEY (`cargo_id`) REFERENCES `catalog_cargoes`(`id`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_origin_fk` FOREIGN KEY (`origin_city_id`,`game`) REFERENCES `catalog_cities`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_destination_fk` FOREIGN KEY (`destination_city_id`,`game`) REFERENCES `catalog_cities`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_cargo_fk` FOREIGN KEY (`prescribed_cargo_id`,`game`) REFERENCES `catalog_cargoes`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_trailer_fk` FOREIGN KEY (`prescribed_trailer_id`,`game`) REFERENCES `catalog_trailers`(`id`,`game`) ON DELETE restrict ON UPDATE no action;;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_facts_base_fact_id_trip_facts_id_fk` FOREIGN KEY (`base_fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_facts_resolution_revision_id_trip_resolutions_id_fk` FOREIGN KEY (`resolution_revision_id`) REFERENCES `trip_resolutions`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `manual_reports` ADD CONSTRAINT `manual_report_current_revision_fk` FOREIGN KEY (`current_revision_id`) REFERENCES `manual_revisions`(`id`) ON DELETE restrict ON UPDATE no action;
