import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createRouteProbe, checkRoutes, runRouteCheck, ROUTES} from './check-network-routes.mjs';

// All traffic is mocked. No credential/configuration files are read.
function fakeRequest({status = 401, error = false, hang = false} = {}) {
  const calls = [];
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = body => {
      calls.push({url, options, body});
      if (hang) return;
      queueMicrotask(() => {
        if (error) return req.emit('error', new Error('DO_NOT_LOG_ERROR_BODY'));
        callback({statusCode: status, destroy() {}, on() {throw new Error('Body must not be read');}});
      });
    };
    return req;
  };
  return {request, calls};
}
const agentFactory = () => ({destroy() {}});
const now = () => new Date('2026-10-10T15:00:00.000Z');

test('both modules import without application filesystem, network, or console I/O', () => {
  const program = `
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import https from 'node:https';
    import http from 'node:http';
    import net from 'node:net';
    import tls from 'node:tls';
    import {syncBuiltinESMExports} from 'node:module';
    import {fileURLToPath} from 'node:url';
    const modulePaths = ${JSON.stringify(['check-igdb-connection.mjs', 'check-network-routes.mjs'].map(name => path.join(import.meta.dirname, name)))};
    const moduleSources = new Map(modulePaths.map(file => [file, fs.readFileSync(file)]));
    const blocked = () => { throw new Error('Unexpected application I/O'); };
    for (const obj of [fs, fsp]) for (const key of ['open','openSync','readFile','readFileSync','writeFile','writeFileSync','mkdir','mkdirSync']) if (key in obj) obj[key] = blocked;
    // Permit only loading the two module sources, from memory; every other
    // file read (including .env.local) and every write stays blocked.
    const moduleRead = (file, options) => {
      const key = file instanceof URL ? fileURLToPath(file) : file;
      if (!moduleSources.has(key)) return blocked();
      const data = moduleSources.get(key);
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? data.toString(encoding) : Buffer.from(data);
    };
    fs.readFileSync = moduleRead;
    fsp.readFile = async (...args) => moduleRead(...args);
    https.request = blocked; http.request = blocked; net.connect = blocked; tls.connect = blocked;
    console.log = blocked; console.error = blocked;
    syncBuiltinESMExports();
    await import(${JSON.stringify(new URL('./check-igdb-connection.mjs', import.meta.url).href)});
    await import(${JSON.stringify(new URL('./check-network-routes.mjs', import.meta.url).href)});
    process.stdout.write('IMPORT_SAFE');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'IMPORT_SAFE');
  assert.equal(result.stderr, '');
});

test('route probe sends one credential-free HEAD with TLS validation and no request body', async () => {
  for (const {endpoint} of ROUTES) {
    const fake = fakeRequest();
    assert.deepEqual(await createRouteProbe({request: fake.request, agentFactory})(endpoint), {status: 'http_response', http_status: 401});
    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.url, endpoint);
    assert.equal(call.options.method, 'HEAD');
    assert.deepEqual(call.options.headers, {Accept: 'application/json'});
    assert.equal(call.options.rejectUnauthorized, true);
    assert.equal(call.body, undefined);
    assert.equal(new URL(call.url).search, '');
  }
});

test('route probe rejects unlisted endpoints before request creation', async () => {
  const fake = fakeRequest();
  await assert.rejects(createRouteProbe({request: fake.request, agentFactory})('https://example.com'), /Endpoint not allowed/);
  assert.equal(fake.calls.length, 0);
});

test('HTTP errors and redirects are summarized without reading bodies or following redirects', async () => {
  for (const status of [301, 307, 400, 401, 403, 405, 429, 500]) {
    const fake = fakeRequest({status});
    assert.deepEqual(await createRouteProbe({request: fake.request, agentFactory})(ROUTES[0].endpoint), {status: 'http_response', http_status: status});
    assert.equal(fake.calls.length, 1);
  }
});

test('timeouts, exceptions, and unsupported routes fail closed without retry or error details', async () => {
  for (const setup of [{error: true}, {hang: true}]) {
    const fake = fakeRequest(setup);
    assert.deepEqual(await createRouteProbe({request: fake.request, agentFactory, timeoutMs: 10})(ROUTES[0].endpoint), {status: 'network_error'});
    assert.equal(fake.calls.length, 1);
  }
  const fake = fakeRequest();
  assert.deepEqual(await createRouteProbe({request: fake.request, agentFactory: () => {throw new Error('DO_NOT_LOG');}})(ROUTES[0].endpoint), {status: 'network_error'});
  assert.equal(fake.calls.length, 0);
});

test('summary is a strict allowlist even when injected transports return extra fields', async () => {
  const called = [];
  const result = await checkRoutes({now, probe: async endpoint => {
    called.push(endpoint);
    return {status: 'http_response', http_status: 401, headers: 'DO_NOT_LOG', body: 'DO_NOT_LOG'};
  }});
  assert.deepEqual(called, ROUTES.map(route => route.endpoint));
  assert.deepEqual(result, {schema_version: 1, checked_at: now().toISOString(), routes: ROUTES.map(({service}) => ({service, status: 'http_response', http_status: 401}))});
  assert.ok(!JSON.stringify(result).includes('DO_NOT_LOG'));
});

test('manual summary states authentication is untested and reports failure without raw details', async () => {
  const logs = [];
  const code = await runRouteCheck({now, output: line => logs.push(line), probe: async () => {throw new Error('DO_NOT_LOG');}});
  assert.equal(code, 1);
  assert.match(logs.join('\n'), /Authentication and token creation have not been tested/);
  assert.ok(!logs.join('\n').includes('DO_NOT_LOG'));
});

test('network CLI usage has no network or config side effects', () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-network-routes.mjs')], {encoding: 'utf8'});
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Manual route check only/);
  assert.equal(result.stderr, '');
});
