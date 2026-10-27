CREATE TABLE `outbox_routing` (
	`event_id` binary(36) NOT NULL,
	`consumer` varbinary(64) NOT NULL,
	`event_type` varbinary(64) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	CONSTRAINT `outbox_routing_event_id_consumer_pk` PRIMARY KEY(`event_id`,`consumer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `outbox_routing_scans` (
	`consumer` varbinary(64) NOT NULL,
	`cursor` binary(36),
	CONSTRAINT `outbox_routing_scans_consumer` PRIMARY KEY(`consumer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `notification_commands` (
	`recipient_id` binary(36) NOT NULL,
	`route` enum('read','read-all','preferences') NOT NULL,
	`key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	CONSTRAINT `notification_commands_recipient_id_route_key_pk` PRIMARY KEY(`recipient_id`,`route`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` binary(36) NOT NULL,
	`recipient_id` binary(36) NOT NULL,
	`sequence` bigint NOT NULL,
	`effect_key` varbinary(128) NOT NULL,
	`category` varchar(128) NOT NULL,
	`access` enum('company','trips.review','applications.manage','qualifications.manage','members.manage') NOT NULL,
	`owner_id` binary(36),
	`subject_kind` enum('trip','event','qualification','application','member') NOT NULL,
	`subject_id` binary(36) NOT NULL,
	`subject_version` int unsigned NOT NULL,
	`actor_nickname` varchar(128),
	`game` enum('ets2','ats'),
	`event_title` varchar(256),
	`occurred_at` datetime(3) NOT NULL,
	`live_until` datetime(3),
	`read_at` datetime(3),
	`invalidated_at` datetime(3),
	`reminder_revision_id` binary(36),
	`reminder_response_id` binary(36),
	`expires_at` datetime(3),
	`recipient_access_epoch` int unsigned NOT NULL,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_recipient_sequence` UNIQUE(`recipient_id`,`sequence`),
	CONSTRAINT `notification_recipient_effect` UNIQUE(`recipient_id`,`effect_key`),
	CONSTRAINT `notification_sequence_positive` CHECK(`notifications`.`sequence`>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `notification_recipients` (
	`recipient_id` binary(36) NOT NULL,
	`sequence` bigint NOT NULL DEFAULT '0',
	`version` int unsigned NOT NULL DEFAULT 1,
	`trip_started` boolean NOT NULL DEFAULT true,
	`trip_finished` boolean NOT NULL DEFAULT true,
	`trip_rejected` boolean NOT NULL DEFAULT true,
	`event_changes` boolean NOT NULL DEFAULT true,
	`event_reminders` boolean NOT NULL DEFAULT true,
	`qualification_changes` boolean NOT NULL DEFAULT true,
	CONSTRAINT `notification_recipients_recipient_id` PRIMARY KEY(`recipient_id`),
	CONSTRAINT `notification_sequence_nonnegative` CHECK(`notification_recipients`.`sequence`>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `events` ADD `notification_pending` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox_routing` ADD CONSTRAINT `outbox_routing_event_id_outbox_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `outbox_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_commands` ADD CONSTRAINT `notification_command_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `notification_recipients`(`recipient_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notification_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `notification_recipients`(`recipient_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipient_member_fk` FOREIGN KEY (`recipient_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `outbox_routing_pending` ON `outbox_routing` (`consumer`,`recorded_at`,`event_id`);--> statement-breakpoint
CREATE INDEX `notification_unread` ON `notifications` (`recipient_id`,`read_at`,`invalidated_at`,`access`);--> statement-breakpoint
CREATE INDEX `notification_subject` ON `notifications` (`subject_kind`,`subject_id`,`category`,`recipient_id`);--> statement-breakpoint
CREATE INDEX `notification_reminder_invalidation` ON `notifications` (`subject_kind`,`subject_id`,`category`,`recipient_id`,`invalidated_at`);--> statement-breakpoint
CREATE INDEX `event_notification_pending` ON `events` (`notification_pending`,`id`);