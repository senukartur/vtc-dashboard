CREATE TABLE `reconciliation_candidates` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`search_hash` varbinary(32) NOT NULL,
	`primary_trip_id` binary(36) NOT NULL,
	`secondary_trip_id` binary(36) NOT NULL,
	`primary_version` int unsigned NOT NULL,
	`secondary_version` int unsigned NOT NULL,
	`rule_hash` varbinary(32) NOT NULL,
	`evidence` json NOT NULL,
	`reasons` json NOT NULL,
	`active` boolean NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `reconciliation_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_candidate_snapshot` UNIQUE(`primary_trip_id`,`secondary_trip_id`,`primary_version`,`secondary_version`,`rule_hash`,`search_hash`),
	CONSTRAINT `reconciliation_candidate_distinct` CHECK(`reconciliation_candidates`.`primary_trip_id` <> `reconciliation_candidates`.`secondary_trip_id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_commands` (
	`actor_id` binary(36) NOT NULL,
	`operation` enum('merge','reverse') NOT NULL,
	`key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `reconciliation_commands_actor_id_operation_key_pk` PRIMARY KEY(`actor_id`,`operation`,`key`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_history` (
	`reconciliation_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`actor_id` binary(36),
	`operation` enum('apply','reverse') NOT NULL,
	`reason` varchar(2048) NOT NULL,
	`snapshot` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `reconciliation_history_reconciliation_id_version_pk` PRIMARY KEY(`reconciliation_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_rules` (
	`hash` varbinary(32) NOT NULL,
	`version` int unsigned,
	`config` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `reconciliation_rules_hash` PRIMARY KEY(`hash`),
	CONSTRAINT `reconciliation_rule_version` UNIQUE(`version`)
);
--> statement-breakpoint
CREATE TABLE `reconciliations` (
	`id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`primary_trip_id` binary(36) NOT NULL,
	`secondary_trip_id` binary(36) NOT NULL,
	`primary_version` int unsigned NOT NULL,
	`secondary_version` int unsigned NOT NULL,
	`state` enum('applied','reversed') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `reconciliations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `trips` ADD `alias_of` binary(36);--> statement-breakpoint
ALTER TABLE `reconciliation_candidates` ADD CONSTRAINT `recon_candidate_owner_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_candidates` ADD CONSTRAINT `reconciliation_candidates_primary_trip_id_trips_id_fk` FOREIGN KEY (`primary_trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_candidates` ADD CONSTRAINT `reconciliation_candidates_secondary_trip_id_trips_id_fk` FOREIGN KEY (`secondary_trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_candidates` ADD CONSTRAINT `reconciliation_candidates_rule_hash_reconciliation_rules_hash_fk` FOREIGN KEY (`rule_hash`) REFERENCES `reconciliation_rules`(`hash`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_commands` ADD CONSTRAINT `reconciliation_commands_actor_id_identity_memberships_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_history` ADD CONSTRAINT `reconciliation_history_reconciliation_id_reconciliations_id_fk` FOREIGN KEY (`reconciliation_id`) REFERENCES `reconciliations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_history` ADD CONSTRAINT `reconciliation_history_actor_id_identity_memberships_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliations` ADD CONSTRAINT `reconciliations_primary_trip_id_trips_id_fk` FOREIGN KEY (`primary_trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliations` ADD CONSTRAINT `reconciliations_secondary_trip_id_trips_id_fk` FOREIGN KEY (`secondary_trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `reconciliation_candidate_owner` ON `reconciliation_candidates` (`owner_id`,`game`,`active`);--> statement-breakpoint
CREATE INDEX `reconciliation_candidate_page` ON `reconciliation_candidates` (`active`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trip_alias_distinct` CHECK (`trips`.`alias_of` IS NULL OR `trips`.`alias_of` <> `trips`.`id`);--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_alias_of_trips_id_fk` FOREIGN KEY (`alias_of`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `trip_group_members` ON `trips` (`alias_of`,`id`);--> statement-breakpoint
CREATE INDEX `trip_match_owner` ON `trips` (`owner_id`,`game`,`alias_of`,`id`);