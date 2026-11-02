# Read-only saved-counter observation. No network, environment or process-argument reads.
import pathlib,json,datetime,hashlib
P=pathlib.Path('/workspaces/codespaces-blank/fieldnote-redesign-stage-20261011/pilot-20261011-1746/fieldnote-source-budget-2026-10.json')
L=json.loads(P.read_bytes());j=L['job'];lock=pathlib.Path(str(P)+'.lock')
lockdata=json.loads(lock.read_bytes()) if lock.exists() else {}
obs=j.get('observations',[]);c=j.get('counters',{})
result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'schemaVersion':j.get('schemaVersion'),'status':j.get('status'),'errorCode':j.get('errorCode'),'permanentStop':j.get('permanentStop'),'runId':j.get('runId'),'startedAt':j.get('startedAt'),'finishedAt':j.get('finishedAt'),'requests':c.get('requests'),'retries':c.get('retries'),'observations':len(obs),'latestObservedAt':obs[-1].get('observedAt') if obs else None,'elapsedMs':c.get('elapsedMs'),'monthlyUsed':L['usedRequests'],'bootstrapUsed':L['bootstrapUsed'],'lockPresent':lock.exists(),'lockPid':lockdata.get('pid'),'lockStartedAt':lockdata.get('startedAt'),'pendingReservation':bool(j.get('pending'))}
print(json.dumps(result,indent=2))
