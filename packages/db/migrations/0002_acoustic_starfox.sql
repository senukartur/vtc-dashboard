ALTER TABLE `identity_challenges`
  ADD `current_email_confirmed` boolean DEFAULT false NOT NULL,
  ADD `identity_epoch` int unsigned DEFAULT 0 NOT NULL;
