-- VTC-140 catch-up: data only, no DDL. Re-runs the 0032 joined_at derivation unchanged so returns
-- recorded after 0032 by code that did not yet write joined_at get the latest return time. The
-- single UPDATE is deterministic and idempotent; rows already derived by 0032 keep their value.
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

