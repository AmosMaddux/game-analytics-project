# Separate authorized promotion after stage/API review. Guard exact receipt PIDs and logical DB state.
import pathlib,json,hashlib,zipfile,sqlite3,subprocess,shutil,os,signal,time,re,urllib.request,datetime
W=pathlib.Path('/workspaces/codespaces-blank');OLD=W/'fieldnote-qualified-preview-20261012-1607';B=W/'fieldnote-final-preview-20261012-1706';A=B/'fieldnote-app';DB=B/'runtime-metrics294.sqlite';sha=lambda b:hashlib.sha256(b).hexdigest()
r=json.loads((B/'metric-import-verification.json').read_bytes());assert r['status']=='reviewed_metrics_imported_to_new_copy_and_4175_verified_not_promoted'and r['app']==str(A)and r['database']==str(DB)
oldraw=(OLD/'switch-verification.json').read_bytes();assert sha(oldraw)==r['currentSwitchReceiptSha256'];old=json.loads(oldraw);OLD_A=pathlib.Path(old['app']);OLD_DB=pathlib.Path(old['database']);assert old['pid']==r['currentPid']and OLD_A==OLD/'fieldnote-app'and OLD_DB==OLD/'runtime-approved294.sqlite'
assert all(not(B/n).exists()for n in['promotion-attempt.json','promotion-verification.json','promotion-rollback-verification.json']),'Prior promotion attempt exists; inspect rather than retry'
assert sha((B/'inputs/source.zip').read_bytes())=='5fa78e82f41e965516d6f39c7d82c1e7a7d8cad8d4ad0f9225076f0ec1cb07a4'
with zipfile.ZipFile(B/'inputs/source.zip')as z:m=json.loads(z.read('fieldnote-app/release-manifest.json'))
for f in m['files']:assert sha((A/f['path']).read_bytes())==f['sha256'],'Reviewed source changed'
node=shutil.which('node');ss=shutil.which('ss');assert node and ss
baseenv={'PATH':str(pathlib.Path(node).parent)+':'+os.defpath}
def listener(port):return set(int(x)for x in re.findall(r'pid=(\d+)',subprocess.check_output([ss,'-H','-ltnp','sport = :'+str(port)],text=True)))
def verify(pid,app,db,port):
 assert listener(port)=={pid},'Unexpected port listener';p=pathlib.Path('/proc')/str(pid);assert(p/'cwd').resolve()==app.resolve()
 args=[x.decode()for x in(p/'cmdline').read_bytes().split(b'\0')if x];assert len(args)==2 and pathlib.Path(args[0]).name=='node'and args[1]in['scripts/serve.mjs',str(app/'scripts/serve.mjs')]
 assert any(f.resolve()==db.resolve()for f in(p/'fd').iterdir()),'Listener database mismatch'
def snapshot(p):
 c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);assert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)]and not c.execute('PRAGMA foreign_key_check').fetchall()
 schema=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall();rows={}
 for(name,)in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
  rows[name]=sorted(json.dumps(v,default=lambda b:{'blob':b.hex()})for v in c.execute('SELECT * FROM "'+name.replace('"','""')+'"'))
 assert c.execute('SELECT count(*) FROM collection_schedules WHERE enabled!=0').fetchone()[0]==0;c.close();return schema,rows
prior=snapshot(OLD_DB);target=snapshot(DB);assert sha(json.dumps(prior).encode())==r['currentLogicalSha256']and snapshot(pathlib.Path(r['backupDatabase']))==prior,'Current database changed since staging; rebase safely before promotion'
assert sha(json.dumps(target).encode())==r['targetLogicalSha256'],'Staged metric database changed'
verify(old['pid'],OLD_A,OLD_DB,4174);verify(r['temporaryPid'],A,DB,4175)
with(B/'promotion-attempt.json').open('x')as f:json.dump({'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'previousPid':old['pid'],'previousApp':str(OLD_A),'previousDatabase':str(OLD_DB),'targetDatabase':str(DB),'bundleSha256':r['bundleSha256']},f,indent=2)
log=(B/'port4174.log').open('ab',buffering=0)
def start(app,db):return subprocess.Popen([node,'scripts/serve.mjs'],cwd=app,env=baseenv|{'FIELDNOTE_DB':str(db),'PORT':'4174'},stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
def get(path):
 with urllib.request.urlopen('http://127.0.0.1:4174'+path,timeout=30)as response:return json.load(response)
def health(process):
 for _ in range(60):
  assert process.poll()is None,'Replacement exited'
  try:
   h=get('/api/health')
   if h['status']=='ok'and h['gameCount']==1080 and h['liveCollectionEnabled']is False and h['backgroundCollectionEnabled']is False:return h
  except OSError:pass
  time.sleep(.25)
 raise RuntimeError('Replacement health deadline')
os.kill(old['pid'],signal.SIGTERM)
for _ in range(60):
 if not listener(4174):break
 time.sleep(.25)
assert not listener(4174),'Old server did not release port; no replacement started'
current=None
try:
 current=start(A,DB);h=health(current);verify(current.pid,A,DB,4174)
 v=get('/api/research/releases?population=panel&preset=all&basis=igdb_pc&taxonomy=igdb_genre&metric=reviews7d&reviewAsOf=2026-10-12T00%3A00%3A00Z')
 assert v['panel']['selectedCount']==294 and v['panel']['shortfallCount']==6 and len(v['taxonomy']['available'])==21 and v['observations']['selected']['runId']==r['runId']and v['reviewActivity']['status']=='available'
 assert snapshot(OLD_DB)==prior and snapshot(DB)==target,'Database changed during standard launch'
 verify(r['temporaryPid'],A,DB,4175);os.kill(r['temporaryPid'],signal.SIGTERM)
 result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'final_294_metrics_preview_running','pid':current.pid,'port':4174,'app':str(A),'database':str(DB),'health':h,'panelCount':294,'targetCount':300,'shortfallCount':6,'panelGenres':21,'runId':r['runId'],'bundleSha256':r['bundleSha256'],'finalLedgerSha256':r['finalLedgerSha256'],'accepted':r['accepted'],'missing':r['missing'],'priorPreviewPreserved':True,'schemaAndRowsUnchangedDuringLaunch':True,'stoppedPriorPid':old['pid'],'stoppedTemporaryPid':r['temporaryPid'],'rollbackApp':str(OLD_A),'rollbackDatabase':str(OLD_DB),'rollbackBackup':r['backupDatabase'],'deepLink':'https://didactic-space-carnival-rw456rp5jqxhp674-4174.app.github.dev/#/releases?population=panel&preset=all&basis=igdb_pc&taxonomy=igdb_genre&metric=reviews7d&reviewAsOf=2026-10-12T00%3A00%3A00Z'}
 with(B/'promotion-verification.json').open('x')as f:json.dump(result,f,indent=2)
 print(json.dumps(result,indent=2))
except BaseException:
 if current is not None and current.poll()is None:current.terminate();current.wait(timeout=15)
 assert not listener(4174),'Rollback stopped because port has unexpected listener'
 restored=start(OLD_A,OLD_DB);h=health(restored);verify(restored.pid,OLD_A,OLD_DB,4174)
 with(B/'promotion-rollback-verification.json').open('x')as f:json.dump({'status':'prior294_preview_restored_after_failed_promotion','pid':restored.pid,'health':h,'app':str(OLD_A),'database':str(OLD_DB)},f,indent=2)
 raise
