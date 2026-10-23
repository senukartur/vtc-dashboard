import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { components } from "@vtc/contracts";
import { createAudit, idColumn, newId, type UnitOfWork, utcColumn } from "@vtc/db";
import {
  eventAttendanceRevisions,
  eventAttendances,
  eventCommands,
  eventResponseRevisions,
  eventResponses,
  eventRevisions,
} from "@vtc/db/events-schema";
import { int, mysqlEnum, mysqlTable } from "drizzle-orm/mysql-core";
import { canonicalJson } from "../../apps/api/src/modules/sources/contracts/canonical.ts";

type S = components["schemas"];
// Golden writer for the schema and command format published by 0011 at base
// b133c4c60e98c7c4c5b514fe4a0f804b5b63fa13. This test-only table lists exactly
// the old current columns; immutable event tables and canonical command v1 are unchanged.
// It deliberately cannot call the current facade before the forward migration.
const historicalEvents = mysqlTable("events", {
  id: idColumn("id").primaryKey(),
  version: int("version").notNull(),
  changeSequence: int("change_sequence").notNull(),
  attendanceVersion: int("attendance_version").notNull(),
  currentRevisionId: idColumn("current_revision_id"),
  game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
  visibility: mysqlEnum("visibility", ["public", "members"]).notNull(),
  status: mysqlEnum("status", ["scheduled", "cancelled"]).notNull(),
  startsAt: utcColumn("starts_at").notNull(),
  createdAt: utcColumn("created_at").notNull(),
});

export async function seedPublishedEventsHistory(
  unit: UnitOfWork,
  actorId: string,
  key: string,
  input: S["EventInput"],
) {
  for (const name of [
    "originCityId",
    "destinationCityId",
    "prescribedCargoId",
    "prescribedMassKg",
    "prescribedTrailerTypeId",
  ] as const)
    assert.equal(input[name], null);
  const eventId = newId(),
    definitionId = newId(),
    responseId = newId(),
    responseRevisionId = newId(),
    attendanceId = newId();
  const createKey = newId(),
    responseKey = newId(),
    attendanceKey = newId(),
    time = "2026-10-22T12:00:00.000Z",
    attendedAt = "2026-10-22T12:01:00.000Z";
  const responseInput = { response: "participating" as const },
    attendanceInput = {
      members: [{ memberId: actorId, attendance: "attended" as const, note: null }],
    };
  const receipts = [
    {
      route: "create" as const,
      target: createKey,
      key: createKey,
      value: input,
      result: {
        eventId,
        revisionId: definitionId,
        version: 1,
        responseRevisionId: null,
        attendanceRevisionId: null,
      },
      time,
    },
    {
      route: "response" as const,
      target: eventId,
      key: responseKey,
      value: [1, responseInput],
      result: { eventId, revisionId: responseRevisionId, version: 2 },
      time,
    },
    {
      route: "attendance" as const,
      target: eventId,
      key: attendanceKey,
      value: [1, attendanceInput],
      result: { eventId, revisionId: attendanceId, version: 2 },
      time: attendedAt,
    },
  ];
  await unit.run(async (tx) => {
    const c = unit.client(tx);
    await c.insert(historicalEvents).values({
      id: eventId,
      version: 1,
      changeSequence: 3,
      attendanceVersion: 2,
      currentRevisionId: definitionId,
      game: input.game,
      visibility: input.visibility,
      status: "scheduled",
      startsAt: input.startsAt,
      createdAt: time,
    });
    await c.insert(eventRevisions).values({
      id: definitionId,
      eventId,
      version: 1,
      sequence: 1,
      actorId,
      recordedAt: time,
      category: "created",
      status: "scheduled",
      title: input.title,
      description: input.description,
      game: input.game,
      server: input.server,
      organizer: input.organizer,
      meetingLocation: input.meetingLocation,
      route: input.route,
      meetingAt: input.meetingAt,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      visibility: input.visibility,
      prescribedMassKg: null,
      privateReason: null,
    });
    await c.insert(eventResponseRevisions).values({
      id: responseRevisionId,
      responseId,
      eventId,
      memberId: actorId,
      version: 2,
      sequence: 2,
      actorId,
      recordedAt: time,
      status: "participating",
      reason: null,
    });
    await c.insert(eventResponses).values({
      id: responseId,
      eventId,
      memberId: actorId,
      version: 2,
      currentRevisionId: responseRevisionId,
      status: "participating",
    });
    await c.insert(eventAttendanceRevisions).values({
      id: attendanceId,
      eventId,
      eventRevisionId: definitionId,
      memberId: actorId,
      version: 2,
      sequence: 3,
      actorId,
      recordedAt: attendedAt,
      status: "attended",
      note: null,
    });
    await c
      .insert(eventAttendances)
      .values({ eventId, memberId: actorId, currentRevisionId: attendanceId });
    for (const receipt of receipts) {
      const fingerprint = createHmac("sha256", Buffer.from(key, "hex"))
        .update("events/command/v1\0")
        .update(canonicalJson([actorId, receipt.route, receipt.target, receipt.key, receipt.value]))
        .digest();
      await c.insert(eventCommands).values({
        actorId,
        route: receipt.route,
        targetId: receipt.target,
        key: receipt.key,
        fingerprint,
        result: receipt.result,
        recordedAt: receipt.time,
      });
      await createAudit(unit).append(tx, {
        actorKind: "user",
        actorId,
        operation: "configuration.changed",
        subjectKind: "event",
        subjectId: eventId,
        occurredAt: receipt.time,
        reason: "operator_request",
      });
    }
  });
  const publicEvent: S["EventPublic"] = {
    id: eventId,
    version: 1,
    title: input.title,
    description: input.description,
    game: input.game,
    server: input.server,
    organizer: input.organizer,
    meetingLocation: input.meetingLocation,
    route: input.route,
    meetingAt: input.meetingAt,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: "scheduled",
    origin: null,
    destination: null,
  };
  const common = {
    event: publicEvent,
    visibility: input.visibility,
    prescribedCargoId: null,
    prescribedMassKg: null,
    prescribedTrailerTypeId: null,
  };
  const eventBefore = {
    data: {
      ...common,
      myResponse: { version: 2, response: "participating" as const, declineReason: null },
      myAttendance: "attended" as const,
    },
    version: 1,
  };
  const replayBefore = {
    data: {
      ...common,
      myResponse: { version: 1, response: "unanswered" as const, declineReason: null },
      myAttendance: "unconfirmed" as const,
    },
    version: 1,
  };
  const readRetained = () =>
    unit.run(async (tx) => ({
      definitions: await unit.client(tx).select().from(eventRevisions),
      responses: await unit.client(tx).select().from(eventResponseRevisions),
      attendance: await unit.client(tx).select().from(eventAttendanceRevisions),
      nextAfterSequence: { definitions: null, responses: null, attendance: null },
    }));
  const readReceipts = () => unit.run((tx) => unit.client(tx).select().from(eventCommands));
  return {
    eventId,
    createKey,
    responseKey,
    attendanceKey,
    responseInput,
    attendanceInput,
    eventBefore,
    replayBefore,
    historyBefore: await readRetained(),
    receiptsBefore: await readReceipts(),
    readReceipts,
  };
}
