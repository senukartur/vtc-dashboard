CREATE TABLE `mail_commands` (
	`command_key` binary(36) NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`delivery_id` binary(36) NOT NULL,
	`expected_version` int NOT NULL,
	`result_version` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `mail_command_actor_unique` UNIQUE(`actor_id`,`command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `mail_deliveries` (
	`id` binary(36) NOT NULL,
	`owner` enum('identity','admissions') NOT NULL,
	`generation_id` binary(36) NOT NULL,
	`user_id` binary(36),
	`kind` enum('email_verification','password_reset','password_change','email_change','succession','invitation','rejection') NOT NULL,
	`locale` enum('en','ru') NOT NULL,
	`mode` enum('local','resend') NOT NULL,
	`template_version` int NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`ciphertext` mediumtext,
	`state` enum('queued','attempting','retryable','accepted','simulated','suppressed','failed','ambiguous') NOT NULL,
	`category` varchar(32),
	`version` int NOT NULL,
	`attempts` int NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`first_attempt_at` datetime(3),
	`next_attempt_at` datetime(3),
	`receipt` varchar(128),
	CONSTRAINT `mail_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `mail_generation_unique` UNIQUE(`owner`,`generation_id`,`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `mail_commands` ADD CONSTRAINT `mail_commands_delivery_id_mail_deliveries_id_fk` FOREIGN KEY (`delivery_id`) REFERENCES `mail_deliveries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `mail_command_expiry_idx` ON `mail_commands` (`created_at`);--> statement-breakpoint
CREATE INDEX `mail_user_idx` ON `mail_deliveries` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `mail_expiry_idx` ON `mail_deliveries` (`expires_at`,`id`);