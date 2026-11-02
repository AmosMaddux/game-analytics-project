import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifiedBundle,ROOT} from './verify-bundle.mjs';

// Parent process never reads credentials. Child environment is an allowlist,
// preserving the configured route rather than overriding or bypassing it.
const SAFE_ENV=['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','ALL_PROXY','all_proxy'];
async function launch(){
  const args=process.argv.slice(2);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==24||minor<5)throw Error('node_24_5_or_later_required');
  await verifiedBundle();
  const childEnv=Object.fromEntries(SAFE_ENV.filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
  if(args.length===1&&args[0]==='--test'){
    const r=spawnSync(process.execPath,['--test',path.join(ROOT,'tests/probe.test.mjs')],{env:childEnv,stdio:'inherit',cwd:ROOT});process.exitCode=r.status??2;return;
  }
  // A separate clean child drops auth/debug/TLS override variables without
  // enumerating, printing, or forwarding their values.
  const command=`import {main} from ${JSON.stringify(pathToFileURL(path.join(ROOT,'scripts/steam-validation.mjs')).href)}; try { process.exitCode = await main(process.argv.slice(1)); } catch(e) { console.error('Probe stopped before completion:', /^[a-z0-9_]+$/.test(e?.code || e?.message || '') ? (e.code || e.message) : 'setup_or_input_error'); process.exitCode=2; }`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',command,'--',...args],{env:childEnv,stdio:'inherit',cwd:ROOT});process.exitCode=r.status??2;
}
launch().catch(()=>{console.error('Bundle or runtime validation failed. No live request was started.');process.exitCode=2;});
