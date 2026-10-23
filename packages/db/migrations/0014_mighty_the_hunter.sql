CREATE TABLE `trip_resolutions` (
	`id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`base_fact_id` binary(36) NOT NULL,
	`author_id` binary(36) NOT NULL,
	`changes` json NOT NULL,
	`evidence_ids` json NOT NULL,
	`reason` varchar(2048) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_resolutions_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_resolutions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_resolutions_base_fact_id_trip_facts_id_fk` FOREIGN KEY (`base_fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_resolutions_author_id_identity_memberships_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE `trip_decision_catchup` (
	`id` int unsigned NOT NULL,
	`generation` int unsigned DEFAULT 0 NOT NULL,
	`cursor` binary(36),
	`complete` boolean NOT NULL,
	CONSTRAINT `trip_decision_catchup_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trip_decision_commands` (
	`actor_id` binary(36) NOT NULL,
	`operation` enum('decide','propose','review','associate') NOT NULL,
	`key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_decision_commands_actor_id_operation_key_pk` PRIMARY KEY(`actor_id`,`operation`,`key`),
	CONSTRAINT `trip_decision_commands_actor_id_identity_memberships_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE `trip_decisions` (
	`id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`sequence` int unsigned NOT NULL,
	`fact_id` binary(36) NOT NULL,
	`outcome` enum('accepted','rejected') NOT NULL,
	`actor_id` binary(36),
	`reviewed_revision_id` binary(36),
	`reason` varchar(2048),
	`reason_codes` json NOT NULL,
	`assignment_id` binary(36),
	`level_id` binary(36),
	`rule_version_id` binary(36),
	`event_id` binary(36),
	`event_revision_id` binary(36),
	`attendance_revision_id` binary(36),
	`attribution_at` datetime(3),
	`attribution_basis` enum('actual_start','manual_confirmation','staff_resolution','unknown') NOT NULL,
	`reporting_at` datetime(3),
	`supporting_facts` json NOT NULL,
	`decided_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_decisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_decision_sequence` UNIQUE(`trip_id`,`sequence`),
	CONSTRAINT `trip_decision_reason` CHECK(`trip_decisions`.`actor_id` IS NULL OR CHAR_LENGTH(TRIM(`trip_decisions`.`reason`)) > 0),
	CONSTRAINT `trip_decisions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_fact_id_trip_facts_id_fk` FOREIGN KEY (`fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_actor_id_identity_memberships_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_assignment_id_qualification_assignments_id_fk` FOREIGN KEY (`assignment_id`) REFERENCES `qualification_assignments`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_level_id_qualification_levels_id_fk` FOREIGN KEY (`level_id`) REFERENCES `qualification_levels`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_rule_version_id_qualification_rule_versions_id_fk` FOREIGN KEY (`rule_version_id`) REFERENCES `qualification_rule_versions`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decisions_event_revision_id_event_revisions_id_fk` FOREIGN KEY (`event_revision_id`) REFERENCES `event_revisions`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_decision_attendance_fk` FOREIGN KEY (`attendance_revision_id`) REFERENCES `event_attendance_revisions`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE `trip_event_associations` (
	`trip_id` binary(36) NOT NULL,
	`event_id` binary(36) NOT NULL,
	CONSTRAINT `trip_event_associations_trip_id` PRIMARY KEY(`trip_id`),
	CONSTRAINT `trip_event_associations_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_event_associations_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `trip_event_fanout` (`event_id`,`trip_id`)
);
--> statement-breakpoint
CREATE TABLE `trip_proposals` (
	`id` binary(36) NOT NULL,
	`revision_id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`kind` enum('correction_request','resolution') NOT NULL,
	`correction_request_id` binary(36),
	`author_id` binary(36) NOT NULL,
	`base_trip_version` int unsigned NOT NULL,
	`base_fact_id` binary(36) NOT NULL,
	`derived_fact_id` binary(36),
	`resolution_id` binary(36),
	`support_hash` varbinary(32) NOT NULL,
	`reason` varchar(2048) NOT NULL,
	`evidence_ids` json NOT NULL,
	`changes` json,
	`event_id` binary(36),
	`event_revision_id` binary(36),
	`attendance_revision_id` binary(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_proposal_revision` UNIQUE(`revision_id`),
	CONSTRAINT `trip_proposals_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposal_correction_fk` FOREIGN KEY (`correction_request_id`) REFERENCES `manual_correction_requests`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposals_author_id_identity_memberships_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposals_base_fact_id_trip_facts_id_fk` FOREIGN KEY (`base_fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposals_derived_fact_id_trip_facts_id_fk` FOREIGN KEY (`derived_fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposals_resolution_id_trip_resolutions_id_fk` FOREIGN KEY (`resolution_id`) REFERENCES `trip_resolutions`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposals_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposals_event_revision_id_event_revisions_id_fk` FOREIGN KEY (`event_revision_id`) REFERENCES `event_revisions`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposal_attendance_fk` FOREIGN KEY (`attendance_revision_id`) REFERENCES `event_attendance_revisions`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposal_event_shape` CHECK ((`event_id` IS NULL AND `event_revision_id` IS NULL AND `attendance_revision_id` IS NULL) OR (`event_id` IS NOT NULL AND `event_revision_id` IS NOT NULL)),
	INDEX `trip_proposal_page` (`trip_id`,`created_at`,`id`)
);
--> statement-breakpoint
CREATE TABLE `trip_proposal_reviews` (
	`proposal_id` binary(36) NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`outcome` enum('approve','reject') NOT NULL,
	`reviewed_revision_id` binary(36) NOT NULL,
	`reason` varchar(2048) NOT NULL,
	`decided_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_proposal_reviews_proposal_id` PRIMARY KEY(`proposal_id`),
	CONSTRAINT `trip_proposal_reviews_proposal_id_trip_proposals_id_fk` FOREIGN KEY (`proposal_id`) REFERENCES `trip_proposals`(`id`) ON DELETE restrict ON UPDATE no action,
	CONSTRAINT `trip_proposal_reviews_actor_id_identity_memberships_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE `trip_review_work` (
	`trip_id` binary(36) NOT NULL,
	`support_hash` varbinary(32) NOT NULL,
	`pending` boolean NOT NULL,
	`reasons` json NOT NULL,
	`assessed_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_review_work_trip_id` PRIMARY KEY(`trip_id`),
	CONSTRAINT `trip_review_work_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action,
	INDEX `trip_review_pending` (`pending`,`trip_id`)
);
--> statement-breakpoint
ALTER TABLE `trip_facts`
	DROP CONSTRAINT `trip_fact_start_supported`,
	DROP CONSTRAINT `trip_fact_end_supported`,
	MODIFY COLUMN `message_id` binary(36),
	MODIFY COLUMN `start_basis` enum('event','checkpoint','last-known','receipt','unknown','staff-resolution') NOT NULL,
	MODIFY COLUMN `end_basis` enum('event','checkpoint','last-known','receipt','unknown','staff-resolution') NOT NULL,
	ADD `kind` enum('source','derived') DEFAULT 'source' NOT NULL,
	ADD `base_fact_id` binary(36),
	ADD `resolution_revision_id` binary(36),
	ADD `derived_source_message_id` binary(36),
	ADD CONSTRAINT `trip_fact_resolution` UNIQUE(`resolution_revision_id`),
	ADD CONSTRAINT `trip_fact_provenance_shape` CHECK ((`trip_facts`.`kind` = 'source' AND `trip_facts`.`message_id` IS NOT NULL AND `trip_facts`.`base_fact_id` IS NULL AND `trip_facts`.`resolution_revision_id` IS NULL AND `trip_facts`.`derived_source_message_id` IS NULL) OR (`trip_facts`.`kind` = 'derived' AND `trip_facts`.`message_id` IS NULL AND `trip_facts`.`base_fact_id` IS NOT NULL AND `trip_facts`.`resolution_revision_id` IS NOT NULL AND `trip_facts`.`derived_source_message_id` IS NOT NULL AND `trip_facts`.`base_fact_id` <> `trip_facts`.`id`)),
	ADD CONSTRAINT `trip_fact_start_supported` CHECK (`trip_facts`.`start_verified` = 0 OR ((`trip_facts`.`start_basis` = 'event' OR (`trip_facts`.`kind` = 'derived' AND `trip_facts`.`start_basis` = 'staff-resolution')) AND `trip_facts`.`start_utc` IS NOT NULL)),
	ADD CONSTRAINT `trip_fact_end_supported` CHECK (`trip_facts`.`end_verified` = 0 OR ((`trip_facts`.`end_basis` = 'event' OR (`trip_facts`.`kind` = 'derived' AND `trip_facts`.`end_basis` = 'staff-resolution')) AND `trip_facts`.`end_utc` IS NOT NULL)),
	ADD CONSTRAINT `trip_facts_base_fact_id_trip_facts_id_fk` FOREIGN KEY (`base_fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action,
	ADD CONSTRAINT `trip_facts_resolution_revision_id_trip_resolutions_id_fk` FOREIGN KEY (`resolution_revision_id`) REFERENCES `trip_resolutions`(`id`) ON DELETE restrict ON UPDATE no action,
	ADD CONSTRAINT `trip_facts_derived_source_message_id_source_messages_id_fk` FOREIGN KEY (`derived_source_message_id`) REFERENCES `source_messages`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `trips`
	ADD `adjudication_version` int unsigned DEFAULT 0 NOT NULL,
	ADD `assessment_pending` boolean DEFAULT true NOT NULL,
	ADD INDEX `trip_assessment_pending` (`assessment_pending`,`alias_of`,`id`);
--> statement-breakpoint
ALTER TABLE `trip_contributions` MODIFY COLUMN `attribution_basis` enum('actual_start','manual_confirmation','unresolved','staff_resolution') NOT NULL;

--> statement-breakpoint
ALTER TABLE `events`
 ADD `trip_assessment_pending` boolean DEFAULT false NOT NULL,
 ADD `trip_assessment_generation` int unsigned DEFAULT 0 NOT NULL,
 ADD INDEX `event_trip_assessment_pending` (`trip_assessment_pending`,`id`);
