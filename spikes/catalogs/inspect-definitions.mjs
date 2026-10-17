import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Read-only inventory of an extracted archive's def directory. This deliberately
// does not expand includes, emulate the game's mount order, or publish a catalog.
const [game, root] = process.argv.slice(2);
if (!['ets2', 'ats'].includes(game) || !root) {
  console.error('Usage: node inspect-definitions.mjs <ets2|ats> <extracted-def-directory>');
  process.exit(1);
}
try {
  const result = { game, candidateUnits: { city: 0, cargo: 0, trailerDefinition: 0 },
    bodyTypes: [], chainTypes: [], adrClasses: [], localizationReferences: 0, registryIncludes: {} };
  const bodies = new Set(); const chains = new Set(); const adr = new Set();
  const digest = createHash('sha256');
  for (const [directory, unit, kind] of [
    ['city', 'city_data', 'city'], ['cargo', 'cargo_data', 'cargo'],
    ['vehicle/trailer_defs', 'trailer_def', 'trailerDefinition'],
  ]) {
    let files;
    try { files = await readdir(join(root, directory), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (!file.isFile() || !/\.(sii|sui)$/u.test(file.name)) continue;
      const content = await readFile(join(root, directory, file.name), 'utf8');
      digest.update(`${directory}/${file.name}\0`).update(content).update('\0');
      result.candidateUnits[kind] += [...content.matchAll(new RegExp(`^\\s*${unit}\\s*:`, 'gm'))].length;
      for (const match of content.matchAll(/^\s*body_type:\s*(\w+)/gmu)) bodies.add(match[1]);
      for (const match of content.matchAll(/^\s*chain_type:\s*(\w+)/gmu)) chains.add(match[1]);
      for (const match of content.matchAll(/^\s*adr_class:\s*(\d+)/gmu)) adr.add(Number(match[1]));
      result.localizationReferences += [...content.matchAll(/(?:city_name_localized|\bname):\s*"@@/gu)].length;
    }
  }
  for (const file of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!file.isFile() || !/^(city|cargo)(\.[\w_]+)?\.sii$/u.test(file.name)) continue;
    const content = await readFile(join(root, file.name), 'utf8');
    digest.update(`${file.name}\0`).update(content).update('\0');
    result.registryIncludes[file.name] = [...content.matchAll(/^@include\s+"[^"]+"/gmu)].length;
  }
  if (Object.values(result.candidateUnits).every((count) => count === 0)) {
    throw new Error('No candidate definition units found');
  }
  result.bodyTypes = [...bodies].sort(); result.chainTypes = [...chains].sort();
  result.adrClasses = [...adr].sort((a, b) => a - b);
  result.inspectedSubsetSha256 = digest.digest('hex');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not echo local installation paths into reports intended for public Git.
  console.error(`Definition inventory failed (${error.code ?? 'invalid-subset'}). Check inputs locally.`);
  process.exitCode = 1;
}
