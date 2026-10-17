import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDlcCoverage } from './dlc-coverage.mjs';

// Fictional release IDs and archive names; no Steam or local installation access.
const releases = [
  { game: 'ets2', appId: 1, title: 'Fixture map', releaseStatus: 'released' },
  { game: 'ets2', appId: 2, title: 'Fixture future pack', releaseStatus: 'upcoming' },
  { game: 'ats', appId: 3, title: 'Fixture cargo', releaseStatus: 'released' },
];
const mappings = [
  { game: 'ets2', appId: 1, archives: ['dlc_fixture_map.scs'] },
  { game: 'ats', appId: 3, archives: ['dlc_fixture_cargo.scs'] },
];
const inspections = [{ game: 'ets2', archive: 'dlc_fixture_map.scs', exitCode: 0 }];

test('unavailable released DLC remains a gap; upcoming packs do not imply a coverage failure', () => {
  const result = reconcileDlcCoverage(releases, mappings, inspections);
  assert.equal(result.rows[1].auditStatus, 'future-release');
  assert.equal(result.rows[2].auditStatus, 'archive-unavailable');
  assert.equal(result.summaries[0].availableArchiveCoverageComplete, true);
  assert.deepEqual(result.summaries[1].gaps, [3]);
  assert.equal(result.summaries[1].availableArchiveCoverageComplete, false);
});

test('an unmapped released pack cannot silently become a cosmetic exclusion', () => {
  const result = reconcileDlcCoverage(releases, [], inspections);
  assert.equal(result.rows[0].auditStatus, 'mapping-unverified');
  assert.equal(result.summaries[0].availableArchiveCoverageComplete, false);
});

test('failed inspection cannot be counted as verified absence of catalog entities', () => {
  const result = reconcileDlcCoverage(releases, mappings, [{ ...inspections[0], exitCode: 1 }]);
  assert.equal(result.rows[0].auditStatus, 'inspection-failed');
  assert.equal(result.summaries[0].inspected, 0);
});

test('a pack requiring two archives is incomplete if only one was inspected', () => {
  const result = reconcileDlcCoverage(releases, [{ ...mappings[0], archives: ['dlc_fixture_map.scs', 'dlc_fixture_extra.scs'] }], inspections);
  assert.equal(result.rows[0].auditStatus, 'archive-unavailable');
});

test('unknown release state, duplicate IDs and private path mappings cannot establish completeness', () => {
  const result = reconcileDlcCoverage([{ ...releases[0], releaseStatus: 'unknown' }], mappings, inspections);
  assert.equal(result.summaries[0].availableArchiveCoverageComplete, false);
  assert.throws(() => reconcileDlcCoverage([releases[0], releases[0]], mappings, inspections), /Duplicate/);
  assert.throws(() => reconcileDlcCoverage([releases[0]], [{ ...mappings[0], archives: ['private/path/dlc_fixture.scs'] }], inspections), /basenames/);
});
