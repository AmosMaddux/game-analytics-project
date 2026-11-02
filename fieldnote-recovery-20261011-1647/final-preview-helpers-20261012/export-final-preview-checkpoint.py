# Final allowlisted source/data checkpoint after promotion. SQLite read-only source, verified backup/restore.
import pathlib,json,hashlib,zipfile,sqlite3,datetime,os,re
W=pathlib.Path('/workspaces/codespaces-blank');R=W/'fieldnote-recovery-20261011-1647';B=W/'fieldnote-final-preview-20261012-1706';A=B/'fieldnote-app';DB=B/'runtime-metrics294.sqlite';sha=lambda b:hashlib.sha256(b).hexdigest()
promotion=json.loads((B/'promotion-verification.json').read_bytes());stage=json.loads((B/'metric-import-verification.json').read_bytes());assert promotion['status']=='final_294_metrics_preview_running'and promotion['app']==str(A)and promotion['database']==str(DB)
assert promotion['bundleSha256']==stage['bundleSha256']and stage['allPriorRowsPreserved']is True
S=B/'inputs/source.zip';assert sha(S.read_bytes())=='5fa78e82f41e965516d6f39c7d82c1e7a7d8cad8d4ad0f9225076f0ec1cb07a4'
with zipfile.ZipFile(S)as z:m=json.loads(z.read('fieldnote-app/release-manifest.json'))
for row in m['files']:assert sha((A/row['path']).read_bytes())==row['sha256'],'Reviewed source changed'
def snap(path):
 c=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True);assert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)]and not c.execute('PRAGMA foreign_key_check').fetchall()
 schema=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall();rows={}
 for(name,)in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
  values=sorted(json.dumps(r,default=lambda b:{'blob':b.hex()})for r in c.execute('SELECT * FROM "'+name.replace('"','""')+'"'));rows[name]={'count':len(values),'sha256':sha(json.dumps(values).encode())}
 assert c.execute('SELECT count(*) FROM collection_schedules WHERE enabled!=0').fetchone()[0]==0
 saved=c.execute('SELECT bundle_sha256,accepted_count,missing_count FROM research_metric_imports WHERE run_id=?',(promotion['runId'],)).fetchone();assert saved==(promotion['bundleSha256'],promotion['accepted'],promotion['missing'])
 c.close();return {'schemaSha256':sha(json.dumps(schema).encode()),'tables':rows}
before=snap(DB);backup=R/'fieldnote-final-live-backup-20261012.sqlite';temporary=pathlib.Path(str(backup)+'.tmp');Z=R/'fieldnote-final-preview-checkpoint-20261012.zip';ZT=pathlib.Path(str(Z)+'.tmp');assert all(not p.exists()for p in[backup,temporary,Z,ZT]),'Checkpoint exists: inspect rather than overwrite'
s=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True);d=sqlite3.connect(temporary);s.backup(d);d.close();s.close();assert snap(temporary)==before and snap(DB)==before,'Backup restoration differs from current source'
os.chmod(temporary,0o600);os.link(temporary,backup);temporary.unlink()
files={}
def take(path,name,expected=None):
 p=pathlib.Path(path);assert p.is_file()and not p.is_symlink()and p.stat().st_size<=32*1024*1024;b=p.read_bytes();assert expected is None or sha(b)==expected,name+' hash mismatch';files[name]=b
for p,n in[(S,'source/reviewed-app-source.zip'),(backup,'database/final-live-backup.sqlite'),(B/'pre-metrics-current.sqlite','database/pre-metrics-rollback.sqlite')]:take(p,n)
P=R/'fieldnote-approved294-provenance-checkpoint-20261012.zip';assert sha(P.read_bytes())=='85419ce581d5e6a1fd8f49c5c5cd61075afe7d783a9f3977ea700521bdccb3a3'
with zipfile.ZipFile(P)as z:pilot=z.read('database/immutable-pilot.sqlite')
assert sha(pilot)=='4b3648e204d1606193b884a0b7278b789daeb7df78f4a8b6350130110f15d2aa';files['database/immutable-original-pilot.sqlite']=pilot

for n in['source-staging-verification.json','metric-import-verification.json','metric-import-dry-run.json','metric-import-apply-copy.json','metric-preservation.json','promotion-verification.json']:
 take(B/n,'reports/'+n)
for n in['reviews','players','reviews7d','reviews30d']:take(B/('api-final-'+n+'.json'),'reports/api-final-'+n+'.json')
take(B/'inputs/panel-metrics-reviewed.json','evidence/panel-metrics-reviewed.json',promotion['bundleSha256']);take(B/'inputs/final-ledger-reviewed.json','evidence/final-ledger-reviewed.json',promotion['finalLedgerSha256'])
take(B/'inputs/panel-294-frozen.json','evidence/panel-294-frozen.json','c9b5d6497d6a2d4ddf15f7ca07a8d87f2603ac89da8b7998ca03137830e84220');take(B/'inputs/passed-sentinel-evidence.json','evidence/passed-sentinel-evidence.json','a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f')
E=R/'fieldnote-panel294-results-20261012.zip'
with zipfile.ZipFile(E)as z:
 assert z.testzip()is None;em=json.loads(z.read('RESULT-MANIFEST.json'));assert em['runId']==promotion['runId']
 assert set(z.namelist())=={'RESULT-MANIFEST.json'}|{f['path']for f in em['files']}
 for f in em['files']:assert len(z.read(f['path']))==f['bytes']and sha(z.read(f['path']))==f['sha256']
 assert sha(z.read('panel-metrics-294-live.json'))==promotion['bundleSha256']and sha(z.read('authoritative-ledger-final.json'))==promotion['finalLedgerSha256']
 for n in z.namelist():
  if n.startswith('genre-reports/'):files[n]=z.read(n)
take(E,'evidence/complete-source-receipt-chain.zip')
def scan(v):
 if isinstance(v,dict):
  for k,x in v.items():
   assert k.lower()not in{'authorization','password','api_key','apikey','access_token','client_secret','steam_api_key','igdb_access_token','igdb_client_secret'};scan(x)
 elif isinstance(v,list):
  for x in v:scan(x)
 elif isinstance(v,str):assert not re.search(r'(?:[?&](?:key|api_key|access_token|token)=|\bBearer\s+[A-Za-z0-9._~-]{12,})',v,re.I)
for n,b in files.items():
 if n.endswith('.json'):scan(json.loads(b))
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'final_private_preview_checkpoint','appSourceSha256':sha(S.read_bytes()),'runId':promotion['runId'],'bundleSha256':promotion['bundleSha256'],'panelCount':294,'targetCount':300,'shortfallCount':6,'inventoryCount':before['tables']['games']['count'],'accepted':promotion['accepted'],'missing':promotion['missing'],'allPriorRowsPreserved':True,'sqliteBackupRestoreVerified':True,'currentDatabaseUnchangedDuringBackup':True,'databaseSnapshot':before,'privatePreview':promotion['deepLink'],'files':[{'path':n,'bytes':len(b),'sha256':sha(b)}for n,b in sorted(files.items())]};files['FINAL-CHECKPOINT-MANIFEST.json']=(json.dumps(manifest,indent=2)+'\n').encode()
assert snap(DB)==before,'Live database changed before checkpoint publication'
with zipfile.ZipFile(ZT,'x',zipfile.ZIP_DEFLATED)as z:
 for n,b in files.items():z.writestr(n,b)
try:
 assert ZT.stat().st_size<=32*1024*1024 and snap(DB)==before,'Live state changed or checkpoint too large'
 os.chmod(ZT,0o600);os.link(ZT,Z);ZT.unlink()
except BaseException:ZT.unlink(missing_ok=True);raise
print(json.dumps({'status':manifest['status'],'zip':str(Z),'bytes':Z.stat().st_size,'sha256':sha(Z.read_bytes()),'databaseBackup':str(backup),'databaseSha256':sha(backup.read_bytes()),'files':len(files),'panelCount':294,'inventoryCount':manifest['inventoryCount'],'accepted':promotion['accepted'],'missing':promotion['missing'],'sqliteBackupRestoreVerified':True},indent=2))
