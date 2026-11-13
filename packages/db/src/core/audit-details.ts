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
