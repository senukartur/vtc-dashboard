CREATE TABLE `admissions_applications` (
	`id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`status` enum('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
	`submitted_at` datetime(3) NOT NULL,
	`nickname` varchar(128) NOT NULL,
	`locale` enum('en','ru') NOT NULL DEFAULT 'en',
	`email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
	`email_key` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
	`open_email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
	`steam_profile_url` varchar(512) NOT NULL,
	`games` json NOT NULL,
	`discord` varchar(256),
	`introduction` text,
	`invitation_id` binary(36),
	CONSTRAINT `admissions_applications_id` PRIMARY KEY(`id`),
	CONSTRAINT `admissions_one_open_email` UNIQUE(`open_email`)
);
--> statement-breakpoint
CREATE TABLE `admissions_command_results` (
	`scope_hash` varbinary(32) NOT NULL,
	`idempotency_key` binary(36) NOT NULL,
	`fingerprint` varbinary(32) NOT NULL,
	`result` json NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `admissions_command_results_scope_hash_idempotency_key_pk` PRIMARY KEY(`scope_hash`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `admissions_decisions` (
	`application_id` binary(36) NOT NULL,
	`id` binary(36) NOT NULL,
	`outcome` enum('approve','reject') NOT NULL,
	`reason` text,
	`reviewer_id` binary(36) NOT NULL,
	`decided_at` datetime(3) NOT NULL,
	`application_version` int unsigned NOT NULL,
	`delivery_id` binary(36),
	CONSTRAINT `admissions_decisions_application_id` PRIMARY KEY(`application_id`),
	CONSTRAINT `admissions_decisions_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `admissions_invitations` (
	`id` binary(36) NOT NULL,
	`application_id` binary(36) NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`state` enum('active','used','revoked') NOT NULL DEFAULT 'active',
	`secret_hash` varbinary(32),
	`ciphertext` text,
	`payload_expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`user_id` binary(36),
	`delivery_id` binary(36),
	CONSTRAINT `admissions_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `admissions_invitation_hash` UNIQUE(`secret_hash`)
);
--> statement-breakpoint
CREATE TABLE `admissions_limits` (
	`bucket` varchar(64) NOT NULL,
	`window` int unsigned NOT NULL,
	`count` int unsigned NOT NULL,
	CONSTRAINT `admissions_limits_bucket` PRIMARY KEY(`bucket`)
);
--> statement-breakpoint
CREATE TABLE `qualification_initial_assignments` (
	`id` binary(36) NOT NULL,
	`user_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`level` enum('trainee') NOT NULL,
	`assigned_at` datetime(3) NOT NULL,
	CONSTRAINT `qualification_initial_assignments_user_id_game_pk` PRIMARY KEY(`user_id`,`game`),
	CONSTRAINT `qualification_initial_id` UNIQUE(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_entries` MODIFY COLUMN `subject_kind` enum('company','user','trip','catalog','application','invitation') NOT NULL;--> statement-breakpoint
ALTER TABLE `admissions_decisions` ADD CONSTRAINT `admissions_decisions_reviewer_id_identity_memberships_user_id_fk` FOREIGN KEY (`reviewer_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions_decisions` ADD CONSTRAINT `admissions_decision_application_fk` FOREIGN KEY (`application_id`) REFERENCES `admissions_applications`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions_invitations` ADD CONSTRAINT `admissions_invitations_user_id_identity_memberships_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions_invitations` ADD CONSTRAINT `admissions_invitation_application_fk` FOREIGN KEY (`application_id`) REFERENCES `admissions_applications`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_initial_assignments` ADD CONSTRAINT `qualification_initial_member_fk` FOREIGN KEY (`user_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admissions_submitted_page` ON `admissions_applications` (`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `admissions_email_history` ON `admissions_applications` (`email_key`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `admissions_result_expiry` ON `admissions_command_results` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admissions_invitation_application` ON `admissions_invitations` (`application_id`);--> statement-breakpoint
CREATE INDEX `admissions_invitation_expiry` ON `admissions_invitations` (`payload_expires_at`);