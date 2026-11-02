import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// No authentication, debugger, NODE_OPTIONS or TLS overrides enter the child.
// This launcher has no credential/config argument and never reads a secret file.
const keys=['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','ALL_PROXY','all_proxy','FIELDNOTE_DB'];
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<5)throw new Error('node_24_5_or_later_required');
const env=Object.fromEntries(keys.filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'../collectors/scheduler.mjs'),...process.argv.slice(2)],{env,stdio:'inherit',timeout:1500000,killSignal:'SIGTERM'});
if(result.error)console.error(JSON.stringify({status:'stopped',errorCode:result.error.code==='ETIMEDOUT'?'runtime_limit':'scheduler_launch_failed'}));
process.exitCode=result.status??2;
