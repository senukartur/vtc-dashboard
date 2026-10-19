CREATE TABLE `durable_jobs` (
	`id` binary(36) NOT NULL,
	`kind` varbinary(64) NOT NULL,
	`schema_version` int NOT NULL,
	`consumer` varbinary(64) NOT NULL,
	`effect_key` varbinary(128) NOT NULL,
	`event_id` binary(36),
	`reference` json NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`state` enum('ready','running','completed','failed') NOT NULL,
	`available_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL,
	`max_attempts` int NOT NULL,
	`lease_token` binary(36),
	`lease_until` datetime(3),
	`failure` enum('retryable','exhausted','missing_handler','invalid_input','external_ambiguity','handler_failed'),
	`created_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	CONSTRAINT `durable_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_effect_unique` UNIQUE(`consumer`,`effect_key`),
	CONSTRAINT `jobs_event_consumer_unique` UNIQUE(`event_id`,`consumer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `job_effect_receipts` (
	`consumer` varbinary(64) NOT NULL,
	`effect_key` varbinary(128) NOT NULL,
	`job_id` binary(36) NOT NULL,
	`committed_at` datetime(3) NOT NULL,
	CONSTRAINT `job_effect_receipts_consumer_effect_key_pk` PRIMARY KEY(`consumer`,`effect_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` binary(36) NOT NULL,
	`type` varbinary(64) NOT NULL,
	`schema_version` int NOT NULL,
	`aggregate_kind` varbinary(32) NOT NULL,
	`aggregate_id` binary(36) NOT NULL,
	`aggregate_version` int NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`correlation_id` binary(36) NOT NULL,
	`causation_id` binary(36),
	`data` json NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `job_runner_leases` (
	`name` varbinary(64) NOT NULL,
	`token` binary(36) NOT NULL,
	`lease_until` datetime(3) NOT NULL,
	CONSTRAINT `job_runner_leases_name` PRIMARY KEY(`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `durable_jobs` ADD CONSTRAINT `durable_jobs_event_id_outbox_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `outbox_events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_effect_receipts` ADD CONSTRAINT `job_effect_receipts_job_id_durable_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `durable_jobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `jobs_ready_idx` ON `durable_jobs` (`state`,`available_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_expired_idx` ON `durable_jobs` (`state`,`lease_until`,`id`);--> statement-breakpoint
CREATE INDEX `outbox_recorded_idx` ON `outbox_events` (`recorded_at`,`id`);