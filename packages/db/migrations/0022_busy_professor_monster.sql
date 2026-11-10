CREATE TABLE `catalog_companies` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`code` varbinary(128) NOT NULL,
	`name_en` varchar(256) NOT NULL,
	`name_ru` varchar(256),
	`dlc_id` binary(36),
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_company_game_code` UNIQUE(`game`,`code`),
	CONSTRAINT `catalog_company_id_game` UNIQUE(`id`,`game`),
	CONSTRAINT `catalog_company_code_nonempty` CHECK(octet_length(`catalog_companies`.`code`) > 0),
	CONSTRAINT `catalog_company_name_ru_nonempty` CHECK(`catalog_companies`.`name_ru` IS NULL OR char_length(`catalog_companies`.`name_ru`) > 0)
);
--> statement-breakpoint
CREATE TABLE `catalog_company_cities` (
	`id` binary(36) NOT NULL,
	`game` enum('ets2','ats') NOT NULL,
	`company_id` binary(36) NOT NULL,
	`city_id` binary(36) NOT NULL,
	`dlc_id` binary(36),
	`hidden` boolean NOT NULL DEFAULT false,
	CONSTRAINT `catalog_company_cities_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_company_city_pair` UNIQUE(`company_id`,`city_id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_company_logos` (
	`company_id` binary(36) NOT NULL,
	`png` blob NOT NULL,
	`byte_length` int unsigned NOT NULL,
	`sha256` binary(32) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_company_logos_company_id` PRIMARY KEY(`company_id`),
	CONSTRAINT `catalog_company_logo_size` CHECK(`catalog_company_logos`.`byte_length` BETWEEN 1 AND 32768),
	CONSTRAINT `catalog_company_logo_length` CHECK(octet_length(`catalog_company_logos`.`png`) = `catalog_company_logos`.`byte_length`)
);
--> statement-breakpoint
ALTER TABLE `catalog_companies` ADD CONSTRAINT `catalog_company_dlc_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_company_cities` ADD CONSTRAINT `catalog_company_city_company_fk` FOREIGN KEY (`company_id`,`game`) REFERENCES `catalog_companies`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_company_cities` ADD CONSTRAINT `catalog_company_city_city_fk` FOREIGN KEY (`city_id`,`game`) REFERENCES `catalog_cities`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_company_cities` ADD CONSTRAINT `catalog_company_city_dlc_fk` FOREIGN KEY (`dlc_id`,`game`) REFERENCES `catalog_dlcs`(`id`,`game`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_company_logos` ADD CONSTRAINT `catalog_company_logos_company_id_catalog_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `catalog_companies`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `catalog_company_city_by_city` ON `catalog_company_cities` (`city_id`,`company_id`);