import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { type AdmissionsConfig, admissionsSecurity } from "../../modules/admissions/security.js";
import { type CatalogConfig, validateCatalogConfig } from "../../modules/catalogs/artifact.js";
import { validateIdentityConfig } from "../../modules/identity/engine.js";
import { type ManualConfig, validateManualConfig } from "../../modules/manual-reports/service.js";
import { type MessagingConfig, validateMessagingConfig } from "../../modules/messaging/service.js";
import {
  type QualificationsConfig,
  validateQualificationsConfig,
} from "../../modules/qualifications/service.js";
import { type TelemetryConfig, validateTelemetryConfig } from "../../modules/telemetry/service.js";
import { type TripsConfig, validateTripsConfig } from "../../modules/trips/service.js";
import { rootsOverlap } from "../blob-storage/roots.js";
import { exactProxyAddress } from "../http/ingress.js";

const port = z.coerce.number().int().min(1).max(65535);
const settings = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: port.default(3000),
  SERVE_WEB: z.enum(["true", "false"]).default("false"),
  WEB_ROOT: z.string().min(1).default("apps/web/dist"),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: port,
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z
    .string()
    .min(16)
    .refine((value) => !value.startsWith("REPLACE_")),
});

export function readConfig(input: NodeJS.ProcessEnv = process.env) {
  const parsed = settings.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment fields: ${fields.join(", ")}`);
  }
  const env = parsed.data;
  let proxyAddress: string | undefined;
  if (input.API_TRUSTED_PROXY_IPV4 !== undefined) {
    try {
      proxyAddress = exactProxyAddress(input.API_TRUSTED_PROXY_IPV4);
    } catch {
      throw new Error("Invalid environment fields: API_TRUSTED_PROXY_IPV4");
    }
  }
  const enabled = input.IDENTITY_ENABLED === "true";
  if (input.IDENTITY_ENABLED !== undefined && !["true", "false"].includes(input.IDENTITY_ENABLED))
    throw new Error("Invalid environment fields: IDENTITY_ENABLED");
  const identity = enabled
    ? {
        secret: input.IDENTITY_SECRET ?? "",
        origin: input.IDENTITY_ORIGIN ?? "",
        production: env.NODE_ENV === "production",
      }
    : undefined;
  if (identity) {
    try {
      validateIdentityConfig(identity);
    } catch {
      throw new Error("Invalid environment fields: IDENTITY_SECRET, IDENTITY_ORIGIN");
    }
  }
  const mode = input.MAIL_MODE ?? "disabled";
  if (!["disabled", "local", "resend"].includes(mode))
    throw new Error("Invalid environment fields: MAIL_MODE");
  let mail: (MessagingConfig & { apiKey?: string }) | undefined;
  if (mode !== "disabled") {
    try {
      if (
        !identity ||
        (mode === "resend" &&
          (input.MAIL_TRACKING_DISABLED !== "true" ||
            !input.MAIL_API_KEY ||
            input.MAIL_API_KEY.startsWith("REPLACE_") ||
            /\s/.test(input.MAIL_API_KEY)))
      )
        throw new Error();
      mail = {
        mode: mode as "local" | "resend",
        key: input.MAIL_ENCRYPTION_KEY ?? "",
        sender: input.MAIL_SENDER ?? "",
        origin: identity.origin,
        production: env.NODE_ENV === "production",
        ...(mode === "resend" ? { apiKey: input.MAIL_API_KEY ?? "" } : {}),
      };
      validateMessagingConfig(mail);
    } catch {
      throw new Error(
        "Invalid environment fields: MAIL_MODE, MAIL_ENCRYPTION_KEY, MAIL_SENDER, MAIL_API_KEY, MAIL_TRACKING_DISABLED, IDENTITY_ENABLED",
      );
    }
  }
  let admissions: AdmissionsConfig | undefined;
  if (
    input.ADMISSIONS_ENABLED !== undefined &&
    !["true", "false"].includes(input.ADMISSIONS_ENABLED)
  )
    throw new Error("Invalid environment fields: ADMISSIONS_ENABLED");
  if (input.ADMISSIONS_ENABLED === "true") {
    try {
      if (!identity) throw new Error();
      admissions = { key: input.ADMISSIONS_ENCRYPTION_KEY ?? "", origin: identity.origin };
      admissionsSecurity(admissions);
      if (
        admissions.key === input.MAIL_ENCRYPTION_KEY ||
        admissions.key === identity.secret ||
        Buffer.from(admissions.key, "base64url").equals(Buffer.from(identity.secret, "hex")) ||
        Buffer.from(admissions.key, "base64url").equals(
          Buffer.from(input.MAIL_ENCRYPTION_KEY ?? "", "hex"),
        )
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid environment fields: ADMISSIONS_ENABLED, ADMISSIONS_ENCRYPTION_KEY, IDENTITY_ENABLED",
      );
    }
  }
  let catalogs: CatalogConfig | undefined;
  if (input.CATALOGS_ENABLED !== undefined && !["true", "false"].includes(input.CATALOGS_ENABLED))
    throw new Error("Invalid environment fields: CATALOGS_ENABLED");
  if (input.CATALOGS_ENABLED === "true") {
    try {
      if (!identity || ![undefined, "true", "false"].includes(input.CATALOGS_SYNTHETIC))
        throw new Error();
      const evidenceBytes = input.CATALOGS_EVIDENCE_FILE
        ? readFileSync(input.CATALOGS_EVIDENCE_FILE)
        : undefined;
      if (evidenceBytes && evidenceBytes.length > 1024 * 1024) throw new Error();
      catalogs = {
        production: env.NODE_ENV === "production",
        synthetic: input.CATALOGS_SYNTHETIC === "true",
        cursorKey: input.CATALOGS_CURSOR_KEY ?? "",
        maxFileBytes: Number(input.CATALOGS_MAX_FILE_BYTES),
        artifactTtlMs: Number(input.CATALOGS_ARTIFACT_TTL_MS),
        policyRevision: Number(input.CATALOGS_POLICY_REVISION),
        evidence: evidenceBytes ? JSON.parse(evidenceBytes.toString()) : [],
      };
      validateCatalogConfig(catalogs);
    } catch {
      throw new Error(
        "Invalid environment fields: CATALOGS_ENABLED, CATALOGS_SYNTHETIC, CATALOGS_CURSOR_KEY, CATALOGS_MAX_FILE_BYTES, CATALOGS_ARTIFACT_TTL_MS, CATALOGS_POLICY_REVISION, CATALOGS_EVIDENCE_FILE",
      );
    }
  }
  let trips: TripsConfig | undefined;
  if (input.TRIPS_ENABLED !== undefined && !["true", "false"].includes(input.TRIPS_ENABLED))
    throw new Error("Invalid environment fields: TRIPS_ENABLED");
  if (input.TRIPS_ENABLED === "true") {
    try {
      if (!identity) throw new Error();
      trips = { cursorKey: input.TRIPS_CURSOR_KEY ?? "" };
      validateTripsConfig(trips);
      if (
        trips.cursorKey === identity.secret ||
        trips.cursorKey === catalogs?.cursorKey ||
        trips.cursorKey === mail?.key ||
        (admissions &&
          Buffer.from(trips.cursorKey, "hex").equals(Buffer.from(admissions.key, "base64url")))
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid environment fields: TRIPS_ENABLED, TRIPS_CURSOR_KEY, IDENTITY_ENABLED",
      );
    }
  }
  let qualifications: QualificationsConfig | undefined;
  if (![undefined, "true", "false"].includes(input.QUALIFICATIONS_ENABLED))
    throw new Error("Invalid environment fields: QUALIFICATIONS_ENABLED");
  if (input.QUALIFICATIONS_ENABLED === "true") {
    try {
      if (!identity || !trips) throw new Error();
      qualifications = { cursorKey: input.QUALIFICATIONS_CURSOR_KEY ?? "" };
      validateQualificationsConfig(qualifications);
      if (
        [
          identity.secret,
          trips.cursorKey,
          catalogs?.cursorKey,
          mail?.key,
          input.TELEMETRY_CURSOR_KEY,
          input.MANUAL_REPORTS_KEY,
        ].includes(qualifications.cursorKey) ||
        (admissions &&
          Buffer.from(qualifications.cursorKey, "hex").equals(
            Buffer.from(admissions.key, "base64url"),
          ))
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid environment fields: QUALIFICATIONS_ENABLED, QUALIFICATIONS_CURSOR_KEY, IDENTITY_ENABLED, TRIPS_ENABLED",
      );
    }
  }
  let telemetry: TelemetryConfig | undefined;
  if (![undefined, "true", "false"].includes(input.TELEMETRY_ENABLED))
    throw new Error("Invalid environment fields: TELEMETRY_ENABLED");
  if (input.TELEMETRY_ENABLED === "true") {
    try {
      if (!identity || !trips || input.EXTERNAL_IDENTITIES_ENABLED !== "true") throw new Error();
      telemetry = {
        cursorKey: input.TELEMETRY_CURSOR_KEY ?? "",
        ipPerMinute: Number(input.TELEMETRY_IP_PER_MINUTE),
        globalPerMinute: Number(input.TELEMETRY_GLOBAL_PER_MINUTE),
      };
      validateTelemetryConfig(telemetry);
      if (
        [identity.secret, trips.cursorKey, catalogs?.cursorKey, mail?.key].includes(
          telemetry.cursorKey,
        ) ||
        (admissions &&
          Buffer.from(telemetry.cursorKey, "hex").equals(Buffer.from(admissions.key, "base64url")))
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid environment fields: TELEMETRY_ENABLED, TELEMETRY_CURSOR_KEY, TELEMETRY_IP_PER_MINUTE, TELEMETRY_GLOBAL_PER_MINUTE, IDENTITY_ENABLED, EXTERNAL_IDENTITIES_ENABLED, TRIPS_ENABLED",
      );
    }
  }
  let manualReports: ManualConfig | undefined;
  if (![undefined, "true", "false"].includes(input.MANUAL_REPORTS_ENABLED))
    throw new Error("Invalid environment fields: MANUAL_REPORTS_ENABLED");
  if (input.MANUAL_REPORTS_ENABLED === "true") {
    try {
      if (!identity || !trips || !catalogs) throw Error();
      manualReports = {
        key: input.MANUAL_REPORTS_KEY ?? "",
        maxFilesPerReport: Number(input.MANUAL_MAX_FILES_PER_REPORT),
        policyRevision: Number(input.MANUAL_POLICY_REVISION),
        orphanGraceMs: Number(input.MANUAL_ORPHAN_GRACE_MS),
        ...(input.MANUAL_EVIDENCE_ROOT
          ? {
              storage: {
                root: input.MANUAL_EVIDENCE_ROOT,
                maxFileBytes: Number(input.MANUAL_MAX_FILE_BYTES),
                maxPixels: Number(input.MANUAL_MAX_PIXELS),
                timeoutMs: Number(input.MANUAL_UPLOAD_TIMEOUT_MS),
              },
            }
          : {}),
      };
      validateManualConfig(manualReports);
      if (
        [
          identity.secret,
          trips.cursorKey,
          catalogs.cursorKey,
          telemetry?.cursorKey,
          qualifications?.cursorKey,
          mail?.key,
        ].includes(manualReports.key) ||
        (admissions &&
          Buffer.from(manualReports.key, "hex").equals(Buffer.from(admissions.key, "base64url")))
      )
        throw Error();
      if (manualReports.storage && rootsOverlap(manualReports.storage.root, env.WEB_ROOT))
        throw Error();
    } catch {
      throw new Error(
        "Invalid environment fields: MANUAL_REPORTS_ENABLED, MANUAL_REPORTS_KEY, MANUAL_MAX_FILES_PER_REPORT, MANUAL_POLICY_REVISION, MANUAL_ORPHAN_GRACE_MS, MANUAL_EVIDENCE_ROOT, MANUAL_MAX_FILE_BYTES, MANUAL_MAX_PIXELS, MANUAL_UPLOAD_TIMEOUT_MS, TRIPS_ENABLED, CATALOGS_ENABLED",
      );
    }
  }
  return {
    manualReports,
    qualifications,
    telemetry,
    trips,
    environment: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    serveWeb: env.SERVE_WEB === "true",
    webRoot: resolve(env.WEB_ROOT),
    proxyAddress,
    identity,
    mail,
    admissions,
    externalIdentities: (() => {
      if (
        input.EXTERNAL_IDENTITIES_ENABLED !== undefined &&
        !["true", "false"].includes(input.EXTERNAL_IDENTITIES_ENABLED)
      )
        throw new Error("Invalid environment fields: EXTERNAL_IDENTITIES_ENABLED");
      if (input.EXTERNAL_IDENTITIES_ENABLED === "true" && !identity)
        throw new Error(
          "Invalid environment fields: EXTERNAL_IDENTITIES_ENABLED, IDENTITY_ENABLED",
        );
      return input.EXTERNAL_IDENTITIES_ENABLED === "true";
    })(),
    catalogs,
    database: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: env.MYSQL_DATABASE,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
    },
  };
}
