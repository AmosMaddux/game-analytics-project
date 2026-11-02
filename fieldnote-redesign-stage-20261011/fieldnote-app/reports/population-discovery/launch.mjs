import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// This is a command for the owner to run personally, not an agent credential tool.
// The child receives no inherited authentication, Node injection, debug or TLS overrides.
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<5){console.error('Node 24.5 or later in the Node 24 line is required.');process.exitCode=2;}
else {
  const safe=['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','ALL_PROXY','all_proxy'];
  const env=Object.fromEntries(safe.filter(name=>typeof process.env[name]==='string').map(name=>[name,process.env[name]]));
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'cli.mjs'),...process.argv.slice(2)],{env,stdio:'inherit',timeout:12*60*1000+5000,killSignal:'SIGTERM'});
  if(result.error)console.error(JSON.stringify({status:'stopped',errorCode:'launcher_runtime_or_process_failure',resume:'Use the same run ID; reserved budgets remain charged.'}));
  process.exitCode=result.status??2;
}
