import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { openDatabase, migrate } from '../scripts/database.mjs';
import { seedLocal } from '../scripts/seed-local.mjs';
import { routeRequest, createAppServer } from '../scripts/serve.mjs';
import { assertRegularInput, assertSourceTree } from '../scripts/public-input.mjs';

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'fieldnote-m2-runtime-'));
  let db = openDatabase(resolve(directory, 'persisted.sqlite'));
  await seedLocal(db);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, get db() { return db; }, reopen() { db.close(); db = openDatabase(resolve(directory, 'persisted.sqlite')); return db; } };
}
test('SQLite data survives a real close/reopen, migrations and repeated clean seed', async t => {
  const f = await fixture(t);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS count FROM games').get().count, 36);
  f.db.raw.prepare('UPDATE ui_settings SET monthly_budget_usd = 17, compact_tables = 1 WHERE id = 1').run();
  f.reopen();
  assert.equal(f.db.raw.prepare('SELECT monthly_budget_usd AS budget FROM ui_settings').get().budget, 17);
  assert.deepEqual(migrate(f.db), []);
  await seedLocal(f.db); await seedLocal(f.db);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS count FROM games').get().count, 36);
  assert.equal(f.db.raw.prepare('SELECT monthly_budget_usd AS budget FROM ui_settings').get().budget, 17);
  assert.deepEqual(f.db.raw.prepare('PRAGMA foreign_key_check').all(), []);
});
test('D1 transaction adapter rolls back every preceding statement on failure', async t => {
  const f = await fixture(t);
  await assert.rejects(f.db.batch([f.db.prepare('UPDATE ui_settings SET monthly_budget_usd = ? WHERE id = 1').bind(13), f.db.prepare('INSERT INTO games(appid) VALUES(-1)') ]));
  assert.equal(f.db.raw.prepare('SELECT monthly_budget_usd AS budget FROM ui_settings').get().budget, 30);
});
test('only explicit public files are served, with browser security headers', async t => {
  const f = await fixture(t);
  const response = await routeRequest(new Request('http://localhost/'), { DB: f.db });
  assert.equal(response.status, 200); assert.match(await response.text(), /\/assets\/app\.js/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  for (const path of ['/.env', '/.env.local', '/package.json', '/seed/snapshot.json', '/scripts/serve.mjs', '/backend/worker.ts', '/.data/fieldnote.sqlite', '/src/main.tsx', '/build/worker.mjs', '/assets/missing.js', '/%2e%2e/.env', '/%252e%252e/.env', '/assets%5capp.js', '/%00']) {
    const denied = await routeRequest(new Request('http://localhost/'), { DB: f.db }, { rawPath: path });
    assert.equal(denied.status, 404, path);
  }
});
test('static HEAD is bodyless, writes rejected, current roadmap downloadable', async t => {
  const f = await fixture(t);
  assert.equal((await routeRequest(new Request('http://localhost/assets/app.js', { method: 'HEAD' }), { DB: f.db })).status, 200);
  assert.equal(await (await routeRequest(new Request('http://localhost/assets/app.js', { method: 'HEAD' }), { DB: f.db })).text(), '');
  assert.equal((await routeRequest(new Request('http://localhost/', { method: 'POST' }), { DB: f.db })).status, 405);
  const doc = await routeRequest(new Request('http://localhost/docs/roadmap.docx'), { DB: f.db });
  assert.equal(doc.status, 200); assert.ok((await doc.arrayBuffer()).byteLength > 10000);
});
test('public symlinks cannot expose files even with an allowlisted filename', async t => {
  const f = await fixture(t);
  const root = resolve(f.directory, 'public'); await mkdir(root);
  const secret = resolve(f.directory, 'synthetic-private.txt'); await writeFile(secret, 'TEST FIXTURE ONLY');
  await symlink(secret, resolve(root, 'index.html'));
  const response = await routeRequest(new Request('http://localhost/'), { DB: f.db }, { publicRoot: root });
  assert.equal(response.status, 404);
});
test('build input guards reject allowlisted-file and ancestor symlinks before copying private bytes', async t => {
  const f = await fixture(t);
  const root = resolve(f.directory, 'build-fixture'); await mkdir(resolve(root, 'public/docs'), { recursive: true });
  await writeFile(resolve(root, 'private-fixture.txt'), 'SYNTHETIC TEST SECRET; NEVER A REAL CREDENTIAL');
  await symlink(resolve(root, 'private-fixture.txt'), resolve(root, 'public/docs/roadmap.docx'));
  await assert.rejects(assertRegularInput(root, 'public/docs/roadmap.docx'), /symlink/);
  await symlink(resolve(root, 'private-fixture.txt'), resolve(root, 'index.html'));
  await assert.rejects(assertRegularInput(root, 'index.html'), /symlink/);
  await mkdir(resolve(root, 'real-src')); await symlink(resolve(root, 'real-src'), resolve(root, 'src'));
  await assert.rejects(assertSourceTree(root, 'src'), /real directory/);
});
test('real local HTTP server returns DB-backed data and rejects oversized bodies', async t => {
  const f = await fixture(t);
  const server = createAppServer(f.db); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const data = await (await fetch(`${origin}/api/snapshot`)).json(); assert.equal(data.games.length, 36);
  assert.equal((await fetch(`${origin}/.env.local`)).status, 404);
  assert.equal((await fetch(`${origin}/api/settings`, { method: 'PATCH', body: 'x'.repeat(8193), headers: { 'content-type': 'application/json' } })).status, 413);
});
test('release frontend has no executable remote imports or embedded secret configuration', async () => {
  const js = await readFile(new URL('../dist/assets/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /TWITCH_CLIENT_SECRET|IGDB_CLIENT_SECRET|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|BEGIN PRIVATE KEY/);
  assert.doesNotMatch(js, /https:\/\/[^\s"']+\.(?:mjs|js)(?:["'])/);
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/);
});
