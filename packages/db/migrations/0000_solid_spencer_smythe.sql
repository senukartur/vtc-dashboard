CREATE TABLE `audit_entries` (
	`id` binary(36) NOT NULL,
	`actor_kind` enum('user','system') NOT NULL,
	`actor_id` binary(36),
	`operation` varchar(48) NOT NULL,
	`subject_kind` enum('company','user','trip','catalog') NOT NULL,
	`subject_id` binary(36) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`reason` varchar(32) NOT NULL,
	`company_id` binary(36),
	CONSTRAINT `audit_entries_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE INDEX `audit_subject_time_idx` ON `audit_entries` (`subject_kind`,`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_time_idx` ON `audit_entries` (`actor_id`,`occurred_at`);
