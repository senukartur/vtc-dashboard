CREATE TABLE `trip_owner_revisions` (
	`owner_id` binary(36) NOT NULL,
	`revision` bigint unsigned NOT NULL,
	CONSTRAINT `trip_owner_revisions_owner_id` PRIMARY KEY(`owner_id`)
);
--> statement-breakpoint
ALTER TABLE `telemetry_tokens` ADD `companion` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trip_owner_revisions` ADD CONSTRAINT `trip_owner_revisions_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;