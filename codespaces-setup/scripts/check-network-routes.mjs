import {request as httpsRequest} from 'node:https';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TOKEN_ENDPOINT, GAMES_ENDPOINT, createRouteAgent} from './check-igdb-connection.mjs';

// Importing performs no I/O. This module never opens a configuration file,
// supplies credentials, exchanges a token, reads a body, or persists a report.
export const ROUTES = Object.freeze([
  Object.freeze({service: 'twitch', endpoint: TOKEN_ENDPOINT}),
  Object.freeze({service: 'igdb', endpoint: GAMES_ENDPOINT}),
]);

export function createRouteProbe({request = httpsRequest, timeoutMs = 20_000, agentFactory = () => createRouteAgent()} = {}) {
  return async endpoint => {
    if (!ROUTES.some(route => route.endpoint === endpoint)) throw new Error('Endpoint not allowed');
    return new Promise(resolve => {
      let settled = false;
      let req;
      let res;
      let agent;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
        res?.destroy();
        req?.destroy();
        agent?.destroy();
      };
      const timer = setTimeout(() => finish({status: 'network_error'}), timeoutMs);
      try {
        agent = agentFactory();
        req = request(endpoint, {
          method: 'HEAD',
          headers: {Accept: 'application/json'},
          agent,
          rejectUnauthorized: true,
          maxHeaderSize: 8192,
          // No authorization, body, redirects, retries, or proxy bypasses.
        }, response => {
          res = response;
          const code = response.statusCode;
          finish(Number.isInteger(code) && code >= 100 && code <= 599
            ? {status: 'http_response', http_status: code}
            : {status: 'network_error'});
        });
        req.on('error', () => finish({status: 'network_error'}));
        req.end();
      } catch {
        finish({status: 'network_error'});
      }
    });
  };
}

export async function checkRoutes({probe = createRouteProbe(), now = () => new Date()} = {}) {
  const routes = [];
  for (const {service, endpoint} of ROUTES) {
    let response;
    try {response = await probe(endpoint);} catch {response = null;}
    const code = response?.http_status;
    routes.push(response?.status === 'http_response' && Number.isInteger(code) && code >= 100 && code <= 599
      ? {service, status: 'http_response', http_status: code}
      : {service, status: 'network_error'});
  }
  return {schema_version: 1, checked_at: now().toISOString(), routes};
}

export async function runRouteCheck({probe, now, output = line => console.log(line)} = {}) {
  const result = await checkRoutes({probe, now});
  output(`Credential-free route check: ${result.checked_at}`);
  for (const route of result.routes) {
    output(`${route.service}: ${route.status}${route.http_status ? `; HTTP ${route.http_status}` : ''}`);
  }
  output('HTTPS responses only. Authentication and token creation have not been tested.');
  return result.routes.every(route => route.status === 'http_response') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.log('Manual route check only. Run bash scripts/run-igdb-check.sh --network.');
    process.exitCode = 2;
  } else if (['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS', 'SSLKEYLOGFILE'].some(key => process.env[key]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.execArgv.length > 0) {
    console.log('Unsafe runtime options. Use the portable launcher.');
    process.exitCode = 2;
  } else {
    try {process.exitCode = await runRouteCheck();}
    catch {console.log('Credential-free route check could not complete.'); process.exitCode = 2;}
  }
}
