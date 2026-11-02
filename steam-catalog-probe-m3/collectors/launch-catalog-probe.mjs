import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// The parent never enumerates credentials. A clean child drops auth/debug/TLS overrides.
const keys=['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','ALL_PROXY','all_proxy'];
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<5)throw new Error('node_24_5_or_later_required');
if(process.argv.length!==3||process.argv[2]!=='--run')throw new Error('explicit_run_required');
const env=Object.fromEntries(keys.filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'steam-catalog-probe.mjs'),'--run'],{env,stdio:'inherit'});
process.exitCode=result.status??2;
