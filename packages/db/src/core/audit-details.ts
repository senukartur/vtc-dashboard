import { types } from "node:util";
import type { auditOperations, auditSubjects } from "../schema/audit.js";
import { applicationId } from "./values.js";

type Validator<T> = (value: unknown) => T;
type Fields = Record<string, Validator<unknown>>;

function invalidDetails(): never {
  throw new Error("INVALID_AUDIT_DETAILS");
}

export function auditObject(
  raw: unknown,
  allowed: readonly string[],
  invalid = () => {
    throw new Error("INVALID_AUDIT_SHAPE");
  },
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || types.isProxy(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  return Object.fromEntries(
    Reflect.ownKeys(raw).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (
        typeof key !== "string" ||
        !allowed.includes(key) ||
        !descriptor?.enumerable ||
        !("value" in descriptor)
      )
        return invalid();
      return [key, descriptor.value] as const;
    }),
  );
}

function oneOf<const Values extends readonly string[]>(
  ...values: Values
): Validator<Values[number]> {
  return (value) => {
    if (typeof value !== "string" || !values.includes(value)) return invalidDetails();
    return value;
  };
}

function nullable<T>(validate: Validator<T>): Validator<T | null> {
  return (value) => (value === null ? null : validate(value));
}

const id: Validator<string> = (value) => {
  if (typeof value !== "string") return invalidDetails();
  try {
    return applicationId(value);
  } catch {
    return invalidDetails();
  }
};
const bool: Validator<boolean> = (value) => {
  if (typeof value !== "boolean") return invalidDetails();
  return value;
};
const version: Validator<number> = (value) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 4294967295)
    return invalidDetails();
  return value;
};
const timeZone: Validator<string> = (value) => {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value))
    return invalidDetails();
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    return invalidDetails();
  }
  return value;
};
const game = oneOf("ets2", "ats");
const assignableRole = oneOf("trainee", "driver", "dispatcher", "deputy_director");
const roles: Validator<ReturnType<typeof assignableRole>[]> = (value) => {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 4) return invalidDetails();
  if (Reflect.ownKeys(value).length !== value.length + 1) return invalidDetails();
  const result = Array.from({ length: value.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor?.enumerable || !("value" in descriptor)) return invalidDetails();
    return assignableRole(descriptor.value);
  });
  if (new Set(result).size !== result.length) return invalidDetails();
  return result;
};

const application = { status: oneOf("submitted", "approved", "rejected") };
const invitation = { state: oneOf("active", "used", "revoked") };
const decision = {
  decision: oneOf("unassessed", "pending_review", "accepted", "rejected"),
  acceptedOverLimits: bool,
};
const dismissal = { dismissed: bool, version };
const assignment = { game, assignmentId: id, levelId: id };
const detailOperations = {
  "configuration.changed": {
    subject: "company",
    fields: { reportingTimezone: nullable(timeZone) },
  },
  "roles.changed": { subject: "user", fields: { roles } },
  "membership.changed": {
    subject: "user",
    fields: { status: oneOf("active", "inactive"), role: nullable(oneOf("trainee", "driver")) },
  },
  "leadership.transferred": { subject: "user", fields: { director: bool } },
  "application.submitted": { subject: "application", fields: application },
  "application.reviewed": { subject: "application", fields: application },
  "invitation.reissued": { subject: "invitation", fields: invitation },
  "invitation.copied": { subject: "invitation", fields: invitation },
  "invitation.redeemed": { subject: "invitation", fields: invitation },
  "report.reviewed": { subject: "trip", fields: decision },
  "report.accepted_over_limits": { subject: "trip", fields: decision },
  "trip.reconciled": {
    subject: "trip",
    fields: { reconciliationId: id, state: oneOf("applied", "reversed") },
  },
  "duplicate.dismissed": { subject: "duplicate_candidate", fields: dismissal },
  "duplicate.dismissal_undone": { subject: "duplicate_candidate", fields: dismissal },
  "qualification.assigned": { subject: "qualification", fields: assignment },
  "qualification.promoted": { subject: "qualification", fields: assignment },
  "qualification.level_changed": {
    subject: "qualification_level",
    fields: { game, levelId: id, position: version, active: bool, version },
  },
  "qualification.rules_published": {
    subject: "qualification_rule_version",
    fields: { game, levelId: id, ruleVersionId: id, version },
  },
} as const satisfies Partial<
  Record<
    (typeof auditOperations)[number],
    { subject: (typeof auditSubjects)[number]; fields: Fields }
  >
>;

type DetailOperations = typeof detailOperations;
type Snapshot<T extends Fields> = { [Key in keyof T]: ReturnType<T[Key]> };
type BeforeAfter<T> = { before: T; after: T | null } | { before: null; after: T };

export type AuditDetailRecord = {
  [Operation in keyof DetailOperations]: {
    operation: Operation;
    subjectKind: DetailOperations[Operation]["subject"];
    details: BeforeAfter<Snapshot<DetailOperations[Operation]["fields"]>>;
  };
}[keyof DetailOperations];

export type AuditDetails = AuditDetailRecord["details"];

function snapshot<T extends Fields>(raw: unknown, fields: T): Snapshot<T> | null {
  if (raw === null) return null;
  const input = auditObject(raw, Object.keys(fields), invalidDetails);
  return Object.fromEntries(
    Object.entries(fields).map(([key, validate]) => [
      key,
      validate(Object.hasOwn(input, key) ? input[key] : undefined),
    ]),
  ) as Snapshot<T>;
}

export function safeAuditDetails(
  operation: (typeof auditOperations)[number],
  subject: (typeof auditSubjects)[number],
  raw: unknown,
): AuditDetails {
  if (!Object.hasOwn(detailOperations, operation)) return invalidDetails();
  const shape = detailOperations[operation as keyof DetailOperations];
  if (shape.subject !== subject) return invalidDetails();
  const input = auditObject(raw, ["before", "after"], invalidDetails);
  const before = snapshot(input.before, shape.fields);
  const after = snapshot(input.after, shape.fields);
  if (before === null && after === null) return invalidDetails();
  return { before, after } as AuditDetails;
}

const catalogKind = oneOf(
  "dlcs",
  "regions",
  "cities",
  "companies",
  "cargoes",
  "trailers",
  "depots",
  "company_logos",
);
type CatalogKind = ReturnType<typeof catalogKind>;
type CatalogGame = ReturnType<typeof game>;
type EventContext = { title: string | null };
type CatalogContext = { kind: CatalogKind; games: CatalogGame[] };
const levelChange = oneOf("name", "limits", "conditions", "position");
export const qualificationLevelOperations = [
  "qualification.level_created",
  "qualification.level_edited",
  "qualification.level_moved",
  "qualification.level_removed",
] as const;
const adrClass = oneOf("1", "2", "3", "4", "6", "8");
/** A level's values before or after a history entry; at most 100 trailer types and six classes. */
export type QualificationLevelValues = {
  name: string;
  position: number | null;
  limits: {
    massMinKg: string | null;
    massMaxKg: string | null;
    distanceMinM: string | null;
    distanceMaxM: string | null;
    cargoDamageMaxPercent?: string | null;
    trailers: { basis?: "variant" | "type"; mode: "any" | "selected"; typeIds: string[] };
    adr: { mode: "forbidden" | "selected" | "any"; classes: ReturnType<typeof adrClass>[] };
    hardModeRequired: boolean;
  };
  conditions: { requiredTrips: number | null; requiredDistanceM: string | null };
};
// Level history (VTC-157). The context stays private to the Qualifications reader; the
// administration log shows these rows without details. `before` and `after` are absent on
// entries written before they were recorded.
export type QualificationLevelContext = {
  game: CatalogGame;
  name: string;
  position: number | null;
  changes: ReturnType<typeof levelChange>[];
  transferLevelId: string | null;
  before?: QualificationLevelValues | null;
  after?: QualificationLevelValues | null;
};

export type AuditContextRecord =
  | { operation: "configuration.changed"; subjectKind: "event"; details: EventContext }
  | {
      operation: "catalog.changed" | "catalog.imported" | "catalog.published";
      subjectKind: "catalog";
      details: CatalogContext;
    }
  | {
      operation: (typeof qualificationLevelOperations)[number];
      subjectKind: "qualification_level";
      details: QualificationLevelContext;
    };
export type AuditContext = AuditContextRecord["details"];

function eventContext(value: unknown): EventContext {
  const { title } = auditObject(value, ["title"], invalidDetails);
  if (title !== null && (typeof title !== "string" || !title.trim() || title.length > 256))
    return invalidDetails();
  return { title };
}

function catalogContext(value: unknown, allowMixedGames: boolean): CatalogContext {
  const { kind, games } = auditObject(value, ["kind", "games"], invalidDetails);
  if (
    !Array.isArray(games) ||
    types.isProxy(games) ||
    games.length < 1 ||
    games.length > (allowMixedGames ? 2 : 1) ||
    Reflect.ownKeys(games).length !== games.length + 1
  )
    return invalidDetails();
  const validated = Array.from({ length: games.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(games, i);
    if (!descriptor?.enumerable || !("value" in descriptor)) return invalidDetails();
    return game(descriptor.value);
  });
  if (new Set(validated).size !== validated.length) return invalidDetails();
  return { kind: catalogKind(kind), games: validated.length === 2 ? ["ets2", "ats"] : validated };
}

/** A plain array of at most `limit` distinct values, each validated in order. */
function distinctList<T>(value: unknown, limit: number, item: Validator<T>): T[] {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length > limit ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return invalidDetails();
  const result = Array.from({ length: value.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor?.enumerable || !("value" in descriptor)) return invalidDetails();
    return item(descriptor.value);
  });
  if (new Set(result).size !== result.length) return invalidDetails();
  return result;
}
const levelName: Validator<string> = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 128) return invalidDetails();
  return value;
};
const levelPosition: Validator<number | null> = (value) => {
  if (
    value !== null &&
    (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 25)
  )
    return invalidDetails();
  return value;
};
const amount: Validator<string> = (value) => {
  // A DECIMAL(38,18) value in its canonical spelling, as the level columns store it.
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})(\.[0-9]{0,17}[1-9])?$/.test(value))
    return invalidDetails();
  return value;
};
const damagePercent: Validator<string> = (value) => {
  const exact = amount(value);
  if (!/^(100|(?:0|[1-9][0-9]?)(\.[0-9]{0,17}[1-9])?)$/.test(exact)) return invalidDetails();
  return exact;
};
const trips: Validator<number> = (value) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 4294967295)
    return invalidDetails();
  return value;
};
function levelValues(value: unknown): QualificationLevelValues {
  const input = auditObject(value, ["name", "position", "limits", "conditions"], invalidDetails);
  const limits = auditObject(
    input.limits,
    [
      "massMinKg",
      "massMaxKg",
      "distanceMinM",
      "distanceMaxM",
      "cargoDamageMaxPercent",
      "trailers",
      "adr",
      "hardModeRequired",
    ],
    invalidDetails,
  );
  const trailers = auditObject(limits.trailers, ["basis", "mode", "typeIds"], invalidDetails);
  const adr = auditObject(limits.adr, ["mode", "classes"], invalidDetails);
  const conditions = auditObject(
    input.conditions,
    ["requiredTrips", "requiredDistanceM"],
    invalidDetails,
  );
  return {
    name: levelName(input.name),
    position: levelPosition(input.position),
    limits: {
      massMinKg: nullable(amount)(limits.massMinKg),
      massMaxKg: nullable(amount)(limits.massMaxKg),
      distanceMinM: nullable(amount)(limits.distanceMinM),
      distanceMaxM: nullable(amount)(limits.distanceMaxM),
      ...("cargoDamageMaxPercent" in limits
        ? { cargoDamageMaxPercent: nullable(damagePercent)(limits.cargoDamageMaxPercent) }
        : {}),
      trailers: {
        ...("basis" in trailers ? { basis: oneOf("variant", "type")(trailers.basis) } : {}),
        mode: oneOf("any", "selected")(trailers.mode),
        typeIds: distinctList(trailers.typeIds, 100, id),
      },
      adr: {
        mode: oneOf("forbidden", "selected", "any")(adr.mode),
        classes: distinctList(adr.classes, 6, adrClass),
      },
      hardModeRequired: bool(limits.hardModeRequired),
    },
    conditions: {
      requiredTrips: nullable(trips)(conditions.requiredTrips),
      requiredDistanceM: nullable(amount)(conditions.requiredDistanceM),
    },
  };
}

function qualificationLevelContext(value: unknown): QualificationLevelContext {
  const input = auditObject(
    value,
    ["game", "name", "position", "changes", "transferLevelId", "before", "after"],
    invalidDetails,
  );
  const { name, position, changes } = input;
  levelName(name);
  levelPosition(position);
  if (
    !Array.isArray(changes) ||
    types.isProxy(changes) ||
    changes.length > 4 ||
    Reflect.ownKeys(changes).length !== changes.length + 1
  )
    return invalidDetails();
  const validated = Array.from({ length: changes.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(changes, i);
    if (!descriptor?.enumerable || !("value" in descriptor)) return invalidDetails();
    return levelChange(descriptor.value);
  });
  if (new Set(validated).size !== validated.length) return invalidDetails();
  return {
    game: game(input.game),
    name: name as string,
    position: position as number | null,
    changes: validated,
    transferLevelId: nullable(id)(input.transferLevelId),
    ...("before" in input ? { before: nullable(levelValues)(input.before) } : {}),
    ...("after" in input ? { after: nullable(levelValues)(input.after) } : {}),
  };
}

export function safeAuditContext(
  operation: (typeof auditOperations)[number],
  subject: (typeof auditSubjects)[number],
  raw: unknown,
): AuditContext | undefined {
  if (subject === "event" && operation === "configuration.changed") return eventContext(raw);
  if (
    subject === "catalog" &&
    (operation === "catalog.changed" ||
      operation === "catalog.imported" ||
      operation === "catalog.published")
  )
    return catalogContext(raw, operation === "catalog.imported");
  if (
    subject === "qualification_level" &&
    (qualificationLevelOperations as readonly string[]).includes(operation)
  )
    return qualificationLevelContext(raw);
  return undefined;
}
