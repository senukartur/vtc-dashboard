CREATE TABLE `identity_accounts` (
	`id` binary(36) NOT NULL,
	`account_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
	`provider_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
	`user_id` binary(36) NOT NULL,
	`password` text,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` datetime(3),
	`refresh_token_expires_at` datetime(3),
	`scope` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `identity_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `identity_provider_account_unique` UNIQUE(`provider_id`,`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_challenges` (
	`id` binary(36) NOT NULL,
	`user_id` binary(36) NOT NULL,
	`purpose` enum('email_verification','password_reset','password_change','email_change','succession') NOT NULL,
	`successor_id` binary(36),
	`proposed_email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
	`email_epoch` int unsigned NOT NULL,
	`access_epoch` int unsigned NOT NULL,
	`credential_epoch` int unsigned NOT NULL,
	`secret_hash` varbinary(32) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`attempts` int unsigned NOT NULL DEFAULT 0,
	`consumed` boolean NOT NULL DEFAULT false,
	CONSTRAINT `identity_challenges_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_command_results` (
	`scope_hash` varbinary(32) NOT NULL,
	`command_key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `identity_command_results_scope_hash_command_key_pk` PRIMARY KEY(`scope_hash`,`command_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_company` (
	`singleton` int NOT NULL,
	`id` binary(36) NOT NULL,
	`director_user_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	CONSTRAINT `identity_company_singleton` PRIMARY KEY(`singleton`),
	CONSTRAINT `identity_company_id_unique` UNIQUE(`id`),
	CONSTRAINT `identity_one_company` CHECK(`identity_company`.`singleton` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_limits` (
	`bucket` varchar(32) NOT NULL,
	`window` int unsigned NOT NULL,
	`count` int unsigned NOT NULL,
	CONSTRAINT `identity_limits_bucket` PRIMARY KEY(`bucket`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_memberships` (
	`user_id` binary(36) NOT NULL,
	`status` enum('active','inactive') NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`access_epoch` int unsigned NOT NULL DEFAULT 1,
	`identity_epoch` int unsigned NOT NULL DEFAULT 1,
	`credential_epoch` int unsigned NOT NULL DEFAULT 1,
	`email_epoch` int unsigned NOT NULL DEFAULT 1,
	`locale` enum('en','ru') NOT NULL DEFAULT 'en',
	`display_timezone` varchar(128) NOT NULL DEFAULT 'UTC',
	CONSTRAINT `identity_memberships_user_id` PRIMARY KEY(`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_roles` (
	`user_id` binary(36) NOT NULL,
	`role` enum('trainee','driver','dispatcher','deputy_director') NOT NULL,
	CONSTRAINT `identity_roles_user_id_role_pk` PRIMARY KEY(`user_id`,`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_sessions` (
	`id` binary(36) NOT NULL,
	`token` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
	`user_id` binary(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`access_epoch` int unsigned NOT NULL DEFAULT 0,
	`credential_epoch` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `identity_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `identity_sessions_token_unique` UNIQUE(`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_users` (
	`id` binary(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `identity_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `identity_email_unique` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `identity_verifications` (
	`id` binary(36) NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `identity_verifications_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `identity_accounts` ADD CONSTRAINT `identity_accounts_user_id_identity_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identity_challenges` ADD CONSTRAINT `identity_challenges_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identity_challenges` ADD CONSTRAINT `identity_challenges_successor_id_identity_memberships_user_id_fk` FOREIGN KEY (`successor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identity_company` ADD CONSTRAINT `identity_company_director_fk` FOREIGN KEY (`director_user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identity_memberships` ADD CONSTRAINT `identity_memberships_user_id_identity_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identity_roles` ADD CONSTRAINT `identity_roles_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identity_sessions` ADD CONSTRAINT `identity_sessions_user_id_identity_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `identity_account_user` ON `identity_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `identity_challenge_member_purpose` ON `identity_challenges` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `identity_result_expiry` ON `identity_command_results` (`expires_at`);--> statement-breakpoint
CREATE INDEX `identity_session_user` ON `identity_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `identity_session_expiry` ON `identity_sessions` (`expires_at`);