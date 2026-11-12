CREATE TABLE `event_draft_dlcs` (
	`event_id` binary(36) NOT NULL,
	`dlc_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	CONSTRAINT `event_draft_dlcs_event_id_dlc_id_pk` PRIMARY KEY(`event_id`,`dlc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_drafts` (
	`event_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`updated_by` binary(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`discarded_at` datetime(3),
	`title` varchar(256),
	`description` text,
	`game` enum('ets2','ats'),
	`server` varchar(256),
	`organizer` varchar(256),
	`meeting_location` varchar(2048),
	`route` varchar(2048),
	`meeting_at` datetime(3),
	`starts_at` datetime(3),
	`ends_at` datetime(3),
	`visibility` enum('public','members'),
	`origin_city_id` binary(36),
	`destination_city_id` binary(36),
	`prescribed_cargo_id` binary(36),
	`prescribed_trailer_type_id` binary(36),
	`prescribed_mass_kg` decimal(38,18),
	`platform` enum('truckersmp','haulmp'),
	`organizer_member_id` binary(36),
	`origin_depot_id` binary(36),
	`destination_depot_id` binary(36),
	`distance_km` decimal(38,18),
	CONSTRAINT `event_drafts_event_id` PRIMARY KEY(`event_id`),
	CONSTRAINT `event_draft_id_game` UNIQUE(`event_id`,`game`),
	CONSTRAINT `event_draft_version_positive` CHECK(`event_drafts`.`version`>0),
	CONSTRAINT `event_draft_distance_nonnegative` CHECK(`event_drafts`.`distance_km` IS NULL OR `event_drafts`.`distance_km`>=0),
	CONSTRAINT `event_draft_mass_nonnegative` CHECK(`event_drafts`.`prescribed_mass_kg` IS NULL OR `event_drafts`.`prescribed_mass_kg`>=0),
	CONSTRAINT `event_draft_catalog_game` CHECK(`event_drafts`.`game` IS NOT NULL OR (
      `event_drafts`.`origin_city_id` IS NULL AND `event_drafts`.`destination_city_id` IS NULL
      AND `event_drafts`.`origin_depot_id` IS NULL AND `event_drafts`.`destination_depot_id` IS NULL
      AND `event_drafts`.`prescribed_cargo_id` IS NULL AND `event_drafts`.`prescribed_trailer_type_id` IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_media` (
	`id` binary(36) NOT NULL,
	`event_id` binary(36) NOT NULL,
	`uploader_id` binary(36) NOT NULL,
	`upload_key` binary(36) NOT NULL,
	`state` enum('processing','ready','rejected','deleting','deleted') NOT NULL,
	`generation` binary(36) NOT NULL,
	`original_name` varchar(256) NOT NULL,
	`content_type` enum('image/png','image/jpeg') NOT NULL,
	`byte_length` int unsigned NOT NULL DEFAULT 0,
	`width` int unsigned,
	`height` int unsigned,
	`sha256` varbinary(32),
	`fingerprint` varbinary(32),
	`caption` varchar(2048),
	`position` int unsigned,
	`is_cover` boolean NOT NULL DEFAULT false,
	`cover_event_id` binary(36) GENERATED ALWAYS AS (CASE WHEN is_cover THEN event_id ELSE NULL END) VIRTUAL,
	`lease_token` binary(36),
	`lease_until` datetime(3),
	`next_check_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `event_media_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_media_upload` UNIQUE(`event_id`,`uploader_id`,`upload_key`),
	CONSTRAINT `event_media_one_cover` UNIQUE(`cover_event_id`),
	CONSTRAINT `event_media_ready_shape` CHECK(`event_media`.`state`<>'ready' OR (
      `event_media`.`sha256` IS NOT NULL AND `event_media`.`fingerprint` IS NOT NULL AND `event_media`.`byte_length`>0
      AND `event_media`.`width` IS NOT NULL AND `event_media`.`width`>0 AND `event_media`.`height` IS NOT NULL AND `event_media`.`height`>0
      AND `event_media`.`position` IS NOT NULL)),
	CONSTRAINT `event_media_cover_ready` CHECK(NOT `event_media`.`is_cover` OR `event_media`.`state`='ready'),
	CONSTRAINT `event_media_position_range` CHECK(`event_media`.`position` IS NULL OR `event_media`.`position`<10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_media_generations` (
	`media_id` binary(36) NOT NULL,
	`generation` binary(36) NOT NULL,
	`state` enum('tracked','deleting') NOT NULL DEFAULT 'tracked',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`lease_until` datetime(3) NOT NULL,
	`next_check_at` datetime(3) NOT NULL,
	`delete_attempt` int unsigned NOT NULL DEFAULT 0,
	`deletion_job_id` binary(36),
	CONSTRAINT `event_media_generations_media_id_generation_pk` PRIMARY KEY(`media_id`,`generation`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_metadata` (
	`id` binary(36) NOT NULL,
	`published_event_id` binary(36),
	`media_version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `event_metadata_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_metadata_published_id` CHECK(`event_metadata`.`published_event_id` IS NULL OR `event_metadata`.`published_event_id`=`event_metadata`.`id`),
	CONSTRAINT `event_media_version_positive` CHECK(`event_metadata`.`media_version`>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_revision_details` (
	`revision_id` binary(36) NOT NULL,
	`platform` enum('truckersmp','haulmp'),
	`organizer_member_id` binary(36),
	`origin_depot_id` binary(36),
	`destination_depot_id` binary(36),
	`distance_km` decimal(38,18),
	CONSTRAINT `event_revision_details_revision_id` PRIMARY KEY(`revision_id`),
	CONSTRAINT `event_revision_distance_nonnegative` CHECK(`event_revision_details`.`distance_km` IS NULL OR `event_revision_details`.`distance_km`>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_revision_dlcs` (
	`revision_id` binary(36) NOT NULL,
	`dlc_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	CONSTRAINT `event_revision_dlcs_revision_id_dlc_id_pk` PRIMARY KEY(`revision_id`,`dlc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `event_stage2_commands` (
	`actor_id` binary(36) NOT NULL,
	`route` enum('draft_create','draft_update','draft_delete','publish','media_edit','media_delete') NOT NULL,
	`target_id` binary(36) NOT NULL,
	`key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	CONSTRAINT `event_stage2_commands_actor_id_route_target_id_key_pk` PRIMARY KEY(`actor_id`,`route`,`target_id`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `event_revisions` MODIFY COLUMN `category` enum('created','updated','cancelled','published') NOT NULL;--> statement-breakpoint
ALTER TABLE `event_draft_dlcs` ADD CONSTRAINT `event_draft_dlc_draft_fk` FOREIGN KEY (`event_id`,`game`) REFERENCES `event_drafts`(`event_id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_draft_dlcs` ADD CONSTRAINT `event_draft_dlc_catalog_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_metadata_fk` FOREIGN KEY (`event_id`) REFERENCES `event_metadata`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_actor_fk` FOREIGN KEY (`updated_by`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_organizer_fk` FOREIGN KEY (`organizer_member_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_origin_depot_fk` FOREIGN KEY (`origin_depot_id`) REFERENCES `catalog_company_cities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_destination_depot_fk` FOREIGN KEY (`destination_depot_id`) REFERENCES `catalog_company_cities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_origin_fk` FOREIGN KEY (`origin_city_id`,`game`) REFERENCES `catalog_cities`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_destination_fk` FOREIGN KEY (`destination_city_id`,`game`) REFERENCES `catalog_cities`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_cargo_fk` FOREIGN KEY (`prescribed_cargo_id`,`game`) REFERENCES `catalog_cargoes`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_trailer_fk` FOREIGN KEY (`prescribed_trailer_type_id`,`game`) REFERENCES `catalog_trailers`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_media` ADD CONSTRAINT `event_media_event_fk` FOREIGN KEY (`event_id`) REFERENCES `event_metadata`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_media` ADD CONSTRAINT `event_media_uploader_fk` FOREIGN KEY (`uploader_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_media_generations` ADD CONSTRAINT `event_media_generation_media_fk` FOREIGN KEY (`media_id`) REFERENCES `event_media`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_metadata` ADD CONSTRAINT `event_metadata_published_fk` FOREIGN KEY (`published_event_id`) REFERENCES `events`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revision_details` ADD CONSTRAINT `event_revision_details_fk` FOREIGN KEY (`revision_id`) REFERENCES `event_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revision_details` ADD CONSTRAINT `event_revision_organizer_fk` FOREIGN KEY (`organizer_member_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revision_details` ADD CONSTRAINT `event_revision_origin_depot_fk` FOREIGN KEY (`origin_depot_id`) REFERENCES `catalog_company_cities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revision_details` ADD CONSTRAINT `event_revision_destination_depot_fk` FOREIGN KEY (`destination_depot_id`) REFERENCES `catalog_company_cities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revision_dlcs` ADD CONSTRAINT `event_revision_dlc_revision_fk` FOREIGN KEY (`revision_id`) REFERENCES `event_revision_details`(`revision_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revision_dlcs` ADD CONSTRAINT `event_revision_dlc_catalog_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_stage2_commands` ADD CONSTRAINT `event_stage2_command_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `event_draft_page` ON `event_drafts` (`discarded_at`,`updated_at`,`event_id`);--> statement-breakpoint
CREATE INDEX `event_media_order` ON `event_media` (`event_id`,`state`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `event_media_due` ON `event_media` (`state`,`next_check_at`,`id`);--> statement-breakpoint
CREATE INDEX `event_media_generation_due` ON `event_media_generations` (`state`,`next_check_at`,`media_id`,`generation`);