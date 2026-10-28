ALTER TABLE `events` ADD `notification_material` json;--> statement-breakpoint
ALTER TABLE `events` ADD `notification_material_pending` boolean GENERATED ALWAYS AS (
      CASE WHEN JSON_TYPE(notification_material)='OBJECT' AND JSON_LENGTH(notification_material)=5
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.schemaVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.schemaVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.throughVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.throughVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.startVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.startVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.routeVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.routeVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.statusVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.statusVersion') BETWEEN 1 AND version
        AND JSON_EXTRACT(notification_material,'$.schemaVersion')=1
      THEN NOT (CAST(JSON_EXTRACT(notification_material,'$.schemaVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.schemaVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.throughVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.throughVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.startVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.startVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.routeVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.routeVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.statusVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.statusVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.throughVersion') AS UNSIGNED)=version
        AND CAST(JSON_EXTRACT(notification_material,'$.startVersion') AS UNSIGNED) BETWEEN 1 AND version
        AND CAST(JSON_EXTRACT(notification_material,'$.routeVersion') AS UNSIGNED) BETWEEN 1 AND version
        AND CAST(JSON_EXTRACT(notification_material,'$.statusVersion') AS UNSIGNED) BETWEEN 1 AND version)
      ELSE TRUE END) VIRTUAL;--> statement-breakpoint
CREATE INDEX `event_notification_material_pending` ON `events` (`notification_material_pending`,`id`);