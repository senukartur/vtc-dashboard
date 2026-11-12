ALTER TABLE `manual_drafts`
  ADD `started_at` datetime(3),
  ADD `completed_at` datetime(3),
  ADD `cargo_damage_percent` double,
  ADD `origin_company_id` binary(36),
  ADD `destination_company_id` binary(36);--> statement-breakpoint
ALTER TABLE `manual_revisions`
  ADD `started_at` datetime(3),
  ADD `completed_at` datetime(3),
  ADD `cargo_damage_percent` double,
  ADD `origin_company_id` binary(36),
  ADD `destination_company_id` binary(36);
