CREATE TABLE `event_attendance_revisions` (
	`id` binary(36) NOT NULL,
	`event_id` binary(36) NOT NULL,
	`event_revision_id` binary(36) NOT NULL,
	`member_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`sequence` int unsigned NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	`status` enum('attended','not_attended') NOT NULL,
	`note` varchar(2048),
	CONSTRAINT `event_attendance_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_attendance_rev_version` UNIQUE(`event_id`,`member_id`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_attendances` (
	`event_id` binary(36) NOT NULL,
	`member_id` binary(36) NOT NULL,
	`current_revision_id` binary(36) NOT NULL,
	CONSTRAINT `event_attendances_event_id_member_id_pk` PRIMARY KEY(`event_id`,`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_catalog_pins` (
	`revision_id` binary(36) NOT NULL,
	`field` enum('origin','destination','cargo','trailer') NOT NULL,
	`fact_id` binary(36) NOT NULL,
	`entity_id` binary(36) NOT NULL,
	`catalog_revision_id` binary(36) NOT NULL,
	`label` json NOT NULL,
	CONSTRAINT `event_catalog_pins_revision_id_field_pk` PRIMARY KEY(`revision_id`,`field`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_commands` (
	`actor_id` binary(36) NOT NULL,
	`route` enum('create','update','cancel','response','attendance') NOT NULL,
	`target_id` binary(36) NOT NULL,
	`key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	CONSTRAINT `event_commands_actor_id_route_target_id_key_pk` PRIMARY KEY(`actor_id`,`route`,`target_id`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_response_revisions` (
	`id` binary(36) NOT NULL,
	`response_id` binary(36) NOT NULL,
	`event_id` binary(36) NOT NULL,
	`member_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`sequence` int unsigned NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	`status` enum('unanswered','participating','declined') NOT NULL,
	`reason` varchar(2048),
	CONSTRAINT `event_response_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_response_rev_version` UNIQUE(`response_id`,`version`),
	CONSTRAINT `event_decline_reason` CHECK((`event_response_revisions`.`status`='declined' AND `event_response_revisions`.`reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`event_response_revisions`.`reason`))>0) OR (`event_response_revisions`.`status`<>'declined' AND `event_response_revisions`.`reason` IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_responses` (
	`id` binary(36) NOT NULL,
	`event_id` binary(36) NOT NULL,
	`member_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`current_revision_id` binary(36) NOT NULL,
	`status` enum('unanswered','participating','declined') NOT NULL,
	CONSTRAINT `event_responses_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_response_member` UNIQUE(`event_id`,`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_revisions` (
	`id` binary(36) NOT NULL,
	`event_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`sequence` int unsigned NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	`category` enum('created','updated','cancelled') NOT NULL,
	`status` enum('scheduled','cancelled') NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`server` varchar(256) NOT NULL,
	`organizer` varchar(256) NOT NULL,
	`meeting_location` varchar(2048) NOT NULL,
	`route` varchar(2048) NOT NULL,
	`meeting_at` datetime(3) NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3),
	`visibility` enum('public','members') NOT NULL,
	`prescribed_mass_kg` decimal(38,18),
	`private_reason` varchar(2048),
	CONSTRAINT `event_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_revision_version` UNIQUE(`event_id`,`version`),
	CONSTRAINT `event_revision_sequence` UNIQUE(`event_id`,`sequence`),
	CONSTRAINT `event_time_order` CHECK(`event_revisions`.`meeting_at`<=`event_revisions`.`starts_at` AND (`event_revisions`.`ends_at` IS NULL OR `event_revisions`.`ends_at`>=`event_revisions`.`starts_at`)),
	CONSTRAINT `event_mass_nonnegative` CHECK(`event_revisions`.`prescribed_mass_kg` IS NULL OR `event_revisions`.`prescribed_mass_kg`>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `events` (
	`id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`change_sequence` int unsigned NOT NULL,
	`attendance_version` int unsigned NOT NULL,
	`current_revision_id` binary(36),
	`game` enum('ets2','ats') NOT NULL,
	`visibility` enum('public','members') NOT NULL,
	`status` enum('scheduled','cancelled') NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_versions_positive` CHECK(`events`.`version`>0 AND `events`.`change_sequence`>0 AND `events`.`attendance_version`>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `audit_entries` MODIFY COLUMN `subject_kind` enum('company','user','trip','catalog','application','invitation','qualification','event') NOT NULL;--> statement-breakpoint
ALTER TABLE `event_attendance_revisions` ADD CONSTRAINT `event_attendance_rev_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_attendance_revisions` ADD CONSTRAINT `event_attendance_rev_definition_fk` FOREIGN KEY (`event_revision_id`) REFERENCES `event_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_attendance_revisions` ADD CONSTRAINT `event_attendance_rev_member_fk` FOREIGN KEY (`member_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_attendance_revisions` ADD CONSTRAINT `event_attendance_rev_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_attendances` ADD CONSTRAINT `event_attendance_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_attendances` ADD CONSTRAINT `event_attendance_member_fk` FOREIGN KEY (`member_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_catalog_pins` ADD CONSTRAINT `event_pin_revision_fk` FOREIGN KEY (`revision_id`) REFERENCES `event_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_catalog_pins` ADD CONSTRAINT `event_pin_catalog_fk` FOREIGN KEY (`fact_id`,`catalog_revision_id`,`entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_commands` ADD CONSTRAINT `event_command_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_response_revisions` ADD CONSTRAINT `event_response_rev_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_response_revisions` ADD CONSTRAINT `event_response_rev_member_fk` FOREIGN KEY (`member_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_response_revisions` ADD CONSTRAINT `event_response_rev_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_responses` ADD CONSTRAINT `event_response_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_responses` ADD CONSTRAINT `event_response_member_fk` FOREIGN KEY (`member_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `event_attendance_order` ON `event_attendance_revisions` (`event_id`,`sequence`,`member_id`);--> statement-breakpoint
CREATE INDEX `event_response_order` ON `event_response_revisions` (`event_id`,`sequence`,`member_id`);--> statement-breakpoint
CREATE INDEX `event_participants_page` ON `event_responses` (`event_id`,`status`,`member_id`);--> statement-breakpoint
CREATE INDEX `event_member_page` ON `events` (`starts_at`,`id`);--> statement-breakpoint
CREATE INDEX `event_public_page` ON `events` (`visibility`,`starts_at`,`id`);