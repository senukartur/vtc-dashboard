-- Product-authored taxonomy only. Existing variants, event references and qualification allowances retain their original identities.
CREATE TABLE `qualification_level_trailer_types` (
	`level_id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`trailer_id` binary(36) NOT NULL,
	CONSTRAINT `qualification_level_trailer_types_level_id_trailer_id_pk` PRIMARY KEY(`level_id`,`trailer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `catalog_trailer_types` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256) NOT NULL,
	CONSTRAINT `catalog_trailer_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_trailer_type_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_trailer_type_id_game` UNIQUE(`id`,`game`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` DROP CONSTRAINT `trip_trailer_shape`;--> statement-breakpoint
ALTER TABLE `event_drafts` DROP CONSTRAINT `event_draft_catalog_game`;--> statement-breakpoint
ALTER TABLE `qualification_levels` ADD `trailer_basis` enum('variant','type') DEFAULT 'variant' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_trailers` ADD `trailer_type_id` binary(36);--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD `trailer_type_id` binary(36);--> statement-breakpoint
ALTER TABLE `event_drafts` ADD `prescribed_trailer_kind_id` binary(36);--> statement-breakpoint
ALTER TABLE `event_revisions` ADD `prescribed_trailer_kind_id` binary(36);--> statement-breakpoint
ALTER TABLE `qualification_level_trailer_types` ADD CONSTRAINT `qual_level_type_level_fk` FOREIGN KEY (`level_id`,`game`) REFERENCES `qualification_levels`(`id`,`game`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualification_level_trailer_types` ADD CONSTRAINT `qual_level_type_catalog_fk` FOREIGN KEY (`trailer_id`,`game`) REFERENCES `catalog_trailer_types`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_trailer_shape` CHECK ((`trip_fact_trailers`.`trailer_id` IS NULL AND `trip_fact_trailers`.`trailer_type_id` IS NULL AND `trip_fact_trailers`.`source_field` IS NULL AND `trip_fact_trailers`.`unknown_reason` IS NOT NULL) OR (((`trip_fact_trailers`.`trailer_id` IS NOT NULL AND `trip_fact_trailers`.`trailer_type_id` IS NULL) OR (`trip_fact_trailers`.`trailer_id` IS NULL AND `trip_fact_trailers`.`trailer_type_id` IS NOT NULL)) AND `trip_fact_trailers`.`source_field` IS NOT NULL AND `trip_fact_trailers`.`unknown_reason` IS NULL));--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_trailer_identity` CHECK (`event_drafts`.`prescribed_trailer_type_id` IS NULL OR `event_drafts`.`prescribed_trailer_kind_id` IS NULL);--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_catalog_game` CHECK (`event_drafts`.`game` IS NOT NULL OR (
      `event_drafts`.`origin_city_id` IS NULL AND `event_drafts`.`destination_city_id` IS NULL
      AND `event_drafts`.`origin_depot_id` IS NULL AND `event_drafts`.`destination_depot_id` IS NULL
      AND `event_drafts`.`prescribed_cargo_id` IS NULL AND `event_drafts`.`prescribed_trailer_type_id` IS NULL AND `event_drafts`.`prescribed_trailer_kind_id` IS NULL));--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_trailer_identity` CHECK (`event_revisions`.`prescribed_trailer_id` IS NULL OR `event_revisions`.`prescribed_trailer_kind_id` IS NULL);--> statement-breakpoint
ALTER TABLE `catalog_trailers` ADD CONSTRAINT `catalog_trailer_type_fk` FOREIGN KEY (`trailer_type_id`,`game`) REFERENCES `catalog_trailer_types`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trip_fact_trailers` ADD CONSTRAINT `trip_trailer_type_fk` FOREIGN KEY (`trailer_type_id`) REFERENCES `catalog_trailer_types`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_drafts` ADD CONSTRAINT `event_draft_type_fk` FOREIGN KEY (`prescribed_trailer_kind_id`,`game`) REFERENCES `catalog_trailer_types`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_revisions` ADD CONSTRAINT `event_revision_type_fk` FOREIGN KEY (`prescribed_trailer_kind_id`,`game`) REFERENCES `catalog_trailer_types`(`id`,`game`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
INSERT INTO `catalog_trailer_types` (`id`,`game`,`code`,`name_en`,`name_ru`) VALUES
('08ae3077-165a-4faa-8b29-dabfac9a1532','ets2','curtainside','Curtainsider','Шторный'),
('743ff89f-025b-47a7-8f3f-f471fc5b778e','ets2','dryvan','Box trailer','Фургон'),
('3ab5b578-5cf2-4b4b-bc11-008d3ac8a5a9','ets2','insulated','Insulated trailer','Изотермический'),
('ba7a9525-e7d1-4b2f-9fbd-2b283dbdeafb','ets2','refrigerated','Refrigerated trailer','Рефрижератор'),
('a36e65b5-4c44-4bd1-b91f-adde791ef1eb','ets2','container','Container carrier','Контейнеровоз'),
('00db9697-fec1-4edf-97cc-772847c4168d','ets2','log','Log trailer','Лесовоз'),
('5b1ea958-c837-4d03-bcbd-e2c01ad1b62c','ets2','lowboy','Low loader with gooseneck','Низкорамный трал с гуськом'),
('077bfa5f-cc09-4976-b77e-cc3555cb6617','ets2','flatbed','Flatbed','Платформа'),
('45aaeb35-5429-44a9-a5ff-f9e4275c724a','ets2','foodtank','Food tank','Пищевая цистерна'),
('90ccf5dd-55a8-40ca-bcb9-c5ccea6470d0','ets2','fueltank','Fuel tank','Топливная цистерна'),
('5b95ad3e-35f6-4b41-9138-6a0fd4b662a5','ets2','chemtank','Chemical tank','Химическая цистерна'),
('fc944ebf-d76a-4cc4-b00e-c9cfe5ca2312','ets2','gastank','Gas tank','Газовая цистерна'),
('47dd0e47-646f-48ab-b961-93684eb66d54','ets2','silo','Dry bulk tank','Цистерна для сыпучих грузов'),
('134d0074-a8b9-489f-ab8f-1773542aa577','ets2','dumper','Tipper','Самосвал'),
('3d82f412-e530-416f-b922-d55f050a2e10','ets2','livestock','Livestock trailer','Скотовоз'),
('ef4a120d-c5e2-4bda-912a-310055931f19','ets2','cartransporter','Car transporter','Автовоз'),
('49fe6ffb-029a-4204-a437-8f5d052c8b82','ets2','trucktransporter','Truck transporter','Перевозчик грузовиков'),
('e1a72f45-5662-44a8-8201-7840f8ca7a4a','ets2','lowbed','Low loader','Низкорамный трал'),
('52d9ef5a-121b-4430-afae-679476b40e63','ets2','flatbed_brck','Flatbed with crane','Платформа с краном'),
('8976296c-b438-49af-909a-353a32d4797b','ets2','glass','Glass carrier','Стекловоз'),
('204db6b4-f6e9-4988-a335-315120eafdd2','ets2','panel','Panel carrier','Панелевоз'),
('772280c1-8f34-4c5f-9ff2-d0287a2ba10f','ats','curtainside','Curtainsider','Шторный'),
('7350d0e6-67d4-4826-8010-d8b572491567','ats','dryvan','Box trailer','Фургон'),
('ba0b8f47-fc8d-4ab8-9176-8c29ed968f8a','ats','insulated','Insulated trailer','Изотермический'),
('8fd93b1e-81bd-41dc-8616-6fa0990372ad','ats','refrigerated','Refrigerated trailer','Рефрижератор'),
('be882a2c-b619-476a-a0c4-4a97d620b1d6','ats','container','Container carrier','Контейнеровоз'),
('0b1efb67-f7fa-4fb6-ac66-13c255832f4a','ats','log','Log trailer','Лесовоз'),
('54371148-f309-4c43-9860-743f06c7b16b','ats','lowboy','Low loader with gooseneck','Низкорамный трал с гуськом'),
('52226d73-3eca-405d-9ee8-6f29d763271a','ats','flatbed','Flatbed','Платформа'),
('783ed8fc-80c7-43d3-a54e-d8462165aa2b','ats','foodtank','Food tank','Пищевая цистерна'),
('c66e41aa-6e49-4ba2-8b75-83b0c2d88ede','ats','fueltank','Fuel tank','Топливная цистерна'),
('728d9c88-0d89-441b-871b-22795f346f3c','ats','chemtank','Chemical tank','Химическая цистерна'),
('3902b864-76d5-4007-9534-f3e2b5c04bc1','ats','gastank','Gas tank','Газовая цистерна'),
('2f42d129-f7d3-4eff-9d59-9052df9c8369','ats','silo','Dry bulk tank','Цистерна для сыпучих грузов'),
('b8d562d6-f22f-464c-ad65-66a086c5ffe2','ats','dumper','Tipper','Самосвал'),
('53cb4ff6-922d-4947-ae1f-4fec3aa8cf82','ats','livestock','Livestock trailer','Скотовоз'),
('6b347342-034a-4492-8a98-797c9a342857','ats','cartransporter','Car transporter','Автовоз'),
('3767ff7a-a2c2-4291-a41d-2b7fd94db488','ats','trucktransporter','Truck transporter','Перевозчик грузовиков'),
('6105beb8-0ef2-4b76-8499-1b26faf666da','ats','bulkfeed','Bulk feed trailer','Кормовоз'),
('a62416be-fc52-4350-8819-fb9ac49f754f','ats','chipvan','Chip van','Щеповоз'),
('b1106ce7-012b-4bae-97d8-4773a24d72a6','ats','dropdeck','Drop deck','Ступенчатая платформа'),
('cde131d8-e557-4e18-9ec8-6e85a539bfd2','ats','hopper','Hopper','Хоппер'),
('3300b09c-6b6d-4eb7-ab41-d20daa83d13c','ats','frac','Frac tank','Цистерна для гидроразрыва');
