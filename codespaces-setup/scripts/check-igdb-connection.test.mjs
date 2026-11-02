import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp, writeFile, readFile, readdir, rm, symlink, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  TOKEN_ENDPOINT, GAMES_ENDPOINT, GAME_QUERY, parseLocalConfig, readLocalConfig,
  createJsonTransport, createRouteAgent, checkConnection, saveOutcome, runManualCheck, classifyTokenError,
} from './check-igdb-connection.mjs';

// Every credential and response in this file is synthetic. Never read the real
// project .env.local; every file-based test uses a temporary fixture root.
const credentials = {clientId: 'SYNTHETIC_CLIENT_ID', clientSecret: 'SYNTHETIC_SECRET&+=/%'};
const token = 'SYNTHETIC_MEMORY_ONLY_TOKEN';
const tokenResult = () => ({kind: 'json', data: {access_token: token, token_type: 'bearer', expires_in: 3600}});
const gamesResult = () => ({kind: 'json', data: [{id: 1, name: 'Synthetic One'}, {id: 2, name: 'Synthetic Two'}]});
const now = () => new Date('2026-10-09T21:00:00.000Z');
const fixtureText = `IGDB_CLIENT_ID=${credentials.clientId}\nIGDB_CLIENT_SECRET=${credentials.clientSecret}\nIGDB_ACCESS_TOKEN=SYNTHETIC_IGNORED_OLD_TOKEN\n`;
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'igdb-offline-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}
function sequence(...responses) {
  const calls = [];
  const transport = async (...args) => {
    calls.push(args);
    assert.ok(calls.length <= responses.length, 'Unexpected extra network request');
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    return response;
  };
  return {transport, calls};
}
function fakeHttps({status = 200, contentType = 'application/json', body = '{}', error, hang = false, hangBody = false, interruptedBody} = {}) {
  const calls = [];
  let destroyed = false;
  let bodySubscriptions = 0;
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => {destroyed = true;};
    req.end = sentBody => {
      calls.push({url, options, body: sentBody});
      if (hang) return;
      queueMicrotask(() => {
        if (error) return req.emit('error', error);
        const res = new PassThrough();
        res.statusCode = status;
        res.headers = {'content-type': contentType};
        res.complete = !hangBody && !interruptedBody;
        const originalOn = res.on;
        res.on = function(event, ...args) {
          if (event === 'data') bodySubscriptions += 1;
          return originalOn.call(this, event, ...args);
        };
        callback(res);
        if (interruptedBody && !res.destroyed) {
          res.write(body);
          if (interruptedBody === 'error') res.emit('error', new Error('SYNTHETIC_BODY_ERROR_SECRET'));
          else if (interruptedBody === 'aborted') res.emit('aborted');
          else res.emit('close');
        } else if (!hangBody && !res.destroyed) res.end(body);
      });
    };
    return req;
  };
  return {request, calls, wasDestroyed: () => destroyed, bodySubscriptions: () => bodySubscriptions};
}

test('parser reads only required keys, permits quotes/comments and never evaluates shell text', () => {
  assert.deepEqual(parseLocalConfig(fixtureText), credentials);
  assert.deepEqual(parseLocalConfig('\uFEFF# test\r\nexport IGDB_CLIENT_ID="abc" # comment\r\nIGDB_CLIENT_SECRET=\'$(not-executed)\'\r\n'), {clientId: 'abc', clientSecret: '$(not-executed)'});
  assert.deepEqual(parseLocalConfig('IGDB_CLIENT_ID=abc # comment\nIGDB_CLIENT_SECRET=def\n'), {clientId: 'abc', clientSecret: 'def'});
});

test('missing, blank, malformed, duplicate, control-character and oversized configuration fails closed', () => {
  for (const source of ['', 'IGDB_ACCESS_TOKEN=ignored', 'IGDB_CLIENT_ID=abc', 'IGDB_CLIENT_ID=abc\nIGDB_CLIENT_SECRET=', 'IGDB_CLIENT_ID=""\nIGDB_CLIENT_SECRET=x', 'IGDB_CLIENT_ID=abc\nIGDB_CLIENT_SECRET="unclosed', 'IGDB_CLIENT_ID=abc\nIGDB_CLIENT_ID=def\nIGDB_CLIENT_SECRET=x', 'IGDB_CLIENT_ID abc\nIGDB_CLIENT_SECRET=x', 'IGDB_CLIENT_ID=a b\nIGDB_CLIENT_SECRET=x', 'IGDB_CLIENT_ID=abc\nIGDB_CLIENT_SECRET=a\u0000b', `${fixtureText}${'x'.repeat(16_385)}`]) {
    assert.equal(parseLocalConfig(source), null);
  }
});

test('configuration loader only reads private regular synthetic files and rejects symlinks', async t => {
  const root = await fixture(t);
  assert.equal(await readLocalConfig(root), null);
  await writeFile(path.join(root, '.env.local'), fixtureText, {mode: 0o600});
  assert.deepEqual(await readLocalConfig(root), credentials);
  await chmod(path.join(root, '.env.local'), 0o644);
  assert.equal(await readLocalConfig(root), null);
  await rm(path.join(root, '.env.local'));
  await writeFile(path.join(root, 'synthetic-private'), fixtureText, {mode: 0o600});
  await symlink(path.join(root, 'synthetic-private'), path.join(root, '.env.local'));
  assert.equal(await readLocalConfig(root), null);
});

test('missing credentials produce no network calls', async () => {
  const mock = sequence();
  const result = await checkConnection({credentials: null, transport: mock.transport, now});
  assert.equal(result.status, 'missing_config');
  assert.equal(result.phase, 'config');
  assert.equal(mock.calls.length, 0);
});

test('success makes exactly one token POST and one bounded game query with no existing token', async () => {
  const mock = sequence(tokenResult(), gamesResult());
  const result = await checkConnection({credentials: {...credentials, accessToken: 'IGNORED'}, transport: mock.transport, now});
  assert.deepEqual(result, {schema_version: 1, checked_at: now().toISOString(), status: 'igdb_success', phase: 'igdb', record_count: 2});
  assert.equal(mock.calls.length, 2);
  const [tokenUrl, tokenHeaders, tokenBody] = mock.calls[0];
  assert.equal(tokenUrl, TOKEN_ENDPOINT);
  assert.equal(new URL(tokenUrl).search, '');
  assert.deepEqual(tokenHeaders, {'Content-Type': 'application/x-www-form-urlencoded'});
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tokenBody)), {client_id: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'client_credentials'});
  const [gamesUrl, headers, query] = mock.calls[1];
  assert.equal(gamesUrl, GAMES_ENDPOINT);
  assert.equal(headers.Authorization, `Bearer ${token}`);
  assert.equal(headers['Client-ID'], credentials.clientId);
  assert.equal(query, 'fields id,name; limit 3;');
  for (const secret of [credentials.clientId, credentials.clientSecret, token, 'IGNORED', 'Synthetic One']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('token HTTP errors and redirects stop after one request without retrying or leaking errors', async () => {
  for (const httpStatus of [301, 302, 307, 308, 400, 401, 429, 500]) {
    const mock = sequence({kind: 'http_error', httpStatus, data: {message: credentials.clientSecret}});
    const result = await checkConnection({credentials, transport: mock.transport, now});
    assert.equal(result.status, 'token_rejected');
    assert.equal(result.http_status, httpStatus);
    assert.equal(mock.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes(credentials.clientSecret));
  }
});

test('invalid token response shapes never reach IGDB', async () => {
  for (const data of [null, [], {}, {access_token: token}, {access_token: token, token_type: 'bearer', expires_in: 0}, {access_token: token, token_type: 'other', expires_in: 100}, {access_token: `${token}\r\nInjected: x`, token_type: 'bearer', expires_in: 100}]) {
    const mock = sequence({kind: 'json', data});
    assert.equal((await checkConnection({credentials, transport: mock.transport, now})).status, 'token_invalid_response');
    assert.equal(mock.calls.length, 1);
  }
});

test('IGDB errors, invalid JSON shapes and oversized result arrays are sanitized without retries', async () => {
  for (const response of [{kind: 'http_error', httpStatus: 401}, {kind: 'invalid_json'}, {kind: 'json', data: {}}, {kind: 'json', data: [null]}, {kind: 'json', data: [{id: 0, name: 'x'}]}, {kind: 'json', data: [{id: 1, name: ''}]}, {kind: 'json', data: [{id: 1, name: 'bad\nname'}]}, {kind: 'json', data: Array.from({length: 4}, (_, i) => ({id: i + 1, name: 'x'}))}]) {
    const mock = sequence(tokenResult(), response);
    const result = await checkConnection({credentials, transport: mock.transport, now});
    assert.equal(result.status, response.kind === 'http_error' ? 'igdb_rejected' : 'igdb_invalid_response');
    assert.equal(result.phase, 'igdb');
    assert.equal(mock.calls.length, 2);
  }
});

test('network errors in either phase discard underlying exception text', async () => {
  for (const phase of ['token', 'igdb']) {
    const responses = [new Error(`Do not log ${credentials.clientSecret} ${token}`)];
    if (phase === 'igdb') responses.unshift(tokenResult());
    const mock = sequence(...responses);
    const result = await checkConnection({credentials, transport: mock.transport, now});
    assert.equal(result.status, 'network_error');
    assert.equal(result.phase, phase);
    assert.ok(!JSON.stringify(result).includes('Do not log'));
  }
});

test('transport uses exact allowlisted HTTPS endpoints, POST and fresh connections', async () => {
  const fake = fakeHttps({body: '{"ok":true}'});
  const transport = createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request});
  assert.deepEqual(await transport(GAMES_ENDPOINT, {'Content-Type': 'text/plain'}, GAME_QUERY), {kind: 'json', data: {ok: true}});
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.method, 'POST');
  assert.equal(fake.calls[0].options.agent.keepAlive, false);
  assert.equal(fake.calls[0].options.agent.maxCachedSessions, 0);
  assert.equal(fake.calls[0].options.rejectUnauthorized, true);
  assert.equal(fake.calls[0].options.headers['Content-Length'], Buffer.byteLength(GAME_QUERY));
  for (const url of ['https://example.com', 'http://api.igdb.com/v4/games', `${TOKEN_ENDPOINT}?secret=x`, `${GAMES_ENDPOINT}/`, 'https://user:pass@api.igdb.com/v4/games']) await assert.rejects(transport(url, {}, ''), /Endpoint not allowed/);
  assert.equal(fake.calls.length, 1);
});

test('transport refuses redirects and never consumes redirect payloads', async () => {
  const fake = fakeHttps({status: 307, body: credentials.clientSecret});
  const result = await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request})(TOKEN_ENDPOINT, {}, 'synthetic');
  assert.deepEqual(result, {kind: 'http_error', httpStatus: 307});
  assert.equal(fake.calls.length, 1);
  assert.ok(fake.wasDestroyed());
  assert.equal(fake.bodySubscriptions(), 0);
});

test('transport rejects non-JSON, malformed and oversized bodies without including body text', async () => {
  for (const spec of [{contentType: 'text/html', body: credentials.clientSecret}, {body: token}, {body: JSON.stringify({huge: 'x'.repeat(16_385)})}]) {
    const fake = fakeHttps(spec);
    assert.deepEqual(await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request})(TOKEN_ENDPOINT, {}, 'synthetic'), {kind: 'invalid_json'});
    assert.equal(fake.calls.length, 1);
  }
});

test('transport deadline covers a connection or body that never finishes, with no retries', async () => {
  for (const spec of [{hang: true}, {hangBody: true}]) {
    const fake = fakeHttps(spec);
    const result = await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request, timeoutMs: 10})(TOKEN_ENDPOINT, {}, 'synthetic');
    assert.deepEqual(result, {kind: 'network_error'});
    assert.equal(fake.calls.length, 1);
    assert.ok(fake.wasDestroyed());
  }
});

test('transport discards request error messages', async () => {
  const fake = fakeHttps({error: new Error(credentials.clientSecret)});
  assert.deepEqual(await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request})(TOKEN_ENDPOINT, {}, 'synthetic'), {kind: 'network_error'});
});

test('timestamped reports are minimal, unique and preserve earlier successful outcomes', async t => {
  const root = await fixture(t);
  const good = {schema_version: 1, checked_at: now().toISOString(), status: 'igdb_success', phase: 'igdb', record_count: 2, secret: credentials.clientSecret, headers: {Authorization: token}};
  const first = await saveOutcome(root, good);
  const second = await saveOutcome(root, {...good, status: 'network_error', record_count: 0});
  assert.notEqual(first, second);
  const saved = JSON.parse(await readFile(path.join(root, first), 'utf8'));
  assert.deepEqual(saved, {schema_version: 1, checked_at: now().toISOString(), status: 'igdb_success', phase: 'igdb', record_count: 2});
  assert.equal((await readdir(path.dirname(path.join(root, first)))).length, 2);
  await assert.rejects(saveOutcome(root, {...good, status: credentials.clientSecret}), /Invalid outcome/);
});

test('route agent preserves configured proxies and rejects unsupported proxy-only routes', () => {
  const env = {HTTPS_PROXY: 'http://synthetic-proxy.invalid:8080', NO_PROXY: 'localhost,127.0.0.1', IGDB_CLIENT_SECRET: 'DO_NOT_COPY'};
  class FakeAgent {constructor(options) {this.options = options;}}
  const agent = createRouteAgent({env, version: '24.19.0', Agent: FakeAgent});
  assert.deepEqual(agent.options.proxyEnv, {HTTPS_PROXY: env.HTTPS_PROXY, NO_PROXY: env.NO_PROXY});
  assert.equal(agent.options.keepAlive, false);
  assert.equal(agent.options.rejectUnauthorized, true);
  for (const config of [{env, version: '24.4.0'}, {env: {HTTP_PROXY: 'http://synthetic-proxy.invalid'}, version: '24.19.0'}, {env: {ALL_PROXY: 'socks://synthetic.invalid'}, version: '24.19.0'}]) {
    assert.throws(() => createRouteAgent({...config, Agent: FakeAgent}), /Unsupported proxy configuration/);
  }
});

test('unsupported proxy configuration fails before any request and never retries directly', async () => {
  const fake = fakeHttps();
  const transport = createJsonTransport({request: fake.request, agentFactory: () => createRouteAgent({env: {HTTP_PROXY: 'http://synthetic-proxy.invalid'}, version: '24.19.0'})});
  assert.deepEqual(await transport(TOKEN_ENDPOINT, {}, 'synthetic'), {kind: 'network_error'});
  assert.equal(fake.calls.length, 0);
});

test('empty valid game response is connection success with zero catalog records', async () => {
  const mock = sequence(tokenResult(), {kind: 'json', data: []});
  const result = await checkConnection({credentials, transport: mock.transport, now});
  assert.equal(result.status, 'igdb_success');
  assert.equal(result.record_count, 0);
  assert.equal(mock.calls.length, 2);
});

test('manual runner works solely against synthetic fixtures and writes no credential to logs or reports', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, '.env.local'), fixtureText, {mode: 0o600});
  const mock = sequence(tokenResult(), gamesResult());
  const logs = [];
  assert.equal(await runManualCheck({root, transport: mock.transport, now, output: line => logs.push(line)}), 0);
  const dir = path.join(root, 'research/milestone-1/igdb-connection-checks');
  const files = await readdir(dir);
  const combined = logs.join('\n') + await readFile(path.join(dir, files[0]), 'utf8');
  for (const secret of [credentials.clientId, credentials.clientSecret, token, 'SYNTHETIC_IGNORED_OLD_TOKEN', 'Synthetic One']) assert.ok(!combined.includes(secret));
  assert.equal(await readFile(path.join(root, '.env.local'), 'utf8'), fixtureText);
});

test('CLI without --run does not load configuration or contact the network', () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-igdb-connection.mjs')], {encoding: 'utf8'});
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Manual check only/);
  assert.equal(result.stderr, '');
});

test('CLI refuses runtime debugging before loading configuration or using --run', () => {
  // NODE_DEBUG is given a harmless nonexistent category. No real env is loaded.
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'check-igdb-connection.mjs'), '--run'], {encoding: 'utf8', env: {...process.env, NODE_DEBUG: 'synthetic_unused_category'}});
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Unsafe runtime debugging options/);
  assert.equal(result.stderr, '');
});

test('token-error classifier maps only exact approved strings to fixed reasons', () => {
  const cases = [
    ['invalid client secret', 'invalid_client_secret'], ['invalid_client_secret', 'invalid_client_secret'],
    ['invalid client id', 'invalid_client_id'], ['invalid_client_id', 'invalid_client_id'],
    ['unsupported grant type', 'unsupported_grant_type'], ['unsupported_grant_type', 'unsupported_grant_type'],
    ['invalid grant', 'invalid_grant'], ['invalid_grant', 'invalid_grant'],
    ['access denied', 'access_denied'], ['access_denied', 'access_denied'],
  ];
  for (const [text, reason] of cases) {
    for (const key of ['error', 'error_code', 'code', 'message', 'error_description']) {
      assert.equal(classifyTokenError({[key]: text, detail: credentials.clientSecret, access_token: token}), reason);
    }
  }
  assert.equal(classifyTokenError({error: 'invalid_client_secret', message: 'invalid client secret'}), 'invalid_client_secret');
});

test('unknown, ambiguous, reflected, nested, and malicious provider text never becomes a reason', () => {
  const cases = [null, [], 'invalid client secret', {}, {message: ['invalid client secret']},
    {message: {text: 'invalid client secret'}}, {detail: 'invalid client secret'},
    {message: 'invalid client'}, {message: 'Invalid Client Secret'}, {message: ' invalid client secret'},
    {message: `invalid client secret ${credentials.clientSecret}`},
    {message: `invalid client secret\n${token}`}, {message: credentials.clientSecret},
    {error: 'invalid_client_id', message: 'invalid client secret'},
    {message: '__proto__'}, {message: 'constructor'},
    JSON.parse('{"__proto__":{"message":"invalid client secret"}}'),
    Object.create({message: 'invalid client secret'}),
  ];
  for (const data of cases) assert.equal(classifyTokenError(data), 'unknown');
});

test('only bounded token error JSON is classified; raw provider data never leaves transport', async () => {
  for (const [field, text, reason] of [
    ['message', 'invalid client secret', 'invalid_client_secret'],
    ['error', 'invalid_client_id', 'invalid_client_id'],
    ['error', 'unsupported_grant_type', 'unsupported_grant_type'],
    ['error', 'invalid_grant', 'invalid_grant'],
    ['error', 'access_denied', 'access_denied'],
  ]) {
    const fake = fakeHttps({status: 403, body: JSON.stringify({[field]: text, access_token: token, detail: credentials.clientSecret})});
    const result = await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request})(TOKEN_ENDPOINT, {}, 'synthetic');
    assert.deepEqual(result, {kind: 'http_error', httpStatus: 403, reason});
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.bodySubscriptions(), 1);
    for (const canary of [credentials.clientSecret, token]) assert.ok(!JSON.stringify(result).includes(canary));
  }
});

test('non-JSON, malformed, oversized, and unrecognized token errors retain HTTP status with unknown reason', async () => {
  for (const spec of [
    {contentType: 'text/html', body: `${credentials.clientSecret} invalid client secret`},
    {body: `${token} invalid client secret`},
    {body: JSON.stringify({message: 'invalid client secret', extra: 'x'.repeat(16_385)})},
    {body: JSON.stringify({message: `${credentials.clientSecret} invalid client secret`, access_token: token})},
    {body: JSON.stringify({error: 'unrecognized_private_code', error_description: token})},
  ]) {
    const fake = fakeHttps({status: 403, ...spec});
    const result = await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request})(TOKEN_ENDPOINT, {}, 'synthetic');
    assert.deepEqual(result, {kind: 'http_error', httpStatus: 403, reason: 'unknown'});
    assert.equal(fake.calls.length, 1);
  }
});

test('interrupted and stalled token error bodies retain HTTP status and never expose partial data', async () => {
  for (const spec of [{interruptedBody: 'error'}, {interruptedBody: 'aborted'}, {interruptedBody: 'close'}, {hangBody: true}]) {
    const fake = fakeHttps({status: 403, body: `{"message":"invalid client secret","detail":"${token}`, ...spec});
    const result = await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request, timeoutMs: 10})(TOKEN_ENDPOINT, {}, 'synthetic');
    assert.deepEqual(result, {kind: 'http_error', httpStatus: 403, reason: 'unknown'});
    assert.equal(fake.calls.length, 1);
    assert.ok(fake.wasDestroyed());
  }
});

test('redirect and IGDB error bodies are discarded unread even with recognized token-error text', async () => {
  for (const [endpoint, status] of [[TOKEN_ENDPOINT, 301], [TOKEN_ENDPOINT, 307], [GAMES_ENDPOINT, 403], [GAMES_ENDPOINT, 500]]) {
    const fake = fakeHttps({status, body: JSON.stringify({message: 'invalid client secret', secret: credentials.clientSecret})});
    const result = await createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request})(endpoint, {}, 'synthetic');
    assert.deepEqual(result, {kind: 'http_error', httpStatus: status});
    assert.equal(fake.bodySubscriptions(), 0);
    assert.equal(fake.calls.length, 1);
    assert.ok(fake.wasDestroyed());
  }
});

test('outcomes independently allowlist token reasons and never add them to other phases', async () => {
  for (const inputReason of ['invalid_client_secret', 'invalid_client_id', 'unsupported_grant_type', 'invalid_grant', 'access_denied', 'unknown', token, {value: 'invalid_client_secret'}, undefined]) {
    const mock = sequence({kind: 'http_error', httpStatus: 403, reason: inputReason, body: credentials.clientSecret});
    const result = await checkConnection({credentials, transport: mock.transport, now});
    const reason = ['invalid_client_secret', 'invalid_client_id', 'unsupported_grant_type', 'invalid_grant', 'access_denied', 'unknown'].includes(inputReason) ? inputReason : 'unknown';
    assert.deepEqual(result, {schema_version: 1, checked_at: now().toISOString(), status: 'token_rejected', phase: 'token', record_count: 0, http_status: 403, reason});
    assert.equal(mock.calls.length, 1);
  }
  const mock = sequence(tokenResult(), {kind: 'http_error', httpStatus: 403, reason: 'invalid_client_secret'});
  assert.ok(!Object.hasOwn(await checkConnection({credentials, transport: mock.transport, now}), 'reason'));
});

test('report writer independently rejects arbitrary reason values and excludes them outside token rejection', async t => {
  const root = await fixture(t);
  const base = {schema_version: 1, checked_at: now().toISOString(), status: 'token_rejected', phase: 'token', record_count: 0, http_status: 403};
  for (const inputReason of ['invalid_client_secret', 'invalid_client_id', 'unsupported_grant_type', 'invalid_grant', 'access_denied', 'unknown', credentials.clientSecret, token, {toString: () => token}]) {
    const filename = await saveOutcome(root, {...base, reason: inputReason, message: token, headers: {secret: credentials.clientSecret}});
    const savedText = await readFile(path.join(root, filename), 'utf8');
    const saved = JSON.parse(savedText);
    assert.deepEqual(Object.keys(saved), ['schema_version', 'checked_at', 'status', 'phase', 'record_count', 'http_status', 'reason']);
    assert.ok(['invalid_client_secret', 'invalid_client_id', 'unsupported_grant_type', 'invalid_grant', 'access_denied', 'unknown'].includes(saved.reason));
    for (const canary of [credentials.clientSecret, token]) assert.ok(!savedText.includes(canary));
  }
  const filename = await saveOutcome(root, {...base, status: 'igdb_rejected', phase: 'igdb', reason: 'invalid_client_secret'});
  assert.ok(!Object.hasOwn(JSON.parse(await readFile(path.join(root, filename), 'utf8')), 'reason'));
});

test('manual token-error diagnostics expose only fixed reasons, preserving canary secrecy end to end', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, '.env.local'), fixtureText, {mode: 0o600});
  for (const [message, expected] of [['invalid client secret', 'invalid_client_secret'], [`invalid client secret ${credentials.clientSecret} ${token}`, 'unknown']]) {
    const fake = fakeHttps({status: 403, body: JSON.stringify({message, access_token: token, secret: credentials.clientSecret})});
    const transport = createJsonTransport({agentFactory: () => createRouteAgent({env: {}}), request: fake.request});
    const logs = [];
    assert.equal(await runManualCheck({root, transport, now, output: line => logs.push(line)}), 1);
    assert.equal(fake.calls.length, 1, 'A rejected token must not trigger an IGDB request');
    assert.match(logs[0], new RegExp(`reason=${expected}$`));
    const dir = path.join(root, 'research/milestone-1/igdb-connection-checks');
    const reports = await Promise.all((await readdir(dir)).map(file => readFile(path.join(dir, file), 'utf8')));
    const combined = logs.join('\n') + reports.join('\n');
    for (const canary of [credentials.clientId, credentials.clientSecret, token, 'SYNTHETIC_IGNORED_OLD_TOKEN']) assert.ok(!combined.includes(canary));
    assert.equal(await readFile(path.join(root, '.env.local'), 'utf8'), fixtureText);
  }
});
