ALTER TABLE `identity_memberships` MODIFY COLUMN `locale` enum('en','ru') NOT NULL DEFAULT 'ru';--> statement-breakpoint
ALTER TABLE `admissions_applications` MODIFY COLUMN `locale` enum('en','ru') NOT NULL DEFAULT 'ru';
