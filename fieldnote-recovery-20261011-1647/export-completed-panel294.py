# Fixed-path completed metrics export. No provider/DB calls, no source/ledger writes.
import pathlib,json,hashlib,subprocess,shutil,os,zipfile,datetime,re,stat
W=pathlib.Path('/workspaces/codespaces-blank');R=W/'fieldnote-recovery-20261011-1647'
B=W/'fieldnote-panel294-run-20261012-1615';A=W/'fieldnote-keyless-addendum-20261012-1545';Q=W/'fieldnote-keyless-qualification-20261011-1901'
L=W/'fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert not pathlib.Path(str(L)+'.lock').exists(),'Collector still active'
raw=L.read_bytes();ledger=json.loads(raw);job=ledger['job']
assert job['schemaVersion']=='fieldnote-panel-metrics-1.0'and job['status']in['completed','completed_with_missing']
assert len(job['panel']['appids'])==294 and len(job['observations'])==1176
assert job['panel']['manifestSha256']=='dc3840a01e9d68b2e0f7ecef873ecba6fa6430eb847595eacd01e7d4e932e3b9'
assert job['limits']['maxRequests']==1276 and job['counters']['requests']<=1276
assert ledger['usedRequests']==1594+job['counters']['requests'] and ledger['bootstrapUsed']==786+job['counters']['requests']
assert job['windows']=={'seven':{'start':1791158400,'endExclusive':1791763200},'thirty':{'start':1789171200,'endExclusive':1791763200}}
paths={'output':str(B/'panel-metrics-294-live.json')};assert ledger['qualificationCampaign']['panelOutputPaths']==paths
mr=(B/'PANEL294-PACKAGE-MANIFEST.json').read_bytes();assert sha(mr)=='cc49b252a0d599ddf9f57504876f7310c5d9bed8486ae38e6f96a9e30991dd76';manifest=json.loads(mr)
for r in manifest['files']:
 p=B/r['path'];assert p.is_file()and not p.is_symlink()and sha(p.read_bytes())==r['sha256'],'Reviewed source/input changed'
node=shutil.which('node');assert node
code="import {readFile} from 'node:fs/promises';import {expectedExports} from './campaign-exports.mjs';const ledger=JSON.parse(await readFile("+json.dumps(str(L))+",'utf8'));const source=await readFile('./campaign-fixtures/resumed-candidates.json','utf8');const rows=expectedExports(ledger,source,"+json.dumps(paths)+");for(const r of rows){if(await readFile(r.path,'utf8')!==r.raw)throw Error('Export bytes mismatch');}console.log(JSON.stringify(rows.map(({role,path,sha256})=>({role,path,sha256}))));"
x=subprocess.run([node,'--input-type=module','-e',code],cwd=B,env={'PATH':str(pathlib.Path(node).parent)+':'+os.defpath},capture_output=True,text=True,timeout=60);assert x.returncode==0,'Pure export validation failed'
receipts=json.loads(x.stdout);assert len(receipts)==1
files={}
def take(p,n,expected=None):
 p=pathlib.Path(p);assert p.is_file()and not p.is_symlink()and p.stat().st_size<=32*1024*1024
 b=p.read_bytes();assert expected is None or sha(b)==expected,n+' hash mismatch';assert n not in files;files[n]=b
for r in receipts:take(r['path'],'panel-metrics-294-live.json',r['sha256'])
take(L,'authoritative-ledger-final.json')
take(B/'authoritative-ledger-before-panel294.json','authoritative-ledger-before-panel294.json','f14af4ede086cb7616335a17875a28770869ea9605a241c06e5c6b1ca154b705')
take(B/'panel-294-frozen.json','panel-294-frozen.json','c9b5d6497d6a2d4ddf15f7ca07a8d87f2603ac89da8b7998ca03137830e84220')
take(A/'qualification-campaign-785-live.json','prior-qualification-campaign-785.json','b31ba4d90a768c9ff191c8b4d54df9016ecc7df1a462e49bee35e7ea8c150532')
take(A/'qualification-addendum-160-live.json','prior-qualification-addendum-160.json','2ba091c6b2491c5f3ed6a225d8f92dd82bcbfdc3b65cfd1e8a14a83974dc5694')
take(Q/'qualification-625-live.json','prior-qualification-625.json','5ee28cd5f6be9b10f562916fa277a3b50b2bd59550f9ea3ae56814846742cd9d')
take(Q/'budget-baseline-live.json','budget-baseline-live.json','e8d3de391a89d7fb3fe2669cb486f4f4711d4a7eae9b1e2033a9cf97defb7a3d')
for n in ['staging-verification.json','codespaces-transition-dry-run.log','codespaces-offline-tests.log','PANEL294-PACKAGE-MANIFEST.json']:take(B/n,'staging/'+n)
take(R/'fieldnote-approved-panel294-source-v2-20261012.zip','reviewed-source-v2.zip','c0b4a9a367c14db6c5c0072fb487edb021c4e5694e2a32a7a6402d6e4b1e1c42')
G=R/'fieldnote-genre-report-20261012.zip';assert sha(G.read_bytes())=='b0c67aac0fccb2f40f585ecf76d9a70ddd2791f156e95c1668e6959b896b8c62'
with zipfile.ZipFile(G)as z:
 assert z.testzip()is None and len(z.namelist())==5 and len(set(z.namelist()))==5
 gm=json.loads(z.read('GENRE-MANIFEST.json'));assert set(z.namelist())=={'GENRE-MANIFEST.json'}|{r['path']for r in gm['files']}
 for i in z.infolist():
  p=pathlib.PurePosixPath(i.filename);assert len(p.parts)==1 and p.name not in ['.','..']and not stat.S_ISLNK(i.external_attr>>16)
 for r in gm['files']:
  b=z.read(r['path']);assert len(b)==r['bytes']and sha(b)==r['sha256'];files['genre-reports/'+r['path']]=b
 files['genre-reports/GENRE-MANIFEST.json']=z.read('GENRE-MANIFEST.json')
def scan(v):
 if isinstance(v,dict):
  for k,x in v.items():
   assert k.lower()not in{'authorization','password','api_key','apikey','access_token','client_secret','steam_api_key','igdb_access_token','igdb_client_secret'};scan(x)
 elif isinstance(v,list):
  for x in v:scan(x)
 elif isinstance(v,str):assert not re.search(r'(?:[?&](?:key|api_key|access_token|token)=|\bBearer\s+[A-Za-z0-9._~-]{12,})',v,re.I)
for n,b in files.items():
 if n.endswith('.json'):scan(json.loads(b))
assert L.read_bytes()==raw and not pathlib.Path(str(L)+'.lock').exists(),'Ledger changed during export'
result={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':job['status'],'runId':job['runId'],'startedAt':job['startedAt'],'finishedAt':job['finishedAt'],'panelCount':294,'originalTargetCount':300,'shortfallCount':6,'requests':job['counters']['requests'],'retries':job['counters']['retries'],'observations':len(job['observations']),'monthlyUsed':ledger['usedRequests'],'bootstrapUsed':ledger['bootstrapUsed'],'windows':job['windows'],'sourceAndInputHashesUnchanged':True,'prior785ReceiptsPreserved':True,'pureExportValidation':'passed','receipts':receipts,'files':[{'path':n,'bytes':len(b),'sha256':sha(b)}for n,b in sorted(files.items())]}
files['RESULT-MANIFEST.json']=(json.dumps(result,indent=2)+'\n').encode()
Z=R/'fieldnote-panel294-results-20261012.zip';assert not Z.exists(),'Export exists: do not overwrite'
with zipfile.ZipFile(Z,'x',zipfile.ZIP_DEFLATED)as z:
 for n,b in files.items():z.writestr(n,b)
os.chmod(Z,0o600)
print(json.dumps({k:result[k]for k in['status','runId','startedAt','finishedAt','panelCount','requests','retries','observations','monthlyUsed','bootstrapUsed']}|{'zip':str(Z),'bytes':Z.stat().st_size,'sha256':sha(Z.read_bytes()),'receipts':receipts},indent=2))
