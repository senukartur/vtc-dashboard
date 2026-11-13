CREATE TABLE `trip_review_reasons` (
	`trip_id` binary(36) NOT NULL,
	`code` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	CONSTRAINT `trip_review_reasons_trip_id_code_pk` PRIMARY KEY(`trip_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_candidate_dismissals` (
	`candidate_id` binary(36) NOT NULL,
	`dismissed_by` binary(36) NOT NULL,
	`dismissed_at` datetime(3) NOT NULL,
	`reason` varchar(2048) NOT NULL,
	`version` int unsigned NOT NULL,
	`undone_by` binary(36),
	`undone_at` datetime(3),
	CONSTRAINT `reconciliation_candidate_dismissals_candidate_id` PRIMARY KEY(`candidate_id`),
	CONSTRAINT `recon_dismissal_persisted_version` CHECK(`reconciliation_candidate_dismissals`.`version` > 1),
	CONSTRAINT `recon_dismissal_reason_present` CHECK(REGEXP_LIKE(`reconciliation_candidate_dismissals`.`reason`, '[^[:space:]]')),
	CONSTRAINT `recon_dismissal_undo_pair` CHECK((`reconciliation_candidate_dismissals`.`undone_by` IS NULL) = (`reconciliation_candidate_dismissals`.`undone_at` IS NULL)),
	CONSTRAINT `recon_dismissal_undo_time` CHECK(`reconciliation_candidate_dismissals`.`undone_at` >= `reconciliation_candidate_dismissals`.`dismissed_at`)
);
--> statement-breakpoint
ALTER TABLE `audit_entries` MODIFY COLUMN `subject_kind` enum('company','user','trip','catalog','application','invitation','qualification','event','duplicate_candidate','qualification_level','qualification_rule_version') NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `details` json;--> statement-breakpoint
ALTER TABLE `qualification_states` ADD `eligible_since` datetime(3);--> statement-breakpoint
ALTER TABLE `trips` ADD `queued_at` datetime(3);--> statement-breakpoint
ALTER TABLE `reconciliation_commands` MODIFY COLUMN `operation` enum('merge','reverse','dismiss','undo_dismissal') NOT NULL;--> statement-breakpoint
ALTER TABLE `trip_review_reasons` ADD CONSTRAINT `trip_review_reasons_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_candidate_dismissals` ADD CONSTRAINT `recon_dismissal_candidate_fk` FOREIGN KEY (`candidate_id`) REFERENCES `reconciliation_candidates`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_candidate_dismissals` ADD CONSTRAINT `recon_dismissal_actor_fk` FOREIGN KEY (`dismissed_by`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_candidate_dismissals` ADD CONSTRAINT `recon_dismissal_undo_actor_fk` FOREIGN KEY (`undone_by`) REFERENCES `identity_memberships`(`user_id`);--> statement-breakpoint
CREATE INDEX `trip_review_reason_filter` ON `trip_review_reasons` (`code`,`trip_id`);--> statement-breakpoint
CREATE INDEX `trip_review_queued_at` ON `trips` (`review_hold`,`alias_of`,`queued_at`,`id`);
--> statement-breakpoint
-- Backfill the published queue clock only for held canonical roots. Drain writers throughout.
START TRANSACTION;
--> statement-breakpoint
UPDATE `trips` SET `queued_at` = `created_at` WHERE `review_hold` = TRUE AND `alias_of` IS NULL;
--> statement-breakpoint
INSERT INTO `trip_review_reasons` (`trip_id`, `code`)
SELECT DISTINCT t.`id`, CONVERT(reason.`code` USING ascii) COLLATE ascii_bin
FROM `trips` AS t
CROSS JOIN JSON_TABLE(t.`review_reasons`, '$[*]' COLUMNS (
  `code` VARCHAR(128) PATH '$' ERROR ON EMPTY ERROR ON ERROR
)) AS reason
WHERE t.`review_hold` = TRUE AND t.`alias_of` IS NULL;
--> statement-breakpoint
COMMIT;
