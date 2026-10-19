CREATE TABLE `external_steam_accounts` (
	`steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` binary(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `external_steam_accounts_steam_id` PRIMARY KEY(`steam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `external_steam_changes` (
	`id` binary(36) NOT NULL,
	`user_id` binary(36) NOT NULL,
	`proof_id` binary(36) NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`previous_steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin,
	`steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`version` int unsigned NOT NULL,
	`identity_epoch` int unsigned NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	CONSTRAINT `external_steam_changes_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_change_proof_unique` UNIQUE(`proof_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `external_steam_links` (
	`user_id` binary(36) NOT NULL,
	`steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	CONSTRAINT `external_steam_links_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `external_current_steam_unique` UNIQUE(`steam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `external_steam_nonces` (
	`hash` varbinary(32) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `external_steam_nonces_hash` PRIMARY KEY(`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `external_steam_proofs` (
	`id` binary(36) NOT NULL,
	`user_id` binary(36) NOT NULL,
	`session_id` binary(36) NOT NULL,
	`purpose` enum('initial','replacement') NOT NULL,
	`state` enum('pending','verified','failed','applied','invalidated') NOT NULL,
	`identity_epoch` int unsigned NOT NULL,
	`access_epoch` int unsigned NOT NULL,
	`credential_epoch` int unsigned NOT NULL,
	`email_epoch` int unsigned NOT NULL,
	`previous_steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin,
	`candidate_steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`verified_at` datetime(3),
	CONSTRAINT `external_steam_proofs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `external_truckers_cache` (
	`user_id` binary(36) NOT NULL,
	`steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`identity_epoch` int unsigned NOT NULL,
	`generation` int unsigned NOT NULL,
	`lease_id` binary(36),
	`lease_until` datetime(3),
	`found` boolean,
	`profile` json,
	`checked_at` datetime(3),
	`last_attempt_at` datetime(3),
	`failure` enum('transport','timeout','rate_limited','unavailable','invalid_response'),
	CONSTRAINT `external_truckers_cache_user_id` PRIMARY KEY(`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `external_steam_accounts` ADD CONSTRAINT `external_steam_accounts_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_changes` ADD CONSTRAINT `external_steam_changes_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_changes` ADD CONSTRAINT `external_steam_changes_proof_id_external_steam_proofs_id_fk` FOREIGN KEY (`proof_id`) REFERENCES `external_steam_proofs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_changes` ADD CONSTRAINT `external_steam_changes_actor_id_identity_memberships_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_changes` ADD CONSTRAINT `external_change_old_steam_fk` FOREIGN KEY (`previous_steam_id`) REFERENCES `external_steam_accounts`(`steam_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_changes` ADD CONSTRAINT `external_change_new_steam_fk` FOREIGN KEY (`steam_id`) REFERENCES `external_steam_accounts`(`steam_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_links` ADD CONSTRAINT `external_steam_links_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_links` ADD CONSTRAINT `external_link_steam_fk` FOREIGN KEY (`steam_id`) REFERENCES `external_steam_accounts`(`steam_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_steam_proofs` ADD CONSTRAINT `external_steam_proofs_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_truckers_cache` ADD CONSTRAINT `external_truckers_cache_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `external_truckers_cache` ADD CONSTRAINT `external_cache_steam_fk` FOREIGN KEY (`steam_id`) REFERENCES `external_steam_accounts`(`steam_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `external_change_member` ON `external_steam_changes` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `external_nonce_expiry` ON `external_steam_nonces` (`expires_at`);--> statement-breakpoint
CREATE INDEX `external_proof_member_page` ON `external_steam_proofs` (`user_id`,`purpose`,`id`);--> statement-breakpoint
CREATE INDEX `external_proof_active` ON `external_steam_proofs` (`user_id`,`identity_epoch`,`state`,`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `external_proof_expiry` ON `external_steam_proofs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `external_cache_lease` ON `external_truckers_cache` (`lease_until`);
