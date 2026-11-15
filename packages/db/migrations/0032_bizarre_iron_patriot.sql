-- Each existing table changes in one statement, so a table copy happens at most once per table.
ALTER TABLE `identity_memberships` MODIFY COLUMN `display_timezone` varchar(128) DEFAULT 'UTC', ADD `joined_at` datetime(3) DEFAULT (UTC_TIMESTAMP(3)) NOT NULL;--> statement-breakpoint
ALTER TABLE `admissions_applications` ADD `referral_source` enum('truckersmp','discord','friend_or_member','youtube_or_twitch','other'), ADD `referral_other` varchar(200), ADD CONSTRAINT `admissions_referral_other_requires_other` CHECK (`admissions_applications`.`referral_other` IS NULL OR `admissions_applications`.`referral_source` <=> 'other'), ADD CONSTRAINT `admissions_referral_other_nonblank` CHECK (`admissions_applications`.`referral_other` IS NULL OR REGEXP_LIKE(`admissions_applications`.`referral_other`, '[^[:space:]]'));--> statement-breakpoint
CREATE TABLE `admissions_truckers_checks` (
	`application_id` binary(36) NOT NULL,
	`generation` int unsigned NOT NULL DEFAULT 1,
	`state` enum('checking','completed','not_checked','failed') NOT NULL,
	`steam_id` varchar(17) CHARACTER SET ascii COLLATE ascii_bin,
	`lease_id` binary(36),
	`lease_until` datetime(3),
	`found` boolean,
	`profile` json,
	`requested_at` datetime(3) NOT NULL,
	`checked_at` datetime(3),
	`last_attempt_at` datetime(3),
	`failure` enum('transport','timeout','rate_limited','unavailable','invalid_response'),
	CONSTRAINT `admissions_truckers_checks_application_id` PRIMARY KEY(`application_id`),
	INDEX `admissions_truckers_check_lease` (`lease_until`),
	CONSTRAINT `admissions_truckers_check_application_fk` FOREIGN KEY (`application_id`) REFERENCES `admissions_applications`(`id`) ON DELETE cascade ON UPDATE no action,
	CONSTRAINT `admissions_truckers_check_generation` CHECK(`admissions_truckers_checks`.`generation` > 0),
	CONSTRAINT `admissions_truckers_check_steam` CHECK((`admissions_truckers_checks`.`state` = 'not_checked') = (`admissions_truckers_checks`.`steam_id` IS NULL)),
	CONSTRAINT `admissions_truckers_check_failure` CHECK(`admissions_truckers_checks`.`state` <> 'failed' OR `admissions_truckers_checks`.`failure` IS NOT NULL),
	CONSTRAINT `admissions_truckers_check_completed` CHECK(`admissions_truckers_checks`.`state` <> 'completed' OR (`admissions_truckers_checks`.`found` IS NOT NULL AND `admissions_truckers_checks`.`checked_at` IS NOT NULL)),
	CONSTRAINT `admissions_truckers_check_lease_pair` CHECK((`admissions_truckers_checks`.`lease_id` IS NULL) = (`admissions_truckers_checks`.`lease_until` IS NULL))
);
--> statement-breakpoint
ALTER TABLE `trip_facts` ADD `origin_depot_id` binary(36), ADD `destination_depot_id` binary(36), ADD `origin_company_code` varbinary(128), ADD `destination_company_code` varbinary(128), ADD CONSTRAINT `trip_fact_origin_depot_fk` FOREIGN KEY (`origin_depot_id`) REFERENCES `catalog_company_cities`(`id`) ON DELETE restrict ON UPDATE no action, ADD CONSTRAINT `trip_fact_destination_depot_fk` FOREIGN KEY (`destination_depot_id`) REFERENCES `catalog_company_cities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD `review_queue` boolean DEFAULT true NOT NULL, ADD `new_applications` boolean DEFAULT true NOT NULL, ADD `trip_accepted` boolean DEFAULT true NOT NULL, ADD `new_event` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `trip_owner_accepted_reporting` ON `trips` (`owner_id`,`decision`,`alias_of`,`reporting_at`,`actual_distance_m`);
--> statement-breakpoint
-- Stage 4 backfill: drain writers throughout. Both updates are deterministic and idempotent.
START TRANSACTION;
--> statement-breakpoint
-- memberSince is the latest join or return, never earlier than registration. An audited
-- inactive-to-active membership change is authoritative. A reinstatement assignment is legacy
-- evidence only when a membership change for the same user was audited within one second of
-- it (details may be null); a general assignment with that purpose to an active member is not
-- a return.
UPDATE `identity_memberships` AS m
JOIN `identity_users` AS u ON u.`id` = m.`user_id`
LEFT JOIN (
  SELECT a.`user_id`, MAX(a.`assigned_at`) AS `returned_at`
  FROM `qualification_assignments` AS a
  WHERE a.`purpose` = 'reinstatement'
    AND EXISTS (
      SELECT 1
      FROM `audit_entries` AS r
      WHERE r.`subject_kind` = 'user'
        AND r.`subject_id` = a.`user_id`
        AND r.`operation` = 'membership.changed'
        AND r.`occurred_at` BETWEEN a.`assigned_at` AND a.`assigned_at` + INTERVAL 1 SECOND
    )
  GROUP BY a.`user_id`
) AS assigned ON assigned.`user_id` = m.`user_id`
LEFT JOIN (
  SELECT e.`subject_id` AS `user_id`, MAX(e.`occurred_at`) AS `returned_at`
  FROM `audit_entries` AS e
  WHERE e.`subject_kind` = 'user'
    AND e.`operation` = 'membership.changed'
    AND JSON_UNQUOTE(JSON_EXTRACT(e.`details`, '$.before.status')) = 'inactive'
    AND JSON_UNQUOTE(JSON_EXTRACT(e.`details`, '$.after.status')) = 'active'
  GROUP BY e.`subject_id`
) AS audited ON audited.`user_id` = m.`user_id`
SET m.`joined_at` = GREATEST(
  u.`created_at`,
  COALESCE(assigned.`returned_at`, u.`created_at`),
  COALESCE(audited.`returned_at`, u.`created_at`)
);
--> statement-breakpoint
-- The review queue and new applications follow the toggles that gate them today.
UPDATE `notification_recipients`
SET `review_queue` = `trip_rejected`, `new_applications` = `event_changes`;
--> statement-breakpoint
COMMIT;
