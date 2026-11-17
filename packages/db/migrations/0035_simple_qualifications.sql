-- VTC-157: replace the eight-table qualification model with levels, level trailer types and
-- assignments. Destructive and intentionally non-additive (see docs/development/persistence.md).
-- Level IDs, names and positions, assignment IDs, contributions and decisions are kept; rule
-- versions, states, promotion proofs and reviews, ladder history and initial assignments go.
-- The release stops the app before migrating; a failed run stops at the sticky applying marker
-- and is recovered by restoring the pre-release export.
ALTER TABLE `trip_contributions`
	DROP FOREIGN KEY `trip_credit_rules_fk`,
	DROP CHECK `trip_credit_shape`,
	DROP COLUMN `rule_version_id`,
	ADD CONSTRAINT `trip_credit_shape_v2` CHECK(`trip_contributions`.`credited` = 0 OR (`trip_contributions`.`accepted` = 1 AND `trip_contributions`.`alias_of` IS NULL AND `trip_contributions`.`assignment_id` IS NOT NULL AND `trip_contributions`.`attribution_at` IS NOT NULL AND `trip_contributions`.`actual_distance_m` > 0));
--> statement-breakpoint
ALTER TABLE `trip_decisions`
	DROP FOREIGN KEY `trip_decisions_rule_version_id_qualification_rule_versions_id_fk`,
	DROP COLUMN `rule_version_id`,
	ADD `qualification_snapshot` json;
--> statement-breakpoint
ALTER TABLE `qualification_levels`
	DROP INDEX `qualification_level_code`,
	DROP CHECK `qual_level_revisions_positive`,
	DROP CHECK `qual_level_position_range`,
	DROP COLUMN `code`,
	DROP COLUMN `ladder_revision`,
	DROP COLUMN `promotion_generation`,
	RENAME COLUMN `active_position` TO `position`,
	ADD `mass_min_kg` decimal(38,18),
	ADD `mass_max_kg` decimal(38,18),
	ADD `distance_min_m` decimal(38,18),
	ADD `distance_max_m` decimal(38,18),
	ADD `trailer_mode` enum('any','selected') DEFAULT 'any' NOT NULL,
	ADD `adr_mode` enum('forbidden','selected','any') DEFAULT 'any' NOT NULL,
	ADD `adr_classes` json,
	ADD `hard_mode_required` boolean DEFAULT false NOT NULL,
	ADD `required_trips` int unsigned,
	ADD `required_distance_m` decimal(38,18),
	ADD `deleted_at` datetime(3),
	ADD CONSTRAINT `qualification_level_id_game` UNIQUE(`id`,`game`),
	ADD CONSTRAINT `qual_level_position_bounds` CHECK(`qualification_levels`.`position` IS NULL OR `qualification_levels`.`position` BETWEEN 1 AND 25),
	ADD CONSTRAINT `qual_level_mass_range` CHECK(`qualification_levels`.`mass_min_kg` IS NULL OR `qualification_levels`.`mass_max_kg` IS NULL OR `qualification_levels`.`mass_min_kg` <= `qualification_levels`.`mass_max_kg`),
	ADD CONSTRAINT `qual_level_distance_range` CHECK(`qualification_levels`.`distance_min_m` IS NULL OR `qualification_levels`.`distance_max_m` IS NULL OR `qualification_levels`.`distance_min_m` <= `qualification_levels`.`distance_max_m`),
	ADD CONSTRAINT `qual_level_adr_classes` CHECK((`qualification_levels`.`adr_mode` = 'selected') = (`qualification_levels`.`adr_classes` IS NOT NULL)),
	ADD CONSTRAINT `qual_level_required_trips` CHECK(`qualification_levels`.`required_trips` IS NULL OR `qualification_levels`.`required_trips` > 0),
	ADD CONSTRAINT `qual_level_required_distance` CHECK(`qualification_levels`.`required_distance_m` IS NULL OR `qualification_levels`.`required_distance_m` > 0);
--> statement-breakpoint
ALTER TABLE `qualification_assignments`
	MODIFY COLUMN `purpose` enum('initial','reinstatement','historical_resolution','administrative_correction','promotion','ladder_archive_transfer','admission','manual','level_removed') NOT NULL;
--> statement-breakpoint
START TRANSACTION;
--> statement-breakpoint
UPDATE `qualification_levels` SET `deleted_at` = UTC_TIMESTAMP(3) WHERE `position` IS NULL;
--> statement-breakpoint
UPDATE `qualification_assignments` SET `purpose` = CASE `purpose` WHEN 'initial' THEN 'admission' WHEN 'historical_resolution' THEN 'manual' WHEN 'administrative_correction' THEN 'manual' WHEN 'ladder_archive_transfer' THEN 'level_removed' ELSE `purpose` END;
--> statement-breakpoint
UPDATE `qualification_assignments` `a` LEFT JOIN `qualification_states` `s` ON `s`.`assignment_id` = `a`.`id` SET `a`.`ended_at` = `a`.`assigned_at` WHERE `a`.`ended_at` IS NULL AND `s`.`assignment_id` IS NULL;
--> statement-breakpoint
DELETE FROM `job_effect_receipts` WHERE `job_id` IN (SELECT `j`.`id` FROM `durable_jobs` `j` JOIN `outbox_events` `o` ON `o`.`id` = `j`.`event_id` WHERE `o`.`type` IN ('qualification.rules_changed','qualification.progress_changed','promotion.review_required'));
--> statement-breakpoint
DELETE `j` FROM `durable_jobs` `j` JOIN `outbox_events` `o` ON `o`.`id` = `j`.`event_id` WHERE `o`.`type` IN ('qualification.rules_changed','qualification.progress_changed','promotion.review_required');
--> statement-breakpoint
DELETE `r` FROM `outbox_routing` `r` JOIN `outbox_events` `o` ON `o`.`id` = `r`.`event_id` WHERE `o`.`type` IN ('qualification.rules_changed','qualification.progress_changed','promotion.review_required');
--> statement-breakpoint
DELETE FROM `outbox_events` WHERE `type` IN ('qualification.rules_changed','qualification.progress_changed','promotion.review_required');
--> statement-breakpoint
DELETE FROM `notifications` WHERE `category` IN ('promotion.eligible','promotion.review_required');
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
ALTER TABLE `qualification_levels`
	ADD CONSTRAINT `qual_level_deleted` CHECK((`qualification_levels`.`position` IS NULL) = (`qualification_levels`.`deleted_at` IS NOT NULL));
--> statement-breakpoint
ALTER TABLE `qualification_assignments`
	DROP CHECK `qual_assignment_revision_positive`,
	DROP COLUMN `revision`,
	CHANGE COLUMN `purpose` `kind` enum('admission','promotion','manual','level_removed','reinstatement') NOT NULL,
	CHANGE COLUMN `reason` `comment` varchar(2048),
	ADD `previous_assignment_id` binary(36),
	ADD `open_marker` tinyint GENERATED ALWAYS AS (IF(ended_at IS NULL, 1, NULL)) STORED,
	ADD CONSTRAINT `qualification_assignment_previous` UNIQUE(`previous_assignment_id`),
	ADD CONSTRAINT `qualification_assignment_open` UNIQUE(`user_id`,`game`,`open_marker`),
	ADD INDEX `qualification_assignment_level_open` (`level_id`,`open_marker`),
	ADD CONSTRAINT `qual_assignment_previous_fk` FOREIGN KEY (`previous_assignment_id`) REFERENCES `qualification_assignments`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP TABLE `qualification_promotion_reviews`, `qualification_promotions`, `qualification_states`, `qualification_initial_assignments`, `qualification_ladder_history`, `qualification_rule_versions`;
--> statement-breakpoint
CREATE TABLE `qualification_level_trailers` (
	`level_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`trailer_id` binary(36) NOT NULL,
	CONSTRAINT `qualification_level_trailers_level_id_trailer_id_pk` PRIMARY KEY(`level_id`,`trailer_id`),
	CONSTRAINT `qual_level_trailer_level_fk` FOREIGN KEY (`level_id`,`game`) REFERENCES `qualification_levels`(`id`,`game`) ON DELETE cascade ON UPDATE no action,
	CONSTRAINT `qual_level_trailer_catalog_fk` FOREIGN KEY (`trailer_id`,`game`) REFERENCES `catalog_trailers`(`id`,`game`) ON DELETE restrict ON UPDATE no action
);
