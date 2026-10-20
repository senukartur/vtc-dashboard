CREATE TABLE `source_messages` (
	`id` binary(36) NOT NULL,
	`source_trip_id` binary(36) NOT NULL,
	`provider` enum('ets2telemetry','manual') NOT NULL,
	`event_key` varbinary(36) NOT NULL,
	`revision` varchar(16) NOT NULL,
	`sha256` varbinary(32) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`delivery_mode` enum('live','backfill','manual') NOT NULL,
	CONSTRAINT `source_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_event_identity` UNIQUE(`provider`,`event_key`),
	CONSTRAINT `source_revision_identity` UNIQUE(`source_trip_id`,`revision`)
);
--> statement-breakpoint
CREATE TABLE `source_payloads` (
	`message_id` binary(36) NOT NULL,
	`content` mediumtext,
	`eligible_at` datetime(3),
	`policy_reference` varchar(128),
	`hold` boolean NOT NULL DEFAULT false,
	`expired_at` datetime(3),
	CONSTRAINT `source_payloads_message_id` PRIMARY KEY(`message_id`)
);
--> statement-breakpoint
CREATE TABLE `source_trips` (
	`id` binary(36) NOT NULL,
	`provider` enum('ets2telemetry','manual') NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`session_key` varbinary(36) NOT NULL,
	`trip_key` varbinary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`canonical_trip_id` binary(36) NOT NULL,
	`latest_revision` varchar(16) NOT NULL,
	`connection_context` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `source_trips_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_permanent_identity` UNIQUE(`provider`,`game`,`session_key`,`trip_key`)
);
--> statement-breakpoint
CREATE TABLE `trip_fact_trailers` (
	`trip_fact_id` binary(36) NOT NULL,
	`position` int unsigned NOT NULL,
	`catalog_revision_id` binary(36),
	`entity_id` binary(36),
	`catalog_fact_id` binary(36),
	`source_field` varchar(128),
	`unknown_reason` varchar(128),
	CONSTRAINT `trip_fact_trailers_trip_fact_id_position_pk` PRIMARY KEY(`trip_fact_id`,`position`),
	CONSTRAINT `trip_trailer_position` CHECK(`trip_fact_trailers`.`position` < 10),
	CONSTRAINT `trip_trailer_shape` CHECK((`trip_fact_trailers`.`entity_id` IS NULL AND `trip_fact_trailers`.`catalog_fact_id` IS NULL AND `trip_fact_trailers`.`catalog_revision_id` IS NULL AND `trip_fact_trailers`.`source_field` IS NULL AND `trip_fact_trailers`.`unknown_reason` IS NOT NULL) OR (`trip_fact_trailers`.`entity_id` IS NOT NULL AND `trip_fact_trailers`.`catalog_fact_id` IS NOT NULL AND `trip_fact_trailers`.`catalog_revision_id` IS NOT NULL AND `trip_fact_trailers`.`source_field` IS NOT NULL AND `trip_fact_trailers`.`unknown_reason` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `trip_facts` (
	`id` binary(36) NOT NULL,
	`message_id` binary(36) NOT NULL,
	`canonical_trip_id` binary(36) NOT NULL,
	`adapter_version` int unsigned NOT NULL,
	`catalog_revision_id` binary(36),
	`outcome` enum('open','delivered','cancelled','none') NOT NULL,
	`recording` enum('complete','partial','unknown') NOT NULL,
	`start_utc` datetime(3),
	`start_basis` enum('event','checkpoint','last-known','receipt','unknown') NOT NULL,
	`start_verified` boolean NOT NULL,
	`end_utc` datetime(3),
	`end_basis` enum('event','checkpoint','last-known','receipt','unknown') NOT NULL,
	`end_verified` boolean NOT NULL,
	`origin_entity_id` binary(36),
	`origin_fact_id` binary(36),
	`destination_entity_id` binary(36),
	`destination_fact_id` binary(36),
	`cargo_entity_id` binary(36),
	`cargo_fact_id` binary(36),
	`adr_entity_id` binary(36),
	`adr_fact_id` binary(36),
	`cargo_mass_kg` decimal(38,18),
	`actual_distance_m` decimal(38,18),
	`measured_segment_m` decimal(38,18),
	`planned_distance_m` decimal(38,18),
	`delivered_distance_m` decimal(38,18),
	`fuel_used_l` decimal(38,18),
	`cargo_damage_fraction` decimal(38,18),
	`whole_trip_distance_supported` boolean NOT NULL,
	`trailers_complete` boolean NOT NULL,
	`trailer_count` int unsigned NOT NULL,
	`rule_context_complete` boolean NOT NULL,
	`reasons` json NOT NULL,
	`evidence` json NOT NULL,
	CONSTRAINT `trip_facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_fact_message` UNIQUE(`message_id`),
	CONSTRAINT `trip_fact_catalog_scope` UNIQUE(`id`,`catalog_revision_id`),
	CONSTRAINT `trip_fact_trailer_count` CHECK(`trip_facts`.`trailer_count` <= 10),
	CONSTRAINT `trip_fact_origin_shape` CHECK((`trip_facts`.`origin_entity_id` IS NULL AND `trip_facts`.`origin_fact_id` IS NULL) OR (`trip_facts`.`origin_entity_id` IS NOT NULL AND `trip_facts`.`origin_fact_id` IS NOT NULL AND `trip_facts`.`catalog_revision_id` IS NOT NULL)),
	CONSTRAINT `trip_fact_destination_shape` CHECK((`trip_facts`.`destination_entity_id` IS NULL AND `trip_facts`.`destination_fact_id` IS NULL) OR (`trip_facts`.`destination_entity_id` IS NOT NULL AND `trip_facts`.`destination_fact_id` IS NOT NULL AND `trip_facts`.`catalog_revision_id` IS NOT NULL)),
	CONSTRAINT `trip_fact_cargo_shape` CHECK((`trip_facts`.`cargo_entity_id` IS NULL AND `trip_facts`.`cargo_fact_id` IS NULL) OR (`trip_facts`.`cargo_entity_id` IS NOT NULL AND `trip_facts`.`cargo_fact_id` IS NOT NULL AND `trip_facts`.`catalog_revision_id` IS NOT NULL)),
	CONSTRAINT `trip_fact_adr_shape` CHECK((`trip_facts`.`adr_entity_id` IS NULL AND `trip_facts`.`adr_fact_id` IS NULL) OR (`trip_facts`.`adr_entity_id` IS NOT NULL AND `trip_facts`.`adr_fact_id` IS NOT NULL AND `trip_facts`.`catalog_revision_id` IS NOT NULL)),
	CONSTRAINT `trip_fact_start_supported` CHECK(`trip_facts`.`start_verified` = 0 OR (`trip_facts`.`start_basis` = 'event' AND `trip_facts`.`start_utc` IS NOT NULL)),
	CONSTRAINT `trip_fact_end_supported` CHECK(`trip_facts`.`end_verified` = 0 OR (`trip_facts`.`end_basis` = 'event' AND `trip_facts`.`end_utc` IS NOT NULL)),
	CONSTRAINT `trip_fact_quantities` CHECK((`trip_facts`.`cargo_mass_kg` IS NULL OR `trip_facts`.`cargo_mass_kg` >= 0) AND (`trip_facts`.`actual_distance_m` IS NULL OR `trip_facts`.`actual_distance_m` >= 0) AND (`trip_facts`.`measured_segment_m` IS NULL OR `trip_facts`.`measured_segment_m` >= 0) AND (`trip_facts`.`planned_distance_m` IS NULL OR `trip_facts`.`planned_distance_m` >= 0) AND (`trip_facts`.`delivered_distance_m` IS NULL OR `trip_facts`.`delivered_distance_m` >= 0) AND (`trip_facts`.`fuel_used_l` IS NULL OR `trip_facts`.`fuel_used_l` >= 0) AND (`trip_facts`.`cargo_damage_fraction` IS NULL OR (`trip_facts`.`cargo_damage_fraction` >= 0 AND `trip_facts`.`cargo_damage_fraction` <= 1)))
);
--> statement-breakpoint
CREATE TABLE `trip_history` (
	`id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`fact_id` binary(36) NOT NULL,
	`outcome` enum('open','delivered','cancelled','none') NOT NULL,
	`reasons` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_history_version` UNIQUE(`trip_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`version` int unsigned NOT NULL,
	`outcome` enum('open','delivered','cancelled','none') NOT NULL,
	`recording` enum('complete','partial','unknown') NOT NULL,
	`decision` enum('unassessed','pending_review','accepted','rejected') NOT NULL,
	`correction_pending` boolean NOT NULL DEFAULT false,
	`current_fact_id` binary(36),
	`actual_start` datetime(3),
	`actual_end` datetime(3),
	`reporting_at` datetime(3),
	`actual_distance_m` decimal(38,18),
	`review_reasons` json NOT NULL,
	`review_hold` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `trips_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_version_positive` CHECK(`trips`.`version` > 0)
);
--> statement-breakpoint
ALTER TABLE `catalog_facts` ADD CONSTRAINT `catalog_fact_pin` UNIQUE(`id`,`revision_id`,`entity_id`);--> statement-breakpoint
ALTER TABLE `source_messages` ADD CONSTRAINT `source_messages_source_trip_id_source_trips_id_fk` FOREIGN KEY (`source_trip_id`) REFERENCES `source_trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_payloads` ADD CONSTRAINT `source_payloads_message_id_source_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `source_messages`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_trips` ADD CONSTRAINT `source_trips_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_trips` ADD CONSTRAINT `source_trips_canonical_trip_id_trips_id_fk` FOREIGN KEY (`canonical_trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_fact_trailers_trip_fact_id_trip_facts_id_fk` FOREIGN KEY (`trip_fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_trailer_pin_fk` FOREIGN KEY (`catalog_fact_id`,`catalog_revision_id`,`entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_trailer_source_catalog_fk` FOREIGN KEY (`trip_fact_id`,`catalog_revision_id`) REFERENCES `trip_facts`(`id`,`catalog_revision_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_facts_message_id_source_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `source_messages`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_facts_canonical_trip_id_trips_id_fk` FOREIGN KEY (`canonical_trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_facts_catalog_revision_id_catalog_revisions_id_fk` FOREIGN KEY (`catalog_revision_id`) REFERENCES `catalog_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_origin_pin_fk` FOREIGN KEY (`origin_fact_id`,`catalog_revision_id`,`origin_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_destination_pin_fk` FOREIGN KEY (`destination_fact_id`,`catalog_revision_id`,`destination_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_cargo_pin_fk` FOREIGN KEY (`cargo_fact_id`,`catalog_revision_id`,`cargo_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_facts` ADD CONSTRAINT `trip_fact_adr_pin_fk` FOREIGN KEY (`adr_fact_id`,`catalog_revision_id`,`adr_entity_id`) REFERENCES `catalog_facts`(`id`,`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_history` ADD CONSTRAINT `trip_history_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_history` ADD CONSTRAINT `trip_history_fact_id_trip_facts_id_fk` FOREIGN KEY (`fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trips` ADD CONSTRAINT `trips_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `source_retention_eligibility` ON `source_payloads` (`eligible_at`,`message_id`);--> statement-breakpoint
CREATE INDEX `source_canonical` ON `source_trips` (`canonical_trip_id`,`id`);--> statement-breakpoint
CREATE INDEX `trip_fact_history` ON `trip_facts` (`canonical_trip_id`,`id`);--> statement-breakpoint
CREATE INDEX `trip_company_page` ON `trips` (`decision`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `trip_owner_page` ON `trips` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `trip_game_page` ON `trips` (`game`,`decision`,`created_at`,`id`);