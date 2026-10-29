// Existing public contract examples; never provider data or launch configuration.
const startedTemplate = {
  contract: {
    major: 1,
    minor: 0,
  },
  producer: {
    application: "ets2telemetry",
    version: "0.0.0-contract-fixture",
  },
  eventId: "00000100-0000-0000-0000-000000000001",
  revision: 1,
  installationId: "00000200-0000-0000-0000-000000000001",
  bindingId: "00000300-0000-0000-0000-000000000001",
  source: {
    provider: "ets2telemetry",
    game: "ets2",
    tripId: "00000400-0000-0000-0000-000000000001",
    pluginSessionId: "00000500-0000-0000-0000-000000000001",
    databaseUuid: "00000600-0000-0000-0000-000000000001",
    origin: "game",
  },
  delivery: {
    mode: "live",
    syncRunId: "00000700-0000-0000-0000-000000000001",
  },
  type: "trip.started",
  createdUtcMs: 1792227600000,
  snapshot: {
    outcome: "open",
    closeReason: null,
    recordingCompleteness: "unknown",
    start: {
      utcMs: 1792227600000,
      basis: "event",
      eventSeq: "9007199254740993",
    },
    end: null,
    openedBy: "event",
    openedEventSeq: "9007199254740993",
    checkpointNextEventSeq: null,
    outcomeEventSeq: null,
    context: {
      gameBuild: {
        available: false,
        reason: "not-observed",
      },
      sourceLocale: {
        available: false,
        reason: "not-observed",
      },
      mapId: {
        available: true,
        value: "official",
      },
      dlcIds: {
        available: false,
        reason: "not-observed",
      },
      versions: {
        nativeProtocol: {
          major: 1,
          minor: 0,
        },
        sdkArchive: {
          available: true,
          value: "scs-sdk-1.15",
        },
        telemetryApi: {
          available: true,
          value: {
            major: 1,
            minor: 0,
          },
        },
        gameTelemetryApi: {
          available: true,
          value: {
            major: 1,
            minor: 0,
          },
        },
      },
    },
    gameMode: {
      mode: "unknown",
      method: "none",
      confidence: "none",
      ambiguous: false,
    },
    job: {
      origin: {
        cityId: {
          available: true,
          value: "fixture_north",
        },
        cityName: {
          available: true,
          value: "Example North",
        },
        companyId: {
          available: true,
          value: "fixture_depot_a",
        },
        companyName: {
          available: true,
          value: "Example Depot A",
        },
      },
      destination: {
        cityId: {
          available: true,
          value: "fixture_south",
        },
        cityName: {
          available: true,
          value: "Example South",
        },
        companyId: {
          available: true,
          value: "fixture_depot_b",
        },
        companyName: {
          available: true,
          value: "Example Depot B",
        },
      },
      cargoId: {
        available: true,
        value: "fixture_crates",
      },
      cargoName: {
        available: true,
        value: "Example Crates",
      },
      cargoMass: {
        available: true,
        value: 18000,
        unit: "kg",
      },
      cargoUnitMass: {
        available: true,
        value: 900,
        unit: "kg",
      },
      cargoUnitCount: {
        available: true,
        value: 20,
      },
      market: {
        available: true,
        value: "fixture_market",
      },
      isSpecialJob: {
        available: true,
        value: false,
      },
      cargoLoaded: {
        available: true,
        value: true,
      },
    },
    trailers: {
      complete: true,
      items: [
        {
          index: 0,
          id: {
            available: true,
            value: "fixture_trailer",
          },
          bodyType: {
            available: true,
            value: "fixture_box",
          },
          chainType: {
            available: true,
            value: "fixture_single",
          },
        },
      ],
    },
    plannedDistance: {
      available: true,
      value: 120000,
      unit: "m",
    },
    observedDistance: {
      available: true,
      value: 0,
      unit: "m",
    },
    deliveredDistance: {
      available: false,
      reason: "not-observed",
      unit: "m",
    },
    fuelUsed: {
      available: true,
      value: 0,
      unit: "L",
    },
    cargoDamage: {
      available: false,
      reason: "not-observed",
      unit: "fraction",
    },
    expectedIncome: {
      available: true,
      value: {
        raw: "10000",
        sdkType: "u64",
        currency: {
          status: "unknown",
        },
      },
    },
    revenue: {
      available: false,
      reason: "not-observed",
    },
    penalty: {
      available: false,
      reason: "not-observed",
    },
    evidence: {
      startObserved: true,
      endObserved: false,
      ruleContextComplete: true,
      clockAnomaly: false,
      reasons: [],
    },
  },
};

const completedTemplate = {
  contract: {
    major: 1,
    minor: 0,
  },
  producer: {
    application: "ets2telemetry",
    version: "0.0.0-contract-fixture",
  },
  eventId: "00000101-0000-0000-0000-000000000001",
  revision: 2,
  installationId: "00000200-0000-0000-0000-000000000001",
  bindingId: "00000300-0000-0000-0000-000000000001",
  source: {
    provider: "ets2telemetry",
    game: "ets2",
    tripId: "00000400-0000-0000-0000-000000000001",
    pluginSessionId: "00000500-0000-0000-0000-000000000001",
    databaseUuid: "00000600-0000-0000-0000-000000000001",
    origin: "game",
  },
  delivery: {
    mode: "live",
    syncRunId: "00000700-0000-0000-0000-000000000001",
  },
  type: "trip.completed",
  createdUtcMs: 1792231200000,
  snapshot: {
    outcome: "delivered",
    closeReason: "outcome",
    recordingCompleteness: "complete",
    start: {
      utcMs: 1792227600000,
      basis: "event",
      eventSeq: "9007199254740993",
    },
    end: {
      utcMs: 1792231200000,
      basis: "event",
      eventSeq: "9007199254740999",
    },
    openedBy: "event",
    openedEventSeq: "9007199254740993",
    checkpointNextEventSeq: null,
    outcomeEventSeq: "9007199254740999",
    context: {
      gameBuild: {
        available: false,
        reason: "not-observed",
      },
      sourceLocale: {
        available: false,
        reason: "not-observed",
      },
      mapId: {
        available: true,
        value: "official",
      },
      dlcIds: {
        available: false,
        reason: "not-observed",
      },
      versions: {
        nativeProtocol: {
          major: 1,
          minor: 0,
        },
        sdkArchive: {
          available: true,
          value: "scs-sdk-1.15",
        },
        telemetryApi: {
          available: true,
          value: {
            major: 1,
            minor: 0,
          },
        },
        gameTelemetryApi: {
          available: true,
          value: {
            major: 1,
            minor: 0,
          },
        },
      },
    },
    gameMode: {
      mode: "unknown",
      method: "none",
      confidence: "none",
      ambiguous: false,
    },
    job: {
      origin: {
        cityId: {
          available: true,
          value: "fixture_north",
        },
        cityName: {
          available: true,
          value: "Example North",
        },
        companyId: {
          available: true,
          value: "fixture_depot_a",
        },
        companyName: {
          available: true,
          value: "Example Depot A",
        },
      },
      destination: {
        cityId: {
          available: true,
          value: "fixture_south",
        },
        cityName: {
          available: true,
          value: "Example South",
        },
        companyId: {
          available: true,
          value: "fixture_depot_b",
        },
        companyName: {
          available: true,
          value: "Example Depot B",
        },
      },
      cargoId: {
        available: true,
        value: "fixture_crates",
      },
      cargoName: {
        available: true,
        value: "Example Crates",
      },
      cargoMass: {
        available: true,
        value: 18000,
        unit: "kg",
      },
      cargoUnitMass: {
        available: true,
        value: 900,
        unit: "kg",
      },
      cargoUnitCount: {
        available: true,
        value: 20,
      },
      market: {
        available: true,
        value: "fixture_market",
      },
      isSpecialJob: {
        available: true,
        value: false,
      },
      cargoLoaded: {
        available: true,
        value: true,
      },
    },
    trailers: {
      complete: true,
      items: [
        {
          index: 0,
          id: {
            available: true,
            value: "fixture_trailer",
          },
          bodyType: {
            available: true,
            value: "fixture_box",
          },
          chainType: {
            available: true,
            value: "fixture_single",
          },
        },
      ],
    },
    plannedDistance: {
      available: true,
      value: 120000,
      unit: "m",
    },
    observedDistance: {
      available: true,
      value: 123400,
      unit: "m",
    },
    deliveredDistance: {
      available: true,
      value: 123400,
      unit: "m",
    },
    fuelUsed: {
      available: true,
      value: 38.5,
      unit: "L",
    },
    cargoDamage: {
      available: true,
      value: 0,
      unit: "fraction",
    },
    expectedIncome: {
      available: true,
      value: {
        raw: "10000",
        sdkType: "u64",
        currency: {
          status: "unknown",
        },
      },
    },
    revenue: {
      available: true,
      value: {
        raw: "9800",
        sdkType: "s64",
        currency: {
          status: "unknown",
        },
      },
    },
    penalty: {
      available: false,
      reason: "not-observed",
    },
    evidence: {
      startObserved: true,
      endObserved: true,
      ruleContextComplete: true,
      clockAnomaly: false,
      reasons: [],
    },
  },
};

export type AcceptanceSourceKind = "fresh" | "backfill" | "unknown" | "delayed" | "completed";
export function acceptanceSourceStream(
  kind: AcceptanceSourceKind,
  at: number,
  identity: { installationId: string; bindingId: string },
) {
  return {
    ...identity,
    // A one-second fictional trip keeps terminal-first evidence chronologically valid and fresh.
    startedUtcMs:
      at - (kind === "completed" ? 1000 : kind === "delayed" || kind === "backfill" ? 180000 : 0),
  };
}
export function acceptanceSourcePayload(
  kind: AcceptanceSourceKind,
  at: number,
  ids: { sourceId: string; eventId: string } & ReturnType<typeof acceptanceSourceStream>,
) {
  const base = structuredClone(kind === "completed" ? completedTemplate : startedTemplate);
  return {
    ...base,
    eventId: ids.eventId,
    createdUtcMs: at,
    installationId: ids.installationId,
    bindingId: ids.bindingId,
    source: { ...base.source, tripId: ids.sourceId, pluginSessionId: ids.sourceId },
    delivery: { ...base.delivery, mode: kind === "backfill" ? "backfill" : "live" },
    snapshot: {
      ...base.snapshot,
      start: {
        ...base.snapshot.start,
        utcMs: kind === "unknown" ? null : ids.startedUtcMs,
        basis: kind === "unknown" ? "unknown" : "event",
        eventSeq: kind === "unknown" ? null : base.snapshot.start.eventSeq,
      },
      ...(base.snapshot.end ? { end: { ...base.snapshot.end, utcMs: at } } : {}),
    },
  };
}
