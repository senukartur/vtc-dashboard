ALTER TABLE `qualification_levels` ADD `cargo_damage_max_percent` decimal(38,18),
  ADD CONSTRAINT `qual_level_cargo_damage_range` CHECK (`qualification_levels`.`cargo_damage_max_percent` IS NULL OR `qualification_levels`.`cargo_damage_max_percent` BETWEEN 0 AND 100);
