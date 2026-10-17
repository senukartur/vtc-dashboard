// Reconcile a public release inventory with explicit archive mappings and local
// inspection evidence. This does not infer licence ownership or publish game data.
export function reconcileDlcCoverage(releases, mappings, inspections) {
  const seen = new Set();
  const result = releases.map((release) => {
    const key = `${release.game}:${release.appId}`;
    if (seen.has(key)) throw new Error('Duplicate release identity');
    seen.add(key);
    if (!['ets2', 'ats'].includes(release.game) || !Number.isSafeInteger(release.appId)
      || !release.title || !['released', 'upcoming', 'unknown'].includes(release.releaseStatus)) {
      throw new Error('Unverified release metadata');
    }
    if (release.releaseStatus !== 'released') {
      return { ...release, archives: [], auditStatus: release.releaseStatus === 'upcoming' ? 'future-release' : 'release-unverified' };
    }
    const mapping = mappings.find((item) => item.game === release.game && item.appId === release.appId);
    if (!mapping?.archives?.length) return { ...release, archives: [], auditStatus: 'mapping-unverified' };
    if (mapping.archives.some((archive) => !/^dlc_[a-z0-9_]+\.scs$/u.test(archive))) {
      throw new Error('Archive mappings must use basenames only');
    }
    const evidence = mapping.archives.map((archive) => inspections.find((item) => item.game === release.game && item.archive === archive));
    const auditStatus = evidence.some((item) => !item) ? 'archive-unavailable'
      : evidence.some((item) => item.exitCode !== 0) ? 'inspection-failed' : 'archive-inspected';
    return { ...release, archives: [...mapping.archives], auditStatus };
  });
  const summaries = ['ets2', 'ats'].map((game) => {
    const rows = result.filter((item) => item.game === game);
    const released = rows.filter((item) => item.releaseStatus === 'released');
    return { game, listed: rows.length, released: released.length,
      upcoming: rows.filter((item) => item.releaseStatus === 'upcoming').length,
      inspected: released.filter((item) => item.auditStatus === 'archive-inspected').length,
      gaps: rows.filter((item) => !['future-release', 'archive-inspected'].includes(item.auditStatus)).map((item) => item.appId),
      availableArchiveCoverageComplete: released.length > 0
        && released.every((item) => item.auditStatus === 'archive-inspected')
        && rows.every((item) => item.releaseStatus !== 'unknown'),
    };
  });
  return { rows: result, summaries };
}
