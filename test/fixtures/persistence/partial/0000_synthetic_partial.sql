CREATE TABLE synthetic_recovery_kept (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
--> statement-breakpoint
INSERT INTO synthetic_recovery_missing (id) VALUES (1);
