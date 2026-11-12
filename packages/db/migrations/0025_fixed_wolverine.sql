ALTER TABLE `manual_drafts`
  MODIFY COLUMN `state` enum('editing','submitted','discarded') NOT NULL,
  ADD INDEX `manual_draft_owner_state_page` (`owner_id`,`state`,`created_at`,`id`);
