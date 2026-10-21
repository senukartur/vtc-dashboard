CREATE TABLE `telemetry_commands` (
	`owner_id` binary(36) NOT NULL,
	`command_key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`token_id` binary(36) NOT NULL,
	CONSTRAINT `telemetry_commands_owner_id_command_key_pk` PRIMARY KEY(`owner_id`,`command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `telemetry_installations` (
	`id` binary(36) NOT NULL,
	`binding_id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`company_id` binary(36) NOT NULL,
	`identity_epoch` int unsigned NOT NULL,
	`client_id` varbinary(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `telemetry_installations_id` PRIMARY KEY(`id`),
	CONSTRAINT `telemetry_installations_binding_id_unique` UNIQUE(`binding_id`),
	CONSTRAINT `telemetry_registration_unique` UNIQUE(`owner_id`,`company_id`,`identity_epoch`,`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `telemetry_limits` (
	`bucket_key` varbinary(64) NOT NULL,
	`credits` int unsigned NOT NULL,
	`updated_ms` varbinary(16) NOT NULL,
	CONSTRAINT `telemetry_limits_bucket_key` PRIMARY KEY(`bucket_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `telemetry_tokens` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`company_id` binary(36) NOT NULL,
	`steam_id` varbinary(17) NOT NULL,
	`access_epoch` int unsigned NOT NULL,
	`identity_epoch` int unsigned NOT NULL,
	`credential_epoch` int unsigned NOT NULL,
	`secret_hash` varbinary(32) NOT NULL,
	`scope` enum('ingest') NOT NULL,
	`label` varchar(128) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `telemetry_tokens_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `telemetry_commands` ADD CONSTRAINT `telemetry_commands_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telemetry_commands` ADD CONSTRAINT `telemetry_commands_token_id_telemetry_tokens_id_fk` FOREIGN KEY (`token_id`) REFERENCES `telemetry_tokens`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telemetry_installations` ADD CONSTRAINT `telemetry_installations_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telemetry_installations` ADD CONSTRAINT `telemetry_installations_company_id_identity_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `identity_company`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telemetry_tokens` ADD CONSTRAINT `telemetry_tokens_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telemetry_tokens` ADD CONSTRAINT `telemetry_tokens_company_id_identity_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `identity_company`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `telemetry_token_owner_page` ON `telemetry_tokens` (`owner_id`,`created_at`,`id`);