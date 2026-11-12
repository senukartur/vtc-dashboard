ALTER TABLE `trips` ADD COLUMN `number` int unsigned NULL;
--> statement-breakpoint
UPDATE `trips` AS target
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `id`) AS assigned_number
  FROM `trips`
) AS ranked ON ranked.`id` = target.`id`
SET target.`number` = ranked.assigned_number;
--> statement-breakpoint
ALTER TABLE `trips`
  MODIFY COLUMN `number` int unsigned NOT NULL AUTO_INCREMENT,
  ADD UNIQUE INDEX `trip_number_unique` (`number`),
  ADD INDEX `trip_owner_reporting` (`owner_id`,`reporting_at`,`id`);
