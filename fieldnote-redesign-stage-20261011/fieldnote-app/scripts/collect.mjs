import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// Do not enumerate or forward authentication/debug/TLS overrides. The only
// credential-bearing command reads its config privately in the clean child.
const keys=['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','ALL_PROXY','all_proxy','FIELDNOTE_DB'];
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<5)throw new Error('node_24_5_or_later_required');
const env=Object.fromEntries(keys.filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'../collectors/cli.mjs'),...process.argv.slice(2)],{env,stdio:'inherit'});
process.exitCode=result.status??2;
