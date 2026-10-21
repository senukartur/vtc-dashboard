CREATE TABLE `qualification_promotion_reviews` (
	`promotion_id` binary(36) NOT NULL,
	`review_required` boolean NOT NULL,
	`version` int unsigned NOT NULL,
	`checked_revision` int unsigned NOT NULL,
	`checked_at` datetime(3) NOT NULL,
	CONSTRAINT `qualification_promotion_reviews_promotion_id` PRIMARY KEY(`promotion_id`),
	CONSTRAINT `qual_review_versions_positive` CHECK(`qualification_promotion_reviews`.`version` > 0 AND `qualification_promotion_reviews`.`checked_revision` > 0)
);
--> statement-breakpoint
CREATE TABLE `qualification_assignments` (
	`id` binary(36) NOT NULL,
	`user_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`level_id` binary(36) NOT NULL,
	`assigned_at` datetime(3) NOT NULL,
	`ended_at` datetime(3),
	`revision` int unsigned NOT NULL DEFAULT 1,
	`purpose` enum('initial','reinstatement','historical_resolution','administrative_correction','promotion') NOT NULL,
	`actor_id` binary(36),
	`reason` varchar(2048) NOT NULL,
	CONSTRAINT `qualification_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `qual_assignment_revision_positive` CHECK(`qualification_assignments`.`revision` > 0),
	CONSTRAINT `qualification_period_interval` CHECK(`qualification_assignments`.`ended_at` IS NULL OR `qualification_assignments`.`ended_at` >= `qualification_assignments`.`assigned_at`)
);
--> statement-breakpoint
CREATE TABLE `qualification_levels` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` enum('trainee','driver_iii','driver_ii','driver_i') NOT NULL,
	`name` varchar(128) NOT NULL,
	`version` int unsigned NOT NULL,
	CONSTRAINT `qualification_levels_id` PRIMARY KEY(`id`),
	CONSTRAINT `qualification_level_code` UNIQUE(`game`,`code`),
	CONSTRAINT `qual_level_version_positive` CHECK(`qualification_levels`.`version` > 0)
);
--> statement-breakpoint
CREATE TABLE `qualification_promotions` (
	`id` binary(36) NOT NULL,
	`source_assignment_id` binary(36) NOT NULL,
	`target_assignment_id` binary(36) NOT NULL,
	`rule_version_id` binary(36) NOT NULL,
	`required_trips` int unsigned NOT NULL,
	`required_distance_m` decimal(38,18) NOT NULL,
	`accepted_trips` int unsigned NOT NULL,
	`actual_distance_m` decimal(65,18) NOT NULL,
	`period_revision` int unsigned NOT NULL,
	`confirmed_at` datetime(3) NOT NULL,
	`actor_id` binary(36) NOT NULL,
	`reason` varchar(2048) NOT NULL,
	CONSTRAINT `qualification_promotions_id` PRIMARY KEY(`id`),
	CONSTRAINT `qualification_promotion_once` UNIQUE(`source_assignment_id`)
);
--> statement-breakpoint
CREATE TABLE `qualification_rule_versions` (
	`id` binary(36) NOT NULL,
	`level_id` binary(36) NOT NULL,
	`published_at` datetime(3) NOT NULL,
	`effective_at` datetime(3) NOT NULL,
	`rules` json NOT NULL,
	`required_trips` int unsigned,
	`required_distance_m` decimal(38,18),
	`actor_id` binary(36) NOT NULL,
	`reason` varchar(2048) NOT NULL,
	CONSTRAINT `qualification_rule_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `qualification_rule_effective` UNIQUE(`level_id`,`effective_at`),
	CONSTRAINT `qual_rule_effective_publication` CHECK(`qualification_rule_versions`.`effective_at` >= `qualification_rule_versions`.`published_at`),
	CONSTRAINT `qualification_threshold_distance` CHECK(`qualification_rule_versions`.`required_distance_m` IS NULL OR `qualification_rule_versions`.`required_distance_m` >= 0)
);
--> statement-breakpoint
CREATE TABLE `qualification_states` (
	`user_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`assignment_id` binary(36),
	`version` int unsigned NOT NULL,
	CONSTRAINT `qualification_states_user_id_game_pk` PRIMARY KEY(`user_id`,`game`),
	CONSTRAINT `qual_state_version_positive` CHECK(`qualification_states`.`version` > 0)
);
--> statement-breakpoint
CREATE TABLE `trip_contribution_history` (
	`trip_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`snapshot` json NOT NULL,
	`changed_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_contribution_history_trip_id_version_pk` PRIMARY KEY(`trip_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `trip_contributions` (
	`trip_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`fact_id` binary(36) NOT NULL,
	`accepted` boolean NOT NULL,
	`credited` boolean NOT NULL,
	`alias_of` binary(36),
	`assignment_id` binary(36),
	`rule_version_id` binary(36),
	`attribution_basis` enum('actual_start','manual_confirmation','unresolved') NOT NULL,
	`attribution_at` datetime(3),
	`actual_distance_m` decimal(38,18),
	`fingerprint` varbinary(32) NOT NULL,
	`changed_at` datetime(3) NOT NULL,
	CONSTRAINT `trip_contributions_trip_id` PRIMARY KEY(`trip_id`),
	CONSTRAINT `trip_credit_version_positive` CHECK(`trip_contributions`.`version` > 0),
	CONSTRAINT `trip_credit_alias_distinct` CHECK(`trip_contributions`.`alias_of` IS NULL OR `trip_contributions`.`alias_of` <> `trip_contributions`.`trip_id`),
	CONSTRAINT `trip_credit_shape` CHECK(`trip_contributions`.`credited` = 0 OR (`trip_contributions`.`accepted` = 1 AND `trip_contributions`.`alias_of` IS NULL AND `trip_contributions`.`assignment_id` IS NOT NULL AND `trip_contributions`.`rule_version_id` IS NOT NULL AND `trip_contributions`.`attribution_at` IS NOT NULL AND `trip_contributions`.`actual_distance_m` > 0))
);
--> statement-breakpoint
ALTER TABLE `audit_entries` MODIFY COLUMN `subject_kind` enum('company','user','trip','catalog','application','invitation','qualification') NOT NULL;--> statement-breakpoint
ALTER TABLE `qualification_promotion_reviews` ADD CONSTRAINT `qual_review_promotion_fk` FOREIGN KEY (`promotion_id`) REFERENCES `qualification_promotions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_assignments` ADD CONSTRAINT `qual_assignment_member_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_assignments` ADD CONSTRAINT `qual_assignment_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_assignments` ADD CONSTRAINT `qual_assignment_level_fk` FOREIGN KEY (`level_id`) REFERENCES `qualification_levels`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_promotions` ADD CONSTRAINT `qual_promotion_source_fk` FOREIGN KEY (`source_assignment_id`) REFERENCES `qualification_assignments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_promotions` ADD CONSTRAINT `qual_promotion_target_fk` FOREIGN KEY (`target_assignment_id`) REFERENCES `qualification_assignments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_promotions` ADD CONSTRAINT `qual_promotion_rules_fk` FOREIGN KEY (`rule_version_id`) REFERENCES `qualification_rule_versions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_promotions` ADD CONSTRAINT `qual_promotion_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_rule_versions` ADD CONSTRAINT `qual_rule_level_fk` FOREIGN KEY (`level_id`) REFERENCES `qualification_levels`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_rule_versions` ADD CONSTRAINT `qual_rule_actor_fk` FOREIGN KEY (`actor_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_states` ADD CONSTRAINT `qual_state_member_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_states` ADD CONSTRAINT `qual_state_assignment_fk` FOREIGN KEY (`assignment_id`) REFERENCES `qualification_assignments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contribution_history` ADD CONSTRAINT `trip_contribution_history_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contributions` ADD CONSTRAINT `trip_contributions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contributions` ADD CONSTRAINT `trip_contributions_owner_id_identity_memberships_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contributions` ADD CONSTRAINT `trip_contributions_fact_id_trip_facts_id_fk` FOREIGN KEY (`fact_id`) REFERENCES `trip_facts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contributions` ADD CONSTRAINT `trip_contributions_alias_of_trips_id_fk` FOREIGN KEY (`alias_of`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contributions` ADD CONSTRAINT `trip_credit_assignment_fk` FOREIGN KEY (`assignment_id`) REFERENCES `qualification_assignments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_contributions` ADD CONSTRAINT `trip_credit_rules_fk` FOREIGN KEY (`rule_version_id`) REFERENCES `qualification_rule_versions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `qualification_assignment_history` ON `qualification_assignments` (`user_id`,`game`,`assigned_at`,`id`);--> statement-breakpoint
CREATE INDEX `trip_contribution_period` ON `trip_contributions` (`assignment_id`,`credited`,`trip_id`);
--> statement-breakpoint
INSERT INTO qualification_levels (id,game,code,name,version) VALUES
('02800000-0000-4000-8000-000000000001','ets2','trainee','Trainee',1),
('02800000-0000-4000-8000-000000000002','ets2','driver_iii','Driver III',1),
('02800000-0000-4000-8000-000000000003','ets2','driver_ii','Driver II',1),
('02800000-0000-4000-8000-000000000004','ets2','driver_i','Driver I',1),
('02800000-0000-4000-8000-000000000005','ats','trainee','Trainee',1),
('02800000-0000-4000-8000-000000000006','ats','driver_iii','Driver III',1),
('02800000-0000-4000-8000-000000000007','ats','driver_ii','Driver II',1),
('02800000-0000-4000-8000-000000000008','ats','driver_i','Driver I',1);
--> statement-breakpoint
-- Preserve exact onboarding identity/time only where membership is currently active.
-- Inactive legacy evidence has no known departure instant and remains unresolved.
INSERT INTO qualification_assignments (id,user_id,game,level_id,assigned_at,ended_at,revision,purpose,actor_id,reason)
SELECT q.id,q.user_id,q.game,l.id,q.assigned_at,NULL,1,'initial',NULL,'Preserved admission initial assignment'
FROM qualification_initial_assignments q
JOIN identity_memberships m ON m.user_id=q.user_id AND m.status='active'
JOIN qualification_levels l ON l.game=q.game AND l.code='trainee';
--> statement-breakpoint
INSERT INTO qualification_states (user_id,game,assignment_id,version)
SELECT user_id,game,id,1 FROM qualification_assignments;
