ALTER TABLE `qualification_promotions`
  MODIFY COLUMN `required_trips` int unsigned NULL,
  MODIFY COLUMN `required_distance_m` decimal(38,18) NULL;
--> statement-breakpoint
ALTER TABLE `qualification_rule_versions` MODIFY COLUMN `reason` varchar(2048) NULL;
