import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn, utcColumn } from "../core/values.js";

export const outboxEvents = mysqlTable(
  "outbox_events",
  {
    id: idColumn("id").primaryKey(),
    type: opaqueColumn("type", { length: 64 }).notNull(),
    schemaVersion: int("schema_version").notNull(),
    aggregateKind: opaqueColumn("aggregate_kind", { length: 32 }).notNull(),
    aggregateId: idColumn("aggregate_id").notNull(),
    aggregateVersion: int("aggregate_version").notNull(),
    occurredAt: utcColumn("occurred_at").notNull(),
    correlationId: idColumn("correlation_id").notNull(),
    causationId: idColumn("causation_id"),
    data: json("data").$type<unknown>().notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
  },
  (t) => [index("outbox_recorded_idx").on(t.recordedAt, t.id)],
);

export const durableJobs = mysqlTable(
  "durable_jobs",
  {
    id: idColumn("id").primaryKey(),
    kind: opaqueColumn("kind", { length: 64 }).notNull(),
    schemaVersion: int("schema_version").notNull(),
    consumer: opaqueColumn("consumer", { length: 64 }).notNull(),
    effectKey: opaqueColumn("effect_key", { length: 128 }).notNull(),
    eventId: idColumn("event_id").references(() => outboxEvents.id),
    reference: json("reference").$type<unknown>().notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    state: mysqlEnum("state", ["ready", "running", "completed", "failed"]).notNull(),
    availableAt: utcColumn("available_at").notNull(),
    attempts: int("attempts").notNull(),
    maxAttempts: int("max_attempts").notNull(),
    leaseToken: idColumn("lease_token"),
    leaseUntil: utcColumn("lease_until"),
    failure: mysqlEnum("failure", [
      "retryable",
      "exhausted",
      "missing_handler",
      "invalid_input",
      "external_ambiguity",
      "handler_failed",
    ]),
    createdAt: utcColumn("created_at").notNull(),
    completedAt: utcColumn("completed_at"),
  },
  (t) => [
    uniqueIndex("jobs_effect_unique").on(t.consumer, t.effectKey),
    uniqueIndex("jobs_event_consumer_unique").on(t.eventId, t.consumer),
    index("jobs_ready_idx").on(t.state, t.availableAt, t.id),
    index("jobs_expired_idx").on(t.state, t.leaseUntil, t.id),
  ],
);

// Enabled producers insert derived routing work with the immutable event. Pausing retains it;
// the wrapping scan repairs disabled/old producers. Removal acknowledges a permanent job identity.
export const outboxRouting = mysqlTable(
  "outbox_routing",
  {
    eventId: idColumn("event_id")
      .notNull()
      .references(() => outboxEvents.id, { onDelete: "cascade" }),
    consumer: opaqueColumn("consumer", { length: 64 }).notNull(),
    eventType: opaqueColumn("event_type", { length: 64 }).notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.consumer] }),
    index("outbox_routing_pending").on(t.consumer, t.recordedAt, t.eventId),
  ],
);
export const outboxRoutingScans = mysqlTable("outbox_routing_scans", {
  consumer: opaqueColumn("consumer", { length: 64 }).primaryKey(),
  cursor: idColumn("cursor"),
});

export const effectReceipts = mysqlTable(
  "job_effect_receipts",
  {
    consumer: opaqueColumn("consumer", { length: 64 }).notNull(),
    effectKey: opaqueColumn("effect_key", { length: 128 }).notNull(),
    jobId: idColumn("job_id")
      .notNull()
      .references(() => durableJobs.id),
    committedAt: utcColumn("committed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.effectKey] })],
);

export const runnerLeases = mysqlTable("job_runner_leases", {
  name: opaqueColumn("name", { length: 64 }).primaryKey(),
  token: idColumn("token").notNull(),
  leaseUntil: utcColumn("lease_until").notNull(),
});

export { and, asc, eq, isNull, lte, notExists, sql } from "drizzle-orm";
