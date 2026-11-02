import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson} from '../backend/panel-selection.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function verifyResearchPreservation(source,target,{allowAppends=false}={}){
 const a=new DatabaseSync(resolve(source),{readOnly:true}),b=new DatabaseSync(resolve(target),{readOnly:true});try{
  const names=a.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  const tables=names.map(name=>{const table=`"${name.replaceAll('"','""')}"`,previous=a.prepare(`SELECT * FROM ${table}`).all().map(canonicalJson).sort(),current=b.prepare(`SELECT * FROM ${table}`).all().map(canonicalJson).sort(),counts=new Map();for(const row of current)counts.set(row,(counts.get(row)??0)+1);const included=previous.every(row=>{const n=counts.get(row)??0;if(!n)return false;counts.set(row,n-1);return true;}),preserved=allowAppends||name==='local_migrations'?included:canonicalJson(previous)===canonicalJson(current);return {table:name,sourceRows:previous.length,targetRows:current.length,sourceRowsSha256:hash(canonicalJson(previous)),targetRowsSha256:hash(canonicalJson(current)),preserved};});
  const integrity=b.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeys=b.prepare('PRAGMA foreign_key_check').all();return {comparisonMode:allowAppends?'every_original_raw_row_retained_appends_allowed':'exact_original_tables_migration_ledger_append_only',status:tables.every(row=>row.preserved)&&integrity==='ok'&&!foreignKeys.length?'passed':'failed',sourceDatabaseSha256:hash(readFileSync(source)),targetDatabaseSha256:hash(readFileSync(target)),allPriorRowsPreserved:tables.every(row=>row.preserved),tables,integrityCheck:integrity,foreignKeyViolations:foreignKeys.length};
 }finally{a.close();b.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const raw=process.argv.slice(2),allowAppends=raw.includes('--allow-appends'),args=raw.filter(arg=>arg!=='--allow-appends');if(raw.filter(arg=>arg==='--allow-appends').length>1||args.length<2||args.length>3)throw Error('Use SOURCE.sqlite TARGET.sqlite [NEW-report.json] [--allow-appends]');const report=verifyResearchPreservation(args[0],args[1],{allowAppends});if(args[2])writeFileSync(args[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;}
