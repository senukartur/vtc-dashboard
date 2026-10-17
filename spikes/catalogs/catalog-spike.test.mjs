import test from 'node:test';
import assert from 'node:assert/strict';
import { displayLabel, resolveEntity, diffSnapshots, shipmentMassFacts } from './catalog-spike.mjs';
import { syntheticCatalogs } from './synthetic-catalog.mjs';

const { previous, next } = syntheticCatalogs();
const cityQuery = { game: 'ets2', kind: 'city', map: 'stock', regionId: 'region-eu-a' };

test('RU and EN names resolve to the same identity without changing facts', () => {
  const en = resolveEntity(previous, { ...cityQuery, label: '  NORTHPORT  ', locale: 'en' });
  const ru = resolveEntity(previous, { ...cityQuery, label: 'Нортпорт', locale: 'ru' });
  assert.deepEqual(en, { status: 'resolved', id: 'city-eu-a' });
  assert.deepEqual(ru, en);
});

test('same names in different regions are ambiguous without context', () => {
  const { regionId, ...withoutRegion } = cityQuery;
  assert.deepEqual(resolveEntity(previous, { ...withoutRegion, label: 'Northport', locale: 'en' }),
    { status: 'ambiguous', candidates: ['city-eu-a', 'city-eu-b'] });
});

test('same source token in ETS2 and ATS remains scoped to its game', () => {
  const sourceId = 'city.fixture_north';
  assert.equal(resolveEntity(previous, { ...cityQuery, sourceId }).id, 'city-eu-a');
  assert.equal(resolveEntity(previous, { game: 'ats', kind: 'city', map: 'stock', sourceId }).id, 'city-us-a');
});

test('source tokens stay exact and unknown IDs never use a supplied label to pass', () => {
  for (const sourceId of ['CITY.fixture_north', 'city.fixture_north ', 'city.new_dlc']) {
    assert.deepEqual(resolveEntity(previous, { ...cityQuery, sourceId, label: 'Northport', locale: 'en' }),
      { status: 'unknown' });
  }
});

test('unknown maps, kinds and untranslated aliases do not cross-match', () => {
  assert.deepEqual(resolveEntity(previous, { ...cityQuery, map: 'fixture-mod', sourceId: 'city.fixture_north' }), { status: 'unknown' });
  assert.deepEqual(resolveEntity(previous, { ...cityQuery, kind: 'cargo', sourceId: 'city.fixture_north' }), { status: 'unknown' });
  assert.deepEqual(resolveEntity(previous, { ...cityQuery, label: 'Нортпорт', locale: 'en' }), { status: 'unknown' });
});

test('missing RU label is an explicit display fallback, not a fabricated alias', () => {
  const cargo = previous.entries.find((item) => item.id === 'cargo-us-a');
  assert.deepEqual(displayLabel(cargo, 'ru'), { label: 'Fixture solution', fallback: true });
  assert.deepEqual(resolveEntity(previous, { game: 'ats', kind: 'cargo', map: 'stock', locale: 'ru', label: 'Учебный раствор' }), { status: 'unknown' });
});

test('candidate snapshot shows additions, fact changes and retirement for review', () => {
  assert.deepEqual(diffSnapshots(previous, next), { added: ['city-eu-new'], changed: ['cargo-eu-a'],
    retirementCandidates: ['city-eu-b'], unverifiedMissing: [] });
  assert.equal(resolveEntity(previous, { ...cityQuery, sourceId: 'city.fixture_new' }).status, 'unknown');
  assert.equal(resolveEntity(next, { ...cityQuery, sourceId: 'city.fixture_new' }).id, 'city-eu-new');
  assert.equal(previous.entries.find((item) => item.id === 'cargo-eu-a').unitMassKg, 125);
});

test('missing DLC or incomplete extraction cannot be called entity retirement', () => {
  const incomplete = structuredClone(next);
  incomplete.coverageComplete = false;
  assert.deepEqual(diffSnapshots(previous, incomplete).retirementCandidates, []);
  assert.deepEqual(diffSnapshots(previous, incomplete).unverifiedMissing, ['city-eu-b']);
  const differentScope = structuredClone(next);
  differentScope.coverage.ets2 = ['fixture-base'];
  assert.deepEqual(diffSnapshots(previous, differentScope).unverifiedMissing, ['city-eu-b']);
});

test('actual shipment mass stays independent of catalog unit mass', () => {
  const cargo = previous.entries.find((item) => item.id === 'cargo-eu-a');
  assert.deepEqual(shipmentMassFacts(cargo, 17500), { unitMassKg: 125, actualMassKg: 17500 });
  assert.throws(() => shipmentMassFacts(cargo, undefined), /required/);
});
