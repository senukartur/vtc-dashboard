CREATE TABLE `catalog_aliases` (
	`revision_id` binary(36) NOT NULL,
	`entity_id` binary(36) NOT NULL,
	`locale` enum('en','ru') NOT NULL,
	`normalized` varbinary(512) NOT NULL,
	`region_scope` varbinary(36) NOT NULL,
	CONSTRAINT `catalog_alias_pk` PRIMARY KEY(`revision_id`,`locale`,`normalized`,`region_scope`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_artifacts` (
	`id` binary(36) NOT NULL,
	`creator_id` binary(36) NOT NULL,
	`sha256` varbinary(32) NOT NULL,
	`byte_length` int unsigned NOT NULL,
	`content` mediumtext,
	`expires_at` datetime(3) NOT NULL,
	`payload_expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_artifacts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_changes` (
	`revision_id` binary(36) NOT NULL,
	`entity_id` binary(36) NOT NULL,
	`kind` enum('city','region','cargo','trailer_type','trailer_body_type','trailer_chain_type','adr_category') NOT NULL,
	`change_kind` enum('added','changed','retired') NOT NULL,
	`fields` json NOT NULL,
	`reason_codes` json NOT NULL,
	CONSTRAINT `catalog_changes_revision_id_entity_id_pk` PRIMARY KEY(`revision_id`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_commands` (
	`scope` varbinary(32) NOT NULL,
	`key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_commands_scope_key_pk` PRIMARY KEY(`scope`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_coverage` (
	`revision_id` binary(36) NOT NULL,
	`pack_id` varbinary(512) NOT NULL,
	`title` varchar(256) NOT NULL,
	`state` enum('validated','missing','failed','non_contributing') NOT NULL,
	`contribution_kinds` json NOT NULL,
	`provenance` json NOT NULL,
	`reason_codes` json NOT NULL,
	CONSTRAINT `catalog_coverage_revision_id_pack_id_pk` PRIMARY KEY(`revision_id`,`pack_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_entities` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`kind` enum('city','region','cargo','trailer_type','trailer_body_type','trailer_chain_type','adr_category') NOT NULL,
	`map` varbinary(512) NOT NULL,
	`source_key` varbinary(512) NOT NULL,
	CONSTRAINT `catalog_entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_canonical_identity` UNIQUE(`game`,`kind`,`map`,`source_key`),
	CONSTRAINT `catalog_entity_scope` UNIQUE(`id`,`game`,`kind`,`map`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_facts` (
	`id` binary(36) NOT NULL,
	`revision_id` binary(36) NOT NULL,
	`entity_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`kind` enum('city','region','cargo','trailer_type','trailer_body_type','trailer_chain_type','adr_category') NOT NULL,
	`map` varbinary(512) NOT NULL,
	`retired` boolean NOT NULL,
	`label_en` varchar(256),
	`label_ru` varchar(256),
	`region_id` binary(36),
	`cargo_unit_mass_kg` decimal(38,18),
	`adr_category_id` binary(36),
	`trailer_body_type_id` binary(36),
	`trailer_chain_type_id` binary(36),
	`pack_id` varbinary(512) NOT NULL,
	CONSTRAINT `catalog_facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_revision_entity` UNIQUE(`revision_id`,`entity_id`),
	CONSTRAINT `catalog_fact_scope` UNIQUE(`revision_id`,`entity_id`,`kind`,`map`),
	CONSTRAINT `catalog_typed_values` CHECK((`catalog_facts`.`region_id` IS NULL OR `catalog_facts`.`kind` = 'city') AND (`catalog_facts`.`cargo_unit_mass_kg` IS NULL OR (`catalog_facts`.`kind` = 'cargo' AND `catalog_facts`.`cargo_unit_mass_kg` >= 0)) AND (`catalog_facts`.`adr_category_id` IS NULL OR `catalog_facts`.`kind` = 'cargo') AND ((`catalog_facts`.`trailer_body_type_id` IS NULL AND `catalog_facts`.`trailer_chain_type_id` IS NULL) OR `catalog_facts`.`kind` = 'trailer_type'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_mapping_issues` (
	`id` binary(36) NOT NULL,
	`revision_id` binary(36) NOT NULL,
	`provider` varbinary(512) NOT NULL,
	`kind` enum('city','region','cargo','trailer_type','trailer_body_type','trailer_chain_type','adr_category') NOT NULL,
	`map` varbinary(512) NOT NULL,
	`source_id` varbinary(512),
	`source_locale` enum('en','ru'),
	`reason_code` varchar(128) NOT NULL,
	`candidate_entity_ids` json NOT NULL,
	`resolved` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_mapping_issues_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_mapping_reviews` (
	`id` binary(36) NOT NULL,
	`revision_id` binary(36) NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`reason` text NOT NULL,
	`version` int unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_mapping_reviews_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_mappings` (
	`revision_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`kind` enum('city','region','cargo','trailer_type','trailer_body_type','trailer_chain_type','adr_category') NOT NULL,
	`map` varbinary(512) NOT NULL,
	`provider` varbinary(512) NOT NULL,
	`source_id` varbinary(512) NOT NULL,
	`entity_id` binary(36) NOT NULL,
	CONSTRAINT `catalog_mappings_revision_id_provider_game_kind_map_source_id_pk` PRIMARY KEY(`revision_id`,`provider`,`game`,`kind`,`map`,`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_operations` (
	`id` binary(36) NOT NULL,
	`creator_id` binary(36) NOT NULL,
	`artifact_id` binary(36) NOT NULL,
	`state` enum('processing','completed','failed') NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`result_id` binary(36),
	`failure_code` varchar(128),
	`staging_revision_id` binary(36),
	`phase` enum('identities','facts','links','issues','finalize') NOT NULL,
	`offset` int unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_operations_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_publications` (
	`game` enum('ets2','ats') NOT NULL,
	`version` int unsigned NOT NULL,
	`revision_id` binary(36),
	CONSTRAINT `catalog_publications_game` PRIMARY KEY(`game`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_relations` (
	`revision_id` binary(36) NOT NULL,
	`entity_id` binary(36) NOT NULL,
	`relation` enum('region','adr_category','trailer_body_type','trailer_chain_type') NOT NULL,
	`target_id` binary(36) NOT NULL,
	`target_kind` enum('city','region','cargo','trailer_type','trailer_body_type','trailer_chain_type','adr_category') NOT NULL,
	`map` varbinary(512) NOT NULL,
	CONSTRAINT `catalog_relations_revision_id_entity_id_relation_pk` PRIMARY KEY(`revision_id`,`entity_id`,`relation`),
	CONSTRAINT `catalog_relation_target_kind` CHECK(`catalog_relations`.`relation` = `catalog_relations`.`target_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_revisions` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`version` int unsigned NOT NULL,
	`state` enum('draft','validated','published','rejected') NOT NULL,
	`complete` boolean NOT NULL DEFAULT false,
	`pruned` boolean NOT NULL DEFAULT false,
	`artifact_id` binary(36) NOT NULL,
	`artifact_sha256` varbinary(32) NOT NULL,
	`comparison_revision_id` binary(36),
	`game_build` varchar(128) NOT NULL,
	`inventory_as_of` varchar(10) NOT NULL,
	`synthetic` boolean NOT NULL,
	`source_manifest_sha256` varbinary(32) NOT NULL,
	`provenance` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_revision_game` UNIQUE(`id`,`game`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `catalog_aliases` ADD CONSTRAINT `catalog_alias_fact_fk` FOREIGN KEY (`revision_id`,`entity_id`) REFERENCES `catalog_facts`(`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_changes` ADD CONSTRAINT `catalog_changes_revision_id_catalog_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `catalog_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_coverage` ADD CONSTRAINT `catalog_coverage_revision_id_catalog_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `catalog_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_facts` ADD CONSTRAINT `catalog_fact_revision_game_fk` FOREIGN KEY (`revision_id`,`game`) REFERENCES `catalog_revisions`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_facts` ADD CONSTRAINT `catalog_fact_entity_scope_fk` FOREIGN KEY (`entity_id`,`game`,`kind`,`map`) REFERENCES `catalog_entities`(`id`,`game`,`kind`,`map`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_mapping_issues` ADD CONSTRAINT `catalog_mapping_issues_revision_id_catalog_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `catalog_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_mapping_reviews` ADD CONSTRAINT `catalog_mapping_reviews_revision_id_catalog_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `catalog_revisions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_mappings` ADD CONSTRAINT `catalog_mapping_target_fk` FOREIGN KEY (`revision_id`,`entity_id`,`kind`,`map`) REFERENCES `catalog_facts`(`revision_id`,`entity_id`,`kind`,`map`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_mappings` ADD CONSTRAINT `catalog_mapping_game_fk` FOREIGN KEY (`revision_id`,`game`) REFERENCES `catalog_revisions`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_operations` ADD CONSTRAINT `catalog_operations_artifact_id_catalog_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `catalog_artifacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_publications` ADD CONSTRAINT `catalog_publication_game_fk` FOREIGN KEY (`revision_id`,`game`) REFERENCES `catalog_revisions`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_relations` ADD CONSTRAINT `catalog_relation_owner_fk` FOREIGN KEY (`revision_id`,`entity_id`) REFERENCES `catalog_facts`(`revision_id`,`entity_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_relations` ADD CONSTRAINT `catalog_relation_target_fk` FOREIGN KEY (`revision_id`,`target_id`,`target_kind`,`map`) REFERENCES `catalog_facts`(`revision_id`,`entity_id`,`kind`,`map`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_revisions` ADD CONSTRAINT `catalog_revisions_artifact_id_catalog_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `catalog_artifacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `catalog_artifact_expiry` ON `catalog_artifacts` (`payload_expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `catalog_change_page` ON `catalog_changes` (`revision_id`,`change_kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `catalog_command_expiry` ON `catalog_commands` (`expires_at`);--> statement-breakpoint
CREATE INDEX `catalog_selection_page` ON `catalog_facts` (`revision_id`,`kind`,`retired`,`entity_id`);--> statement-breakpoint
CREATE INDEX `catalog_english_search` ON `catalog_facts` (`revision_id`,`kind`,`label_en`,`entity_id`);--> statement-breakpoint
CREATE INDEX `catalog_issue_page` ON `catalog_mapping_issues` (`revision_id`,`resolved`,`id`);--> statement-breakpoint
CREATE INDEX `catalog_operation_artifact` ON `catalog_operations` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `catalog_operation_state` ON `catalog_operations` (`state`,`id`);--> statement-breakpoint
CREATE INDEX `catalog_revision_page` ON `catalog_revisions` (`game`,`state`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `catalog_incomplete_cleanup` ON `catalog_revisions` (`complete`,`state`,`pruned`,`id`);