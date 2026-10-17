import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { drizzle } from 'drizzle-orm/mysql2';
import { mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { eq } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { build } from 'vite';
import * as authSchema from './auth-schema.mjs';

assert.equal(process.versions.node, '24.22.0');
const checks = [];
const app = Fastify({ logger: false });
app.get('/probe', { schema: { response: { 200: {
  type: 'object', required: ['ok'], additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
} } } }, async () => ({ ok: true }));
const response = await app.inject('/probe');
assert.equal(response.statusCode, 200);
assert.deepEqual(response.json(), { ok: true });
await app.close();
checks.push('fastify-request-response');

// The mock dialect proves SQL generation only. It never creates a database connection.
const probeTable = mysqlTable('synthetic_probe', { id: varchar('id', { length: 36 }).primaryKey() });
const db = drizzle.mock({ schema: authSchema, mode: 'default' });
const query = db.select().from(probeTable).where(eq(probeTable.id, '41000000-0000-4000-8000-000000000001')).toSQL();
assert.match(query.sql, /`synthetic_probe`/);
assert.equal(query.params.length, 1);
checks.push('drizzle-mysql-sql-generation');

const auth = betterAuth({
  baseURL: 'https://example.invalid',
  secret: randomBytes(48).toString('base64url'),
  database: drizzleAdapter(db, { provider: 'mysql', schema: authSchema }),
  emailAndPassword: { enabled: true, autoSignIn: false },
  disabledPaths: ['/sign-up/email'],
  telemetry: { enabled: false },
});
const context = await auth.$context;
assert.equal(context.options.emailAndPassword.autoSignIn, false);
assert.equal(typeof context.adapter.create, 'function');
const syntheticPassword = randomBytes(24).toString('base64url');
const syntheticHash = await context.password.hash(syntheticPassword);
assert.equal(await context.password.verify({ hash: syntheticHash, password: syntheticPassword }), true);
assert.equal(await context.password.verify({ hash: syntheticHash, password: syntheticPassword + '-wrong' }), false);
const rejected = await auth.handler(new Request('https://example.invalid/api/auth/sign-up/email', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.invalid' },
  body: JSON.stringify({ name: 'Synthetic Member', email: 'probe@example.invalid', password: randomBytes(24).toString('base64url') }),
}));
assert.equal(rejected.status, 404);
checks.push('better-auth-mysql-adapter-init-and-disabled-http-signup');

assert.equal(renderToStaticMarkup(React.createElement('p', null, 'Synthetic probe')), '<p>Synthetic probe</p>');
const queryClient = new QueryClient();
queryClient.setQueryData(['synthetic'], { ok: true });
assert.equal(queryClient.getQueryData(['synthetic']).ok, true);
queryClient.clear();
assert.equal(z.object({ id: z.string().uuid() }).safeParse({ id: '41000000-0000-4000-8000-000000000001' }).success, true);
checks.push('react-query-zod-runtime');

const root = await mkdtemp(join(tmpdir(), 'vtc005-probe-'));
try {
  await writeFile(join(root, 'index.html'), '<main>Synthetic build probe</main><script type="module" src="/entry.js"></script>');
  await writeFile(join(root, 'entry.js'), 'document.querySelector("main").dataset.ready = "true";');
  const result = await build({ root, configFile: false, logLevel: 'silent', build: { write: false } });
  assert.ok(result.output.some(item => item.type === 'chunk'));
  checks.push('vite-production-bundle');
} finally {
  // mkdtemp returned this exact, newly created probe directory; no user path is accepted.
  assert.equal(resolve(root).startsWith(join(resolve(tmpdir()), 'vtc005-probe-')), true);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify({ node: process.versions.node, checks, realDatabase: false, hosted: false }) + '\n');
