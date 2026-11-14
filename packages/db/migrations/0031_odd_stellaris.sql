CREATE TABLE `qualification_ladder_history` (
	`audit_id` binary(36) NOT NULL,
	`reason` varchar(2048) NOT NULL,
	CONSTRAINT `qualification_ladder_history_audit_id` PRIMARY KEY(`audit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `qualification_initial_assignments` MODIFY COLUMN `level` enum('trainee');--> statement-breakpoint
ALTER TABLE `qualification_assignments` MODIFY COLUMN `purpose` enum('initial','reinstatement','historical_resolution','administrative_correction','promotion','ladder_archive_transfer') NOT NULL;--> statement-breakpoint
ALTER TABLE `qualification_levels` MODIFY COLUMN `code` enum('trainee','driver_iii','driver_ii','driver_i');--> statement-breakpoint
ALTER TABLE `qualification_initial_assignments` ADD `level_id` binary(36);--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD `active_position` int unsigned;--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD `ladder_revision` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD `promotion_generation` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `qualification_rule_versions` ADD `promotion_generation` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Preserve the original order independently in each game and retain existing evidence.
START TRANSACTION;--> statement-breakpoint
UPDATE qualification_levels
SET active_position = CASE code
  WHEN 'trainee' THEN 1
  WHEN 'driver_iii' THEN 2
  WHEN 'driver_ii' THEN 3
  WHEN 'driver_i' THEN 4
END;--> statement-breakpoint
UPDATE qualification_initial_assignments evidence
LEFT JOIN qualification_assignments assignment
  ON assignment.id = evidence.id AND assignment.user_id = evidence.user_id
  AND assignment.game = evidence.game AND assignment.purpose = 'initial'
LEFT JOIN qualification_levels legacy_level
  ON legacy_level.game = evidence.game AND legacy_level.code = evidence.level
SET evidence.level_id = COALESCE(assignment.level_id, legacy_level.id)
WHERE evidence.level_id IS NULL;--> statement-breakpoint
COMMIT;--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD CONSTRAINT `qualification_level_position` UNIQUE(`game`,`active_position`);--> statement-breakpoint
ALTER TABLE `qualification_ladder_history` ADD CONSTRAINT `qual_ladder_history_audit_fk` FOREIGN KEY (`audit_id`) REFERENCES `audit_entries`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD CONSTRAINT `qual_level_position_range` CHECK (`qualification_levels`.`active_position` IS NULL OR `qualification_levels`.`active_position` BETWEEN 1 AND 25);--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD CONSTRAINT `qual_level_revisions_positive` CHECK (`qualification_levels`.`ladder_revision` > 0 AND `qualification_levels`.`promotion_generation` > 0);--> statement-breakpoint
ALTER TABLE `qualification_initial_assignments` ADD CONSTRAINT `qual_initial_level_fk` FOREIGN KEY (`level_id`) REFERENCES `qualification_levels`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `qualification_state_game_members` ON `qualification_states` (`game`,`user_id`,`assignment_id`);