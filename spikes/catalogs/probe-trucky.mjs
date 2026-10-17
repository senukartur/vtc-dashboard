import { createHash } from 'node:crypto';

// Explicit, infrequent research probe: two public GETs, no credentials or retry loop.
// Never call this from unit tests, per user session, or on each form render.
try {
  for (const game of ['ets2', 'ats']) {
    const url = `https://api.truckyapp.com/v2/map/cities/${game}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: {
      'User-Agent': 'VTCDashboard-Catalog-Research/0.1 (+https://github.com/senukartur/vtc-dashboard)',
      Accept: 'application/json',
    } });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}; stop and respect any retry instructions`);
    const data = await response.json();
    if (!Array.isArray(data.response)) throw new Error('Unexpected provider response shape');
    const cities = data.response;
    console.log(JSON.stringify({ game, url, observedAt: new Date().toISOString(), httpStatus: response.status,
      count: cities.length,
      missingOrEmptyGameId: cities.filter((city) => typeof city.in_game_id !== 'string' || !city.in_game_id.trim()).length,
      fields: [...new Set(cities.flatMap((city) => Object.keys(city)))].sort(),
      dlcLabels: [...new Set(cities.map((city) => city.dlc))].sort(),
      etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'),
      jsonSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    }, null, 2));
  }
} catch (error) {
  console.error(`Public catalog probe failed: ${error.message}`);
  process.exitCode = 1;
}
