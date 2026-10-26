ALTER TABLE `identity_company` ADD `reporting_timezone` varchar(128);--> statement-breakpoint
CREATE INDEX `trip_analytics_reporting` ON `trips` (`decision`,`reporting_at`,`game`,`owner_id`);