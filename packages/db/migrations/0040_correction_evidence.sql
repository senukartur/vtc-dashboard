CREATE TABLE `manual_correction_evidence` (
	`evidence_id` binary(36) NOT NULL,
	`correction_id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	CONSTRAINT `manual_correction_evidence_evidence_id_correction_id_pk` PRIMARY KEY(`evidence_id`,`correction_id`)
);
--> statement-breakpoint
CREATE TABLE `manual_correction_submissions` (
	`id` binary(36) NOT NULL,
	`owner_id` binary(36) NOT NULL,
	`trip_id` binary(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `manual_correction_submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `manual_correction_submission_trip` UNIQUE(`id`,`trip_id`)
);
--> statement-breakpoint
ALTER TABLE `manual_correction_evidence` ADD CONSTRAINT `manual_correction_evidence_evidence_id_manual_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `manual_evidence`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `manual_correction_evidence` ADD CONSTRAINT `manual_correction_evidence_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `manual_correction_evidence` ADD CONSTRAINT `manual_correction_evidence_submission_fk` FOREIGN KEY (`correction_id`,`trip_id`) REFERENCES `manual_correction_submissions`(`id`,`trip_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `manual_correction_submissions` ADD CONSTRAINT `manual_correction_submissions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `manual_correction_submissions` ADD CONSTRAINT `manual_correction_submission_owner_fk` FOREIGN KEY (`owner_id`) REFERENCES `identity_memberships`(`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `manual_correction_evidence_trip` ON `manual_correction_evidence` (`trip_id`,`evidence_id`);--> statement-breakpoint
CREATE INDEX `manual_correction_evidence_correction` ON `manual_correction_evidence` (`correction_id`,`evidence_id`);--> statement-breakpoint
CREATE INDEX `manual_correction_submission_page` ON `manual_correction_submissions` (`trip_id`,`created_at`,`id`);