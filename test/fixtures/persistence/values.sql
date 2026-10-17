CREATE TABLE synthetic_values (
  id BINARY(36) NOT NULL PRIMARY KEY,
  parent_id INT NOT NULL,
  opaque_key VARBINARY(512) NOT NULL,
  label VARCHAR(128) NOT NULL,
  amount DECIMAL(38,18) NOT NULL,
  large_integer BIGINT NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  CONSTRAINT synthetic_opaque_unique UNIQUE (opaque_key),
  CONSTRAINT synthetic_parent_fk FOREIGN KEY (parent_id) REFERENCES synthetic_parent(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
