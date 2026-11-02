# Run only after completed bundle + ledger are independently approved. Two required SHA arguments.
# Copy-only import into hardened source stage; leaves current4174 app/DB untouched.
import pathlib,json,hashlib,zipfile,sqlite3,collections,subprocess,shutil,os,time,re,sys,urllib.request,urllib.parse,datetime
W=pathlib.Path('/workspaces/codespaces-blank');OLD=W/'fieldnote-qualified-preview-20261012-1607';B=W/'fieldnote-final-preview-20261012-1706';A=B/'fieldnote-app';L=W/'fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json';M=W/'fieldnote-panel294-run-20261012-1615/panel-metrics-294-live.json';sha=lambda b:hashlib.sha256(b).hexdigest()
assert len(sys.argv)==3 and all(re.fullmatch('[a-f0-9]{64}',v)for v in sys.argv[1:]),'Supply reviewed bundle SHA and reviewed final ledger SHA'
assert not pathlib.Path(str(L)+'.lock').exists(),'Collection still active'
mr=M.read_bytes();lr=L.read_bytes();assert sha(mr)==sys.argv[1]and sha(lr)==sys.argv[2],'Final evidence hash mismatch'
bundle=json.loads(mr);ledger=json.loads(lr);assert ledger['job']['exportedBundle']=={'path':str(M),'sha256':sha(mr)}
assert bundle['status']in['completed','completed_with_missing']and len(bundle['observations'])==1176 and bundle['runId']=='panelmetrics-9a53ddb8-22e8-48f1-b765-e6406c988919'
sourceReport=json.loads((B/'source-staging-verification.json').read_bytes());assert sourceReport['testsPassed']==329 and sourceReport['sourceSha256']=='5fa78e82f41e965516d6f39c7d82c1e7a7d8cad8d4ad0f9225076f0ec1cb07a4'
assert sha((B/'inputs/source.zip').read_bytes())==sourceReport['sourceSha256']
with zipfile.ZipFile(B/'inputs/source.zip')as z:manifest=json.loads(z.read('fieldnote-app/release-manifest.json'))
for r in manifest['files']:assert sha((A/r['path']).read_bytes())==r['sha256'],'Reviewed source changed'
receiptRaw=(OLD/'switch-verification.json').read_bytes();receipt=json.loads(receiptRaw);assert receipt['status']=='approved294_preview_running'and receipt['app']==str(OLD/'fieldnote-app')and receipt['database']==str(OLD/'runtime-approved294.sqlite')
CURRENT=pathlib.Path(receipt['database']);BACKUP=B/'pre-metrics-current.sqlite';DB=B/'runtime-metrics294.sqlite'
assert all(not p.exists()for p in[BACKUP,DB,B/'metric-import-verification.json',B/'inputs/panel-metrics-reviewed.json',B/'inputs/final-ledger-reviewed.json']),'Prior staging exists: inspect rather than overwrite'
node=shutil.which('node');ss=shutil.which('ss');assert node and ss;env={'PATH':str(pathlib.Path(node).parent)+':'+os.defpath}
def listener(port):return set(int(s)for s in re.findall(r'pid=(\d+)',subprocess.check_output([ss,'-H','-ltnp','sport = :'+str(port)],text=True)))
def verify_current():
 pid=receipt['pid'];assert listener(4174)=={pid},'Live preview PID changed';p=pathlib.Path('/proc')/str(pid);assert(p/'cwd').resolve()==pathlib.Path(receipt['app']).resolve()
 args=[x.decode()for x in(p/'cmdline').read_bytes().split(b'\0')if x];assert len(args)==2 and pathlib.Path(args[0]).name=='node'and args[1]in['scripts/serve.mjs',str(pathlib.Path(receipt['app'])/'scripts/serve.mjs')]
 assert any(f.resolve()==CURRENT.resolve()for f in(p/'fd').iterdir()),'Live database mismatch'
verify_current();assert not listener(4175),'Temporary port4175 occupied'
def snapshot(p):
 c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);assert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)]and not c.execute('PRAGMA foreign_key_check').fetchall()
 schema=c.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall();rows={}
 for(name,)in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
  rows[name]=sorted(json.dumps(r,default=lambda b:{'blob':b.hex()})for r in c.execute('SELECT * FROM "'+name.replace('"','""')+'"'))
 c.close();return schema,rows
before=snapshot(CURRENT);c=sqlite3.connect(CURRENT.as_uri()+'?mode=ro',uri=True)
assert [r[0]for r in c.execute('SELECT name FROM local_migrations ORDER BY name')]==sorted(p.name for p in(A/'migrations').glob('*.sql'))
assert c.execute('SELECT count(*) FROM collection_schedules WHERE enabled!=0').fetchone()[0]==0
assert c.execute('SELECT count(*) FROM research_metric_imports WHERE run_id=?',(bundle['runId'],)).fetchone()[0]==0
with sqlite3.connect(BACKUP)as target:c.backup(target)
c.close();assert snapshot(BACKUP)==before and snapshot(CURRENT)==before,'Live database changed during snapshot'
for p,b in[(B/'inputs/panel-metrics-reviewed.json',mr),(B/'inputs/final-ledger-reviewed.json',lr)]:
 with p.open('xb')as f:f.write(b)
args=[node,'scripts/import-panel-metrics.mjs','--source',str(BACKUP),'--metrics',str(B/'inputs/panel-metrics-reviewed.json'),'--validation',str(B/'inputs/passed-sentinel-evidence.json'),'--panel',str(B/'inputs/panel-294-frozen.json')]
results={}
for name,cmd in[('dry-run',args),('apply-copy',args+['--apply-copy',str(DB)])]:
 x=subprocess.run(cmd,cwd=A,env=env,capture_output=True,text=True,timeout=120);assert x.returncode==0,'Importer '+name+' failed: '+x.stderr[:1000]
 result=json.loads(x.stdout);results[name]=result
 with(B/('metric-import-'+name+'.json')).open('x')as f:json.dump(result,f,indent=2)
known=sum(r['value']is not None for r in bundle['observations']);missing=1176-known;activity=sum(r['metric']in['reviews7d','reviews30d']and r['value']is not None for r in bundle['observations'])
assert results['apply-copy']['mode']=='applied_to_new_copy'and results['apply-copy']['accepted']==known and results['apply-copy']['missing']==missing
x=subprocess.run([node,'scripts/verify-research-preservation.mjs',str(BACKUP),str(DB),str(B/'metric-preservation.json'),'--allow-appends'],cwd=A,env=env,capture_output=True,text=True,timeout=120);assert x.returncode==0,'Raw-row preservation failed'
after=snapshot(DB);assert after[0]==before[0],'Unexpected schema change'
for name,rows in before[1].items():assert not(collections.Counter(rows)-collections.Counter(after[1][name])),'Prior row changed: '+name
allowed={'metric_observations':588,'research_activity_observations':activity,'research_metric_imports':1}
for name,rows in before[1].items():
 delta=len(after[1][name])-len(rows)
 if name=='research_review_contracts':assert delta in[0,1]
 else:assert delta==allowed.get(name,0),'Unexpected append count: '+name
assert snapshot(CURRENT)==before and snapshot(BACKUP)==before and L.read_bytes()==lr and not pathlib.Path(str(L)+'.lock').exists(),'Current evidence changed during import'
log=(B/'temporary4175.log').open('ab',buffering=0);server=subprocess.Popen([node,'scripts/serve.mjs'],cwd=A,env=env|{'FIELDNOTE_DB':str(DB),'PORT':'4175'},stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
def get(path):
 with urllib.request.urlopen('http://127.0.0.1:4175'+path,timeout=30)as r:return json.load(r)
try:
 h=None
 for _ in range(60):
  assert server.poll()is None,'Temporary server exited'
  try:h=get('/api/health');break
  except OSError:time.sleep(.25)
 assert h and h['status']=='ok'and h['gameCount']==1080 and h['liveCollectionEnabled']is False and h['backgroundCollectionEnabled']is False
 api={};asof=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
 for metric,sourceMetric in[('reviews','lifetimeReviews'),('players','players'),('reviews7d','reviews7d'),('reviews30d','reviews30d')]:
  q={'population':'panel','preset':'all','basis':'igdb_pc','taxonomy':'igdb_genre','metric':metric,'asOf':asof,'reviewAsOf':'2026-10-12T00:00:00Z'};v=get('/api/research/releases?'+urllib.parse.urlencode(q))
  assert v['population']['selectedCount']==294 and v['panel']['shortfallCount']==6 and len(v['taxonomy']['available'])==21
  expected={r['appid']:r for r in bundle['observations']if r['metric']==sourceMetric};assert len(v['audit'])==294
  for row in v['audit']:
   assert row['observation']['value']==expected[row['appid']]['value'],'API value mismatch: '+metric+':'+str(row['appid'])
   if row['observation']['value']is not None:assert row['observation']['collectedAt']==expected[row['appid']]['observedAt']
   elif sourceMetric=='players'and expected[row['appid']]['missingReason']=='source_http_404':
    assert row['observation']['collectedAt']==expected[row['appid']]['observedAt']and row['observation']['sourceUrl']==expected[row['appid']]['sourceUrl']and row['observation']['missingReason']=='source_http_404','Unavailable player provenance mismatch'

  if metric in['reviews7d','reviews30d']and any(r['value']is not None for r in expected.values()):assert v['reviewActivity']['status']=='available'and v['observations']['selected']['runId']==bundle['runId']
  elif metric in['reviews','players']:assert v['observations']['selected']['runId']==bundle['runId']and v['observations']['selected']['rowCount']==294
  with(B/('api-final-'+metric+'.json')).open('x')as f:json.dump(v,f,indent=2)
  api[metric]={'selectedRunId':v['observations']['selected']['runId']if v['observations']['selected']else None,'knownValues':sum(r['value']is not None for r in expected.values()),'missingValues':sum(r['value']is None for r in expected.values()),'eligibleReleaseCount':v['cohort']['eligibleCount']}
 tags=get('/api/research/releases?population=panel&preset=all&basis=igdb_pc&taxonomy=steam_tag&metric=reviews');assert len(tags['taxonomy']['available'])==20 and tags['taxonomy']['coveredCount']==1 and tags['taxonomy']['missingCount']==293
 legacy=get('/api/research/releases?population=legacy36&preset=all&basis=igdb_pc&metric=reviews');assert legacy['population']['selectedCount']==36
 get('/api/snapshot')
 assert snapshot(DB)==after and snapshot(CURRENT)==before and snapshot(BACKUP)==before,'Runtime changed database rows/schema';verify_current()
 report={'checkedAt':asof,'status':'reviewed_metrics_imported_to_new_copy_and_4175_verified_not_promoted','app':str(A),'database':str(DB),'backupDatabase':str(BACKUP),'currentDatabase':str(CURRENT),'currentPid':receipt['pid'],'currentSwitchReceiptSha256':sha(receiptRaw),'temporaryPid':server.pid,'temporaryPort':4175,'bundleSha256':sha(mr),'finalLedgerSha256':sha(lr),'runId':bundle['runId'],'accepted':known,'missing':missing,'activityRowsAdded':activity,'metricRowsAdded':588,'sourceTestsPassed':329,'allPriorRowsPreserved':True,'currentPreviewUnchanged':True,'schemaUnchanged':True,'health':h,'api':api,'steamTags':{'labels':20,'covered':1,'missing':293},'legacyCount':36,'currentLogicalSha256':sha(json.dumps(before).encode()),'targetLogicalSha256':sha(json.dumps(after).encode()),'databaseSha256':sha(DB.read_bytes()),'backupSha256':sha(BACKUP.read_bytes())}
 with(B/'metric-import-verification.json').open('x')as f:json.dump(report,f,indent=2)
 print(json.dumps(report,indent=2))
except BaseException:
 if server.poll()is None:server.terminate()
 raise
