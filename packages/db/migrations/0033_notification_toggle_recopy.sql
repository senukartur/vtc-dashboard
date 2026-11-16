-- VTC-142 activates the Stage 4 toggles: re-copy the two that inherit today's gating toggles,
-- so changes made after 0032 carry over. Data only, one deterministic idempotent statement.
UPDATE `notification_recipients` SET `review_queue` = `trip_rejected`, `new_applications` = `event_changes`;
