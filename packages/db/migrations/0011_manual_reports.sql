CREATE TABLE `manual_commands` (
	`owner_id` binary(36) NOT NULL,
	`scope` varbinary(128) NOT NULL,
	`command_key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_commands_owner_id_scope_command_key_pk` PRIMARY KEY(`owner_id`,`scope`,`command_key`),
	CONSTRAINT `manual_commands_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE `manual_evidence` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`state` enum('processing','ready','rejected','deleting','expired') NOT NULL,
	`generation` binary(36) NOT NULL,
	`original_name` varchar(256) NOT NULL,
	`content_type` varchar(128) NOT NULL,
	`byte_length` int unsigned NOT NULL DEFAULT 0,
	`sha256` varbinary(32),
	`fingerprint` varbinary(32),
	`lease_token` binary(36),
	`lease_until` datetime(3),
	`deletion_job_id` binary(36),
	`delete_attempt` int unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`expired_at` datetime(3),
	`next_check_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_evidence_generation` UNIQUE(`id`,`generation`),
	CONSTRAINT `manual_evidence_ready_shape` CHECK(`manual_evidence`.`state` NOT IN ('ready','deleting','expired') OR (`manual_evidence`.`sha256` IS NOT NULL AND `manual_evidence`.`fingerprint` IS NOT NULL AND `manual_evidence`.`byte_length` > 0)),
	CONSTRAINT `manual_evidence_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_evidence_recovery` (`state`,`lease_until`,`id`),
	INDEX `manual_evidence_orphans` (`state`,`updated_at`,`id`),
	INDEX `manual_evidence_retention_scan` (`state`,`next_check_at`,`id`)
);
--> statement-breakpoint
CREATE TABLE `manual_reports` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`current_revision_id` binary(36),
	`revision_number` int unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_report_trip_identity` UNIQUE(`id`,`trip_id`),
	CONSTRAINT `manual_report_version` CHECK(`manual_reports`.`version` > 0 AND `manual_reports`.`revision_number` > 0),
	CONSTRAINT `manual_reports_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_reports_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_report_owner_page` (`owner_id`,`created_at`,`id`),
	INDEX `manual_report_trip_page` (`trip_id`,`created_at`,`id`)
);
--> statement-breakpoint
CREATE TABLE `manual_review_gates` (
	`trip_id` binary(36) NOT NULL,
	`latest_decision_at` datetime(3),
	`under_review` boolean NOT NULL,
	CONSTRAINT `manual_review_gates_trip_id` PRIMARY KEY(`trip_id`),
	CONSTRAINT `manual_review_gates_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_review_retention` (`under_review`,`latest_decision_at`,`trip_id`)
);
--> statement-breakpoint
CREATE TABLE `manual_blob_generations` (
	`evidence_id` binary(36) NOT NULL,
	`generation` binary(36) NOT NULL,
	`state` enum('tracked','deleting') NOT NULL DEFAULT 'tracked',
	`created_at` datetime(3) NOT NULL,
	`lease_until` datetime(3) NOT NULL,
	`next_check_at` datetime(3) NOT NULL,
	`delete_attempt` int unsigned NOT NULL DEFAULT 0,
	`deletion_job_id` binary(36),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_blob_generations_evidence_id_generation_pk` PRIMARY KEY(`evidence_id`,`generation`),
	CONSTRAINT `manual_blob_generations_evidence_id_manual_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `manual_evidence`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_generation_due` (`state`,`next_check_at`,`evidence_id`,`generation`)
);
--> statement-breakpoint
CREATE TABLE `manual_drafts` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`state` enum('editing','submitted') NOT NULL,
	`fields` json NOT NULL,
	`target_trip` json,
	`submitted_report_id` binary(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_drafts_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_drafts_submitted_report_id_manual_reports_id_fk` FOREIGN KEY (`submitted_report_id`) REFERENCES `manual_reports`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_draft_owner_page` (`owner_id`,`created_at`,`id`)
);
--> statement-breakpoint
CREATE TABLE `manual_revisions` (
	`id` binary(36) NOT NULL,
	`report_id` binary(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`format` enum('legacy','extended') NOT NULL,
	`fields` json NOT NULL,
	`source_record_id` binary(36),
	`submitted_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_revision_number` UNIQUE(`report_id`,`number`),
	CONSTRAINT `manual_revision_report_id` UNIQUE(`report_id`,`id`),
	CONSTRAINT `manual_revisions_report_id_manual_reports_id_fk` FOREIGN KEY (`report_id`) REFERENCES `manual_reports`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_revisions_source_record_id_source_messages_id_fk` FOREIGN KEY (`source_record_id`) REFERENCES `source_messages`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_revision_page` (`report_id`,`submitted_at`,`id`)
);
--> statement-breakpoint
CREATE TABLE `manual_correction_requests` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`base_trip_version` int unsigned NOT NULL,
	`base_revision_id` binary(36),
	`reason` varchar(4000) NOT NULL,
	`status` enum('pending','resolved','declined') NOT NULL,
	`requested_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_correction_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_correction_requests_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_correction_owner_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_correction_revision_fk` FOREIGN KEY (`base_revision_id`) REFERENCES `manual_revisions`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_correction_trip_page` (`trip_id`,`requested_at`,`id`)
);
--> statement-breakpoint
CREATE TABLE `manual_draft_evidence` (
	`draft_id` binary(36) NOT NULL,
	`evidence_id` binary(36) NOT NULL,
	`hold_until` datetime(3) NOT NULL,
	CONSTRAINT `manual_draft_evidence_draft_id_evidence_id_pk` PRIMARY KEY(`draft_id`,`evidence_id`),
	CONSTRAINT `manual_draft_evidence_draft_id_manual_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `manual_drafts`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_draft_evidence_evidence_id_manual_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `manual_evidence`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_draft_evidence_reference` (`evidence_id`,`draft_id`)
);
--> statement-breakpoint
CREATE TABLE `manual_draft_history` (
	`draft_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`snapshot` json NOT NULL,
	CONSTRAINT `manual_draft_history_draft_id_version_pk` PRIMARY KEY(`draft_id`,`version`),
	CONSTRAINT `manual_draft_history_draft_id_manual_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `manual_drafts`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE `manual_evidence_refs` (
	`evidence_id` binary(36) NOT NULL,
	`revision_id` binary(36) NOT NULL,
	`report_id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	CONSTRAINT `manual_evidence_refs_evidence_id_revision_id_pk` PRIMARY KEY(`evidence_id`,`revision_id`),
	CONSTRAINT `manual_evidence_refs_evidence_id_manual_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `manual_evidence`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_evidence_refs_revision_id_manual_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `manual_revisions`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_evidence_refs_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_ref_report_revision_fk` FOREIGN KEY (`report_id`,`revision_id`) REFERENCES `manual_revisions`(`report_id`,`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `manual_ref_report_trip_fk` FOREIGN KEY (`report_id`,`trip_id`) REFERENCES `manual_reports`(`id`,`trip_id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_refs_trip` (`trip_id`,`evidence_id`),
	INDEX `manual_refs_revision` (`revision_id`,`evidence_id`)
);
--> statement-breakpoint
CREATE TABLE `manual_correction_history` (
	`id` binary(36) NOT NULL,
	`request_id` binary(36) NOT NULL,
	`status` enum('pending','resolved','declined') NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	`reason` varchar(4000),
	CONSTRAINT `manual_correction_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_correction_history_request_fk` FOREIGN KEY (`request_id`) REFERENCES `manual_correction_requests`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `manual_correction_history_page` (`request_id`,`recorded_at`,`id`)
);
--> statement-breakpoint
ALTER TABLE `manual_reports` ADD CONSTRAINT `manual_report_current_revision_fk` FOREIGN KEY (`id`,`current_revision_id`) REFERENCES `manual_revisions`(`report_id`,`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trip_facts`
  ADD `origin_catalog_revision_id` binary(36),
  ADD `destination_catalog_revision_id` binary(36),
  ADD `cargo_catalog_revision_id` binary(36),
  ADD `adr_catalog_revision_id` binary(36),
  ADD CONSTRAINT `trip_fact_adapter_scope` UNIQUE(`id`,`adapter_version`),
  ADD CONSTRAINT `trip_fact_format2_pin_mode` CHECK (`trip_facts`.`adapter_version` <> 2 OR `trip_facts`.`catalog_revision_id` IS NULL);
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers`
  DROP FOREIGN KEY `trip_trailer_source_catalog_fk`,
  DROP INDEX `trip_trailer_source_catalog_fk`,
  ADD `source_adapter_version` int unsigned DEFAULT 1 NOT NULL,
  ADD `legacy_catalog_revision_id` binary(36) GENERATED ALWAYS AS (IF(`source_adapter_version` = 1, `catalog_revision_id`, NULL)) STORED,
  ADD CONSTRAINT `trip_trailer_adapter_scope_fk` FOREIGN KEY (`trip_fact_id`,`source_adapter_version`) REFERENCES `trip_facts`(`id`,`adapter_version`) ON DELETE restrict ON UPDATE no action,
  ADD CONSTRAINT `trip_trailer_legacy_source_catalog_fk` FOREIGN KEY (`trip_fact_id`,`legacy_catalog_revision_id`) REFERENCES `trip_facts`(`id`,`catalog_revision_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trip_facts`
  DROP CHECK `trip_fact_origin_shape`,
  ADD CONSTRAINT `trip_fact_origin_shape` CHECK ((`trip_facts`.`origin_entity_id` IS NULL AND `trip_facts`.`origin_fact_id` IS NULL AND `trip_facts`.`origin_catalog_revision_id` IS NULL) OR (`trip_facts`.`origin_entity_id` IS NOT NULL AND `trip_facts`.`origin_fact_id` IS NOT NULL AND ((`trip_facts`.`catalog_revision_id` IS NOT NULL AND (`trip_facts`.`origin_catalog_revision_id` IS NULL OR `trip_facts`.`origin_catalog_revision_id` = `trip_facts`.`catalog_revision_id`)) OR (`trip_facts`.`catalog_revision_id` IS NULL AND `trip_facts`.`origin_catalog_revision_id` IS NOT NULL)))),
  ADD CONSTRAINT `trip_origin_individual_pin_fk` FOREIGN KEY (`origin_fact_id`,`origin_catalog_revision_id`,`origin_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trip_facts`
  DROP CHECK `trip_fact_destination_shape`,
  ADD CONSTRAINT `trip_fact_destination_shape` CHECK ((`trip_facts`.`destination_entity_id` IS NULL AND `trip_facts`.`destination_fact_id` IS NULL AND `trip_facts`.`destination_catalog_revision_id` IS NULL) OR (`trip_facts`.`destination_entity_id` IS NOT NULL AND `trip_facts`.`destination_fact_id` IS NOT NULL AND ((`trip_facts`.`catalog_revision_id` IS NOT NULL AND (`trip_facts`.`destination_catalog_revision_id` IS NULL OR `trip_facts`.`destination_catalog_revision_id` = `trip_facts`.`catalog_revision_id`)) OR (`trip_facts`.`catalog_revision_id` IS NULL AND `trip_facts`.`destination_catalog_revision_id` IS NOT NULL)))),
  ADD CONSTRAINT `trip_destination_individual_pin_fk` FOREIGN KEY (`destination_fact_id`,`destination_catalog_revision_id`,`destination_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trip_facts`
  DROP CHECK `trip_fact_cargo_shape`,
  ADD CONSTRAINT `trip_fact_cargo_shape` CHECK ((`trip_facts`.`cargo_entity_id` IS NULL AND `trip_facts`.`cargo_fact_id` IS NULL AND `trip_facts`.`cargo_catalog_revision_id` IS NULL) OR (`trip_facts`.`cargo_entity_id` IS NOT NULL AND `trip_facts`.`cargo_fact_id` IS NOT NULL AND ((`trip_facts`.`catalog_revision_id` IS NOT NULL AND (`trip_facts`.`cargo_catalog_revision_id` IS NULL OR `trip_facts`.`cargo_catalog_revision_id` = `trip_facts`.`catalog_revision_id`)) OR (`trip_facts`.`catalog_revision_id` IS NULL AND `trip_facts`.`cargo_catalog_revision_id` IS NOT NULL)))),
  ADD CONSTRAINT `trip_cargo_individual_pin_fk` FOREIGN KEY (`cargo_fact_id`,`cargo_catalog_revision_id`,`cargo_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trip_facts`
  DROP CHECK `trip_fact_adr_shape`,
  ADD CONSTRAINT `trip_fact_adr_shape` CHECK ((`trip_facts`.`adr_entity_id` IS NULL AND `trip_facts`.`adr_fact_id` IS NULL AND `trip_facts`.`adr_catalog_revision_id` IS NULL) OR (`trip_facts`.`adr_entity_id` IS NOT NULL AND `trip_facts`.`adr_fact_id` IS NOT NULL AND ((`trip_facts`.`catalog_revision_id` IS NOT NULL AND (`trip_facts`.`adr_catalog_revision_id` IS NULL OR `trip_facts`.`adr_catalog_revision_id` = `trip_facts`.`catalog_revision_id`)) OR (`trip_facts`.`catalog_revision_id` IS NULL AND `trip_facts`.`adr_catalog_revision_id` IS NOT NULL)))),
  ADD CONSTRAINT `trip_adr_individual_pin_fk` FOREIGN KEY (`adr_fact_id`,`adr_catalog_revision_id`,`adr_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;
