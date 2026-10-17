// VTC-002 experiment only; VTC-005 owns production contracts.
const normalizeLabel = (value) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

export function resolveEntity(snapshot, query) {
  if (!query.game || !query.kind || !query.map) throw new Error('Game, kind and map are required');
  const scope = snapshot.entries.filter((entry) => entry.game === query.game
    && entry.kind === query.kind && entry.map === query.map
    && (!query.regionId || entry.regionId === query.regionId));
  let matches;
  if (query.sourceId !== undefined) {
    // Opaque source IDs are exact; an unknown supplied ID never falls back to a name.
    matches = scope.filter((entry) => entry.sourceId === query.sourceId);
  } else {
    if (!['en', 'ru'].includes(query.locale) || !query.label?.trim()) {
      return { status: 'unknown' };
    }
    const label = normalizeLabel(query.label);
    matches = scope.filter((entry) => [entry.labels[query.locale], ...(entry.aliases?.[query.locale] ?? [])]
      .filter(Boolean).some((candidate) => normalizeLabel(candidate) === label));
  }
  if (matches.length === 1) return { status: 'resolved', id: matches[0].id };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map((entry) => entry.id) };
  return { status: 'unknown' };
}

export function displayLabel(entry, locale) {
  const label = entry.labels[locale] || entry.labels.en || entry.sourceId;
  return { label, fallback: !entry.labels[locale] };
}

export function diffSnapshots(previous, next) {
  const before = new Map(previous.entries.map((entry) => [entry.id, entry]));
  const after = new Map(next.entries.map((entry) => [entry.id, entry]));
  const sameCoverage = JSON.stringify(previous.coverage) === JSON.stringify(next.coverage);
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id)
      && JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))),
    retirementCandidates: sameCoverage && next.coverageComplete ? removed : [],
    unverifiedMissing: sameCoverage && next.coverageComplete ? [] : removed,
  };
}

export function shipmentMassFacts(cargo, actualMassKg) {
  if (!Number.isFinite(actualMassKg) || actualMassKg < 0) throw new Error('Actual shipment mass is required');
  return { unitMassKg: cargo.unitMassKg, actualMassKg };
}
