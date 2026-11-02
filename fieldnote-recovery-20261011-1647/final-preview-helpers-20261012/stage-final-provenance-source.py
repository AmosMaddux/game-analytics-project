# Approved hardened source staging only; no database or live-server changes.
import pathlib,hashlib,json,zipfile,stat,io,subprocess,shutil,os,re,datetime
W=pathlib.Path('/workspaces/codespaces-blank');R=W/'fieldnote-recovery-20261011-1647';B=W/'fieldnote-final-preview-20261012-1706';A=B/'fieldnote-app';Z=R/'fieldnote-approved294-provenance-checkpoint-20261012.zip';sha=lambda b:hashlib.sha256(b).hexdigest()
assert not B.exists(),'Stage exists: inspect rather than overwrite'
assert Z.is_file() and not Z.is_symlink() and Z.stat().st_size==6638097 and sha(Z.read_bytes())=='85419ce581d5e6a1fd8f49c5c5cd61075afe7d783a9f3977ea700521bdccb3a3'
node=shutil.which('node');npm=shutil.which('npm');assert node and npm
assert subprocess.check_output([node,'--version'],text=True).strip().startswith('v24.')
def safe(z):
 assert z.testzip()is None and len(z.namelist())==len(set(z.namelist()))
 for i in z.infolist():
  p=pathlib.PurePosixPath(i.filename);assert not p.is_absolute() and '..'not in p.parts and not stat.S_ISLNK(i.external_attr>>16)
  assert not any(x in['.git','node_modules','.runs']or x.startswith('.env')for x in p.parts)
with zipfile.ZipFile(Z)as z:
 safe(z);m=json.loads(z.read('CHECKPOINT-MANIFEST.json'));assert set(z.namelist())=={'CHECKPOINT-MANIFEST.json'}|{r['path']for r in m['files']}
 for r in m['files']:
  b=z.read(r['path']);assert len(b)==r['bytes']and sha(b)==r['sha256']
 assert m['aggregateTestsPassed']==329 and m['selectedCount']==294 and m['shortfallCount']==6
 source=z.read('source/fieldnote-panel-reconstruction-offline.zip');assert sha(source)=='5fa78e82f41e965516d6f39c7d82c1e7a7d8cad8d4ad0f9225076f0ec1cb07a4'
 B.mkdir(mode=0o700);(B/'inputs').mkdir(mode=0o700)
 for n,b in [('source.zip',source),('CHECKPOINT-MANIFEST.json',z.read('CHECKPOINT-MANIFEST.json')),('panel-294-frozen.json',z.read('evidence/panel294.json')),('passed-sentinel-evidence.json',z.read('evidence/passed-sentinels.json'))]:
  with(B/'inputs'/n).open('xb')as f:f.write(b)
 with zipfile.ZipFile(io.BytesIO(source))as inner:
  safe(inner);sm=json.loads(inner.read('fieldnote-app/release-manifest.json'));assert set(inner.namelist())=={'fieldnote-app/release-manifest.json'}|{'fieldnote-app/'+r['path']for r in sm['files']}
  for r in sm['files']:
   b=inner.read('fieldnote-app/'+r['path']);assert len(b)==r['bytes']and sha(b)==r['sha256']
  inner.extractall(B)
assert sha((B/'inputs/panel-294-frozen.json').read_bytes())=='c9b5d6497d6a2d4ddf15f7ca07a8d87f2603ac89da8b7998ca03137830e84220'
assert sha((B/'inputs/passed-sentinel-evidence.json').read_bytes())=='a8efd1423272343178ed1813ad03660a18e74169f032c0e06fceb90bd2e40b6f'
(B/'npm-home').mkdir();(B/'npm-home/user.npmrc').touch();(B/'npm-home/global.npmrc').touch();env={'PATH':str(pathlib.Path(node).parent)+':'+os.defpath,'HOME':str(B/'npm-home'),'NPM_CONFIG_USERCONFIG':str(B/'npm-home/user.npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(B/'npm-home/global.npmrc'),'NPM_CONFIG_REGISTRY':'https://registry.npmjs.org'}
for label,cmd,limit in [('npm-ci',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],300),('npm-check',[npm,'run','check'],300)]:
 x=subprocess.run(cmd,cwd=A,env=env,capture_output=True,text=True,timeout=limit)
 with(B/(label+'.log')).open('x')as f:f.write(x.stdout+x.stderr)
 assert x.returncode==0,label+' failed; inspect only its named log'
 if label=='npm-check':assert re.search(r'(?:#|ℹ) tests 329\b',x.stdout),'Unexpected test count'
for r in sm['files']:assert sha((A/r['path']).read_bytes())==r['sha256'],'Reviewed source/build changed'
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'hardened_source_staged_329_tests_passed_no_database_or_runtime_change','app':str(A),'checkpointSha256':sha(Z.read_bytes()),'sourceSha256':sha(source),'testsPassed':329,'databaseRead':False,'databaseWritten':False,'serverStarted':False}
with(B/'source-staging-verification.json').open('x')as f:json.dump(report,f,indent=2)
print(json.dumps(report,indent=2))
