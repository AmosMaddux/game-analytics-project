import {constants as fsConstants} from 'node:fs';
import {mkdir, open} from 'node:fs/promises';
import {request as httpsRequest, Agent as HttpsAgent} from 'node:https';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Manual, server-side diagnostic only. Importing this module performs no I/O.
export const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
export const GAMES_ENDPOINT = 'https://api.igdb.com/v4/games';
export const GAME_QUERY = 'fields id,name; limit 3;';
const ENDPOINTS = new Set([TOKEN_ENDPOINT, GAMES_ENDPOINT]);
const MAX_BYTES = 16 * 1024;
const TIMEOUT_MS = 20_000;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATUSES = new Set(['missing_config', 'token_rejected', 'token_invalid_response', 'igdb_rejected', 'igdb_invalid_response', 'network_error', 'igdb_success']);

// Only these fixed labels may leave the token error-body parser. Never pass
// through provider text, response headers, error objects, or unrecognized codes.
const TOKEN_ERROR_REASONS = new Set(['invalid_client_secret', 'invalid_client_id', 'unsupported_grant_type', 'invalid_grant', 'access_denied', 'unknown']);
const TOKEN_ERROR_TEXT = new Map([
  ['invalid client secret', 'invalid_client_secret'],
  ['invalid_client_secret', 'invalid_client_secret'],
  ['invalid client id', 'invalid_client_id'],
  ['invalid_client_id', 'invalid_client_id'],
  ['unsupported grant type', 'unsupported_grant_type'],
  ['unsupported_grant_type', 'unsupported_grant_type'],
  ['invalid grant', 'invalid_grant'],
  ['invalid_grant', 'invalid_grant'],
  ['access denied', 'access_denied'],
  ['access_denied', 'access_denied'],
]);
const safeTokenReason = value => TOKEN_ERROR_REASONS.has(value) ? value : 'unknown';

export function classifyTokenError(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'unknown';
  const matches = new Set();
  for (const key of ['error', 'error_code', 'code', 'message', 'error_description']) {
    if (!Object.hasOwn(data, key) || typeof data[key] !== 'string') continue;
    // Exact equality only: no substring matching, normalization, or reflection.
    const reason = TOKEN_ERROR_TEXT.get(data[key]);
    if (reason) matches.add(reason);
  }
  return matches.size === 1 ? matches.values().next().value : 'unknown';
}

function safeValue(value, maxLength = 1024) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[\x21-\x7e]+$/.test(value);
}

export function parseLocalConfig(source) {
  // A deliberately small dotenv subset, never shell evaluation/interpolation.
  // Ignore all other keys, especially IGDB_ACCESS_TOKEN. Only these two values
  // are eligible for use, and duplicate/malformed required entries fail closed.
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) return null;
  const values = Object.create(null);
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(IGDB_CLIENT_ID|IGDB_CLIENT_SECRET)\s*=(.*)$/);
    if (!match) {
      if (/^\s*(?:export\s+)?(?:IGDB_CLIENT_ID|IGDB_CLIENT_SECRET)\b/.test(line)) return null;
      continue;
    }
    const [, key, raw] = match;
    if (Object.hasOwn(values, key)) return null;
    const trimmed = raw.trim();
    const quoted = trimmed.match(/^(['"])([^\r\n]*)\1\s*(?:#.*)?$/);
    // Unquoted comments start at whitespace + #. No escaping or expansion.
    const value = quoted ? quoted[2] : trimmed.replace(/\s+#.*$/, '').trim();
    if ((!quoted && /^['"]/.test(trimmed)) || !safeValue(value)) return null;
    values[key] = value;
  }
  if (!safeValue(values.IGDB_CLIENT_ID) || !safeValue(values.IGDB_CLIENT_SECRET)) return null;
  return {clientId: values.IGDB_CLIENT_ID, clientSecret: values.IGDB_CLIENT_SECRET};
}

export async function readLocalConfig(root = ROOT) {
  let file;
  try {
    // Refuse symlinks and configuration readable by other users/groups.
    file = await open(path.join(root, '.env.local'), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > MAX_BYTES) return null;
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const {bytesRead} = await file.read(buffer, 0, buffer.length, 0);
    const result = bytesRead > MAX_BYTES ? null : parseLocalConfig(buffer.toString('utf8', 0, bytesRead));
    buffer.fill(0);
    return result;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

export function createRouteAgent({env = process.env, version = process.versions.node, Agent = HttpsAgent} = {}) {
  const [major, minor] = version.split('.').map(Number);
  const supported = major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21);
  // Pass only proxy configuration to Node, never the full environment. Keep the
  // configured route, including NO_PROXY, unchanged. Never fall back to direct
  // traffic when a configured proxy route cannot be supported for HTTPS.
  const proxyEnv = Object.fromEntries(['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']
    .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  const hasHttpsProxy = Boolean(proxyEnv.https_proxy || proxyEnv.HTTPS_PROXY);
  const hasOtherProxy = Boolean(proxyEnv.http_proxy || proxyEnv.HTTP_PROXY || env.ALL_PROXY || env.all_proxy);
  if ((!supported && (hasHttpsProxy || hasOtherProxy)) || (hasOtherProxy && !hasHttpsProxy)) throw new Error('Unsupported proxy configuration');
  return new Agent({keepAlive: false, maxCachedSessions: 0, rejectUnauthorized: true, ...(supported ? {proxyEnv} : {})});
}

export function createJsonTransport({request = httpsRequest, timeoutMs = TIMEOUT_MS, agentFactory = () => createRouteAgent()} = {}) {
  return async function requestJson(endpoint, headers, body) {
    if (!ENDPOINTS.has(endpoint)) throw new Error('Endpoint not allowed');
    return new Promise(resolve => {
      let settled = false;
      let req;
      let response;
      let agent;
      let tokenHttpError;
      const failure = () => tokenHttpError ?? {kind: 'network_error'};
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        agent?.destroy();
        resolve(result);
      };
      const stop = result => {
        finish(result);
        response?.destroy();
        req?.destroy();
      };
      // The whole request, including response consumption, has a deadline.
      const timer = setTimeout(() => stop(failure()), timeoutMs);
      try {
        agent = agentFactory();
        req = request(endpoint, {
          method: 'POST',
          headers: {...headers, Accept: 'application/json', 'Content-Length': Buffer.byteLength(body)},
          agent,
          rejectUnauthorized: true,
          maxHeaderSize: 8192,
          // node:https does not follow redirects or automatically retry.
        }, res => {
          response = res;
          const status = res.statusCode;
          if (!Number.isInteger(status) || status < 200 || status >= 300) {
            // Read a bounded JSON error only at the token endpoint for 4xx/5xx.
            // Redirects and all IGDB error bodies are still discarded unread.
            if (endpoint !== TOKEN_ENDPOINT || !Number.isInteger(status) || status < 400 || status > 599) {
              stop({kind: 'http_error', httpStatus: Number.isInteger(status) ? status : null});
              return;
            }
            tokenHttpError = {kind: 'http_error', httpStatus: status, reason: 'unknown'};
          }
          if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] || '')) {
            stop(tokenHttpError ?? {kind: 'invalid_json'});
            return;
          }
          let size = 0;
          const chunks = [];
          res.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              stop(tokenHttpError ?? {kind: 'invalid_json'});
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (settled) return;
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              finish(tokenHttpError ? {...tokenHttpError, reason: classifyTokenError(data)} : {kind: 'json', data});
            } catch {
              finish(tokenHttpError ?? {kind: 'invalid_json'});
            }
          });
          res.on('error', () => stop(failure()));
          res.on('aborted', () => stop(failure()));
          res.on('close', () => {
            if (!res.complete) stop(failure());
          });
        });
        req.on('error', () => stop(failure()));
        req.end(body);
      } catch {
        stop(failure());
      }
    });
  };
}

export async function checkConnection({credentials, transport = createJsonTransport(), now = () => new Date()} = {}) {
  const checkedAt = now().toISOString();
  const outcome = (status, phase, recordCount = 0, httpStatus, reason) => ({
    schema_version: 1, checked_at: checkedAt, status, phase, record_count: recordCount,
    ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? {http_status: httpStatus} : {}),
    ...(status === 'token_rejected' && phase === 'token' ? {reason: safeTokenReason(reason)} : {}),
  });
  if (!safeValue(credentials?.clientId) || !safeValue(credentials?.clientSecret)) return outcome('missing_config', 'config');
  let phase = 'token';
  let token;
  try {
    const tokenResponse = await transport(TOKEN_ENDPOINT, {'Content-Type': 'application/x-www-form-urlencoded'}, new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'client_credentials',
    }).toString());
    if (tokenResponse.kind === 'network_error') return outcome('network_error', phase);
    if (tokenResponse.kind === 'http_error') return outcome('token_rejected', phase, 0, tokenResponse.httpStatus, tokenResponse.reason);
    const data = tokenResponse.data;
    if (tokenResponse.kind !== 'json' || !data || Array.isArray(data) || !safeValue(data.access_token, 4096) ||
        typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
        !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0) return outcome('token_invalid_response', phase);
    token = data.access_token;
    phase = 'igdb';
    const gamesResponse = await transport(GAMES_ENDPOINT, {
      'Client-ID': credentials.clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    }, GAME_QUERY);
    if (gamesResponse.kind === 'network_error') return outcome('network_error', phase);
    if (gamesResponse.kind === 'http_error') return outcome('igdb_rejected', phase, 0, gamesResponse.httpStatus);
    const games = gamesResponse.data;
    if (gamesResponse.kind !== 'json' || !Array.isArray(games) || games.length > 3 || games.some(game =>
      !game || !Number.isSafeInteger(game.id) || game.id <= 0 || typeof game.name !== 'string' ||
      !game.name.trim() || game.name.length > 512 || /[\x00-\x1f\x7f]/.test(game.name))) return outcome('igdb_invalid_response', phase);
    // Even game names/IDs and token expiry are omitted from persisted output.
    return outcome('igdb_success', phase, games.length);
  } catch {
    return outcome('network_error', phase);
  } finally {
    token = undefined;
  }
}

export async function saveOutcome(root, outcome) {
  // Reconstruct a small allowlist rather than serializing transport/config data.
  if (!STATUSES.has(outcome.status) || !['config', 'token', 'igdb'].includes(outcome.phase) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(outcome.checked_at) ||
      !Number.isInteger(outcome.record_count) || outcome.record_count < 0 || outcome.record_count > 3) throw new Error('Invalid outcome');
  const sanitized = {
    schema_version: 1, checked_at: outcome.checked_at, status: outcome.status,
    phase: outcome.phase, record_count: outcome.record_count,
    ...(Number.isInteger(outcome.http_status) && outcome.http_status >= 100 && outcome.http_status <= 599 ? {http_status: outcome.http_status} : {}),
    ...(outcome.status === 'token_rejected' && outcome.phase === 'token' ? {reason: safeTokenReason(outcome.reason)} : {}),
  };
  const directory = path.join(root, 'research/milestone-1/igdb-connection-checks');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const filename = `${outcome.checked_at.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
  const file = await open(path.join(directory, filename), 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(sanitized, null, 2)}\n`);
  } finally {
    await file.close();
  }
  return `research/milestone-1/igdb-connection-checks/${filename}`;
}

export async function runManualCheck({root = ROOT, transport, now, output = line => console.log(line)} = {}) {
  const credentials = await readLocalConfig(root);
  const result = await checkConnection({credentials, transport, now});
  output(`IGDB connection check: ${result.status}; phase=${result.phase}; records=${result.record_count}${result.reason ? `; reason=${safeTokenReason(result.reason)}` : ''}`);
  try {
    const report = await saveOutcome(root, result);
    output(`Sanitized report: ${report}`);
  } catch {
    output('Report could not be saved; no response or credential details were logged.');
    return 2;
  }
  return result.status === 'igdb_success' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.log('Manual check only. Read README.md, then invoke this script with --run.');
    process.exitCode = 2;
  } else if (['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS', 'SSLKEYLOGFILE'].some(key => process.env[key]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.execArgv.length > 0) {
    console.log('Unsafe runtime debugging options detected. Use the clean launch command in README.md.');
    process.exitCode = 2;
  } else {
    // No credentials, response bodies, headers, or underlying errors reach logs.
    try { process.exitCode = await runManualCheck(); }
    catch { console.log('IGDB connection check could not complete.'); process.exitCode = 2; }
  }
}
