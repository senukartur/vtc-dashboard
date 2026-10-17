// All places, translations, source tokens, DLCs and builds below are fictional.
// These fixtures are NOT extracted game data or production qualification limits.
const entry = (id, game, kind, sourceId, en, ru, extra = {}) => ({
  id, game, kind, map: 'stock', sourceId, labels: { en, ...(ru ? { ru } : {}) }, ...extra,
});

export function syntheticCatalogs() {
  const previous = {
    revision: 'synthetic-1',
    gameBuilds: { ets2: 'fixture-build-1', ats: 'fixture-build-1' },
    coverage: { ets2: ['fixture-base', 'fixture-dlc-a'], ats: ['fixture-base'] },
    coverageComplete: true,
    provenance: { source: 'project-authored synthetic fixtures', redistributable: true },
    entries: [
      entry('region-eu-a', 'ets2', 'region', 'region.fixture_a', 'Fixture region A', 'Учебный регион A'),
      entry('region-eu-b', 'ets2', 'region', 'region.fixture_b', 'Fixture region B', 'Учебный регион B'),
      entry('region-us-a', 'ats', 'region', 'region.fixture_a', 'Fixture state A', 'Учебный штат A'),
      entry('city-eu-a', 'ets2', 'city', 'city.fixture_north', 'Northport', 'Нортпорт', { regionId: 'region-eu-a' }),
      entry('city-eu-b', 'ets2', 'city', 'city.fixture_north_b', 'Northport', 'Нортпорт', { regionId: 'region-eu-b' }),
      entry('city-us-a', 'ats', 'city', 'city.fixture_north', 'Northport', 'Нортпорт', { regionId: 'region-us-a' }),
      entry('cargo-eu-a', 'ets2', 'cargo', 'cargo.fixture_solution', 'Fixture solution', 'Учебный раствор',
        { unitMassKg: 125, hazardousClass: 8, allowedBodySourceIds: ['body.fixture_tank'], dlcs: ['fixture-dlc-a'] }),
      entry('cargo-us-a', 'ats', 'cargo', 'cargo.fixture_solution', 'Fixture solution', undefined,
        { unitMassKg: 150, hazardousClass: null, allowedBodySourceIds: ['body.fixture_box'], dlcs: ['fixture-base'] }),
      entry('body-eu-a', 'ets2', 'trailerBody', 'body.fixture_tank', 'Fixture tank', 'Учебная цистерна'),
      entry('body-us-a', 'ats', 'trailerBody', 'body.fixture_box', 'Fixture box', 'Учебный фургон'),
      entry('chain-eu-a', 'ets2', 'trailerChain', 'chain.fixture_single', 'Fixture single', 'Учебная одиночная'),
      entry('chain-us-a', 'ats', 'trailerChain', 'chain.fixture_single', 'Fixture single', 'Учебная одиночная'),
    ],
  };
  const next = structuredClone(previous);
  next.revision = 'synthetic-2';
  next.gameBuilds.ets2 = 'fixture-build-2';
  next.entries = next.entries.filter((item) => item.id !== 'city-eu-b');
  next.entries.find((item) => item.id === 'cargo-eu-a').unitMassKg = 130;
  next.entries.push(entry('city-eu-new', 'ets2', 'city', 'city.fixture_new', 'Newport', 'Ньюпорт',
    { regionId: 'region-eu-a', dlcs: ['fixture-dlc-a'] }));
  return { previous, next };
}
