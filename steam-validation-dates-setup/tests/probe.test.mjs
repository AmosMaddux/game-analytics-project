import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createTransport,createRouteAgent,requestSpec,parsePlayers,parseReviews,responseDiagnostic,runProbe,validatePilot,validateCurrentProof,LIMITS,PERIOD,ProbeError} from '../scripts/probe-core.mjs';
import {parseArgs} from '../scripts/steam-validation.mjs';
const cohort=JSON.parse(await readFile(new URL('../data/frozen-targets.json',import.meta.url),'utf8'));
const review=(id,t)=>({recommendationid:String(id),timestamp_created:t,review:'NEVER_SAVE_REVIEW_TEXT',author:{steamid:'NEVER_SAVE_AUTHOR_ID'},developer_response:'NEVER_SAVE_RESPONSE'});
const body=(reviews,total,{first=true,cursor='next'}={})=>({response:{query_summary:{num_reviews:reviews.length,...(first?{total_reviews:100,total_positive:80,total_negative:20}:{})},total_matching:total,reviews,cursor}});
function fixture(spec){
  if(spec.endpoint.includes('GetNumberOfCurrentPlayers'))return {kind:'json',http_status:200,bytes:70,data:{response:{player_count:0,result:1}}};
  const i=JSON.parse(new URL(spec.url).searchParams.get('input_json'));
  let rows=[review(1,1791580000)],total=100;
  if(i.date_range_start!==undefined){
    const start=i.date_range_start,end=i.date_range_end;
    if(start===PERIOD.start&&end===PERIOD.end){total=2;rows=i.cursor==='*'?[review(2,PERIOD.split+50),review(1,PERIOD.start+50)]:[];}
    else if(start===end){total=1;rows=[review(2,start)];}
    else {total=1;rows=[review(1,start+50)];}
  }
  return {kind:'json',http_status:200,bytes:500,data:body(rows,total,{first:i.cursor==='*',cursor:rows.length?'next':'done'})};
}
async function simulate(mode,override,options={}){
  let n=1791630000000,calls=0;const starts=[];
  const report=await runProbe({mode,cohort,now:()=>n,wait:async ms=>{n+=ms;},transport:async spec=>{starts.push(n);calls++;const r=override?await override(spec,calls):fixture(spec);n+=7;return r;},...options});
  return {report,calls,starts};
}
function fakeNetwork({status=200,data={response:{player_count:0,result:1}},headers={'content-type':'application/json'},chunks,neverEnd=false}={}){
  let calls=0,options,agentDestroyed=0;
  const request=(url,opts,cb)=>{
    calls++;options=opts;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.complete=false;let destroyed=false;res.destroy=()=>{destroyed=true;};cb(res);
      if(destroyed||neverEnd)return;
      for(const chunk of chunks??[Buffer.from(JSON.stringify(data))])res.emit('data',chunk);
      res.complete=true;res.emit('end');
    });return req;
  };
  const agentFactory=()=>({destroy(){agentDestroyed++;}});
  return {request,agentFactory,get calls(){return calls;},get options(){return options;},get agentDestroyed(){return agentDestroyed;}};
}

test('fixed cohort and historical failure/unattempted ledger are preserved',()=>{
  assert.equal(cohort.targets.length,36);assert.equal(new Set(cohort.targets.map(x=>x.appid)).size,36);
  assert.deepEqual(cohort.pilot_appids,[1472660,916350,2379780]);
  assert.equal(cohort.targets.find(x=>x.appid===1472660).name,'No Place Like Home');
  assert.equal(cohort.targets.find(x=>x.appid===916350).baseline_status.reviews_all_time,'network_proxy_refusal');
  assert.equal(cohort.original_date_window.start,PERIOD.start);assert.equal(cohort.original_date_window.end,PERIOD.end);
  assert.equal(new Date(PERIOD.split*1000).toISOString(),'2026-09-16T00:00:00.000Z');
});
test('strict arguments reject credentials, config, tags, hosts and unknown modes',()=>{
  for(const args of [[],['--run'],['--pilot','--key','SECRET'],['--env','.env'],['--config','x'],['--tags'],['--host','evil'],['--cohort'],['--cohort','--pilot-report','../x'],['--cohort','--pilot-report','outputs/pilot-ok/report.json','--key','x']])assert.throws(()=>parseArgs(args));
  assert.equal(parseArgs(['--pilot']).mode,'pilot');assert.equal(parseArgs(['--plan']).mode,'plan');
  assert.equal(parseArgs(['--cohort','--pilot-report','outputs/pilot-a/report.json']).mode,'cohort');
});
test('official request enums and inclusive bounds are explicit; no key',()=>{
  const s=requestSpec(916350,'reviews_all_time',{window:{start:PERIOD.start,end:PERIOD.end},cursor:'A+/=',pageSize:100});
  const i=JSON.parse(new URL(s.url).searchParams.get('input_json'));
  assert.deepEqual(i,{appid:916350,filter:1,languages:['all'],review_type:0,purchase_type:0,filter_offtopic_activity:true,display_language:'english',num_per_page:100,cursor:'A+/=',date_range_start:PERIOD.start,date_range_end:PERIOD.end,date_range_exclude:false});
  assert.equal(s.filters.cursor,'continuation_omitted');assert.equal(new URL(s.url).hostname,'api.steampowered.com');
  assert.throws(()=>requestSpec(1,'tags'));assert.throws(()=>requestSpec(1,'reviews_all_time',{pageSize:101}));assert.throws(()=>requestSpec(1,'reviews_all_time',{window:{start:5,end:4}}));
});
test('zero players stays zero; missing/negative/wrong result never substitutes zero',()=>{
  assert.equal(parsePlayers({response:{player_count:0,result:1}}).player_count,0);
  for(const d of [{result:1},{result:1,player_count:-1},{result:0,player_count:0},{result:1,player_count:'0'}])assert.throws(()=>parsePlayers(d));
});
test('review parsing saves only approved aggregates, never author/text/id/cursor',()=>{
  const p=parseReviews(body([review(999,PERIOD.start)],1),{window:{start:PERIOD.start,end:PERIOD.start}});
  const serialized=JSON.stringify(p.aggregate);for(const secret of ['NEVER_SAVE','recommendationid','steamid','999','next'])assert.equal(serialized.includes(secret),false);
  assert.equal(p.aggregate.total_matching,1);assert.equal(p.aggregate.query_summary_score_totals.total_reviews,100);
});
test('review parser fails on range violations, malformed counts, missing cursor and wrong ordering',()=>{
  const bad=[body([review(1,PERIOD.start-1)],1),body([review(1,PERIOD.end+1)],1)];
  for(const d of bad)assert.throws(()=>parseReviews(d,{window:{start:PERIOD.start,end:PERIOD.end}}),/out_of_range/);
  const a=body([review(1,1)],1);a.response.query_summary.num_reviews=2;assert.throws(()=>parseReviews(a),/page_count/);
  const b=body([review(1,1)],1);delete b.response.cursor;assert.throws(()=>parseReviews(b),/cursor/);
  assert.throws(()=>parseReviews(body([review(1,1),review(2,2)],2),{pageSize:100}),/sort/);
});
test('route config forwards only existing proxy settings; refuses credentials/unsupported route',()=>{
  let got;class Agent{constructor(opts){got=opts;}}
  createRouteAgent({env:{HTTPS_PROXY:'http://proxy.example:8080',NO_PROXY:'localhost',IGNORED_SECRET:'secret'},version:'24.21.0',Agent});
  assert.deepEqual(got.proxyEnv,{HTTPS_PROXY:'http://proxy.example:8080',NO_PROXY:'localhost'});assert.equal(got.rejectUnauthorized,true);
  for(const env of [{HTTPS_PROXY:'http://u:p@proxy:8080'},{HTTP_PROXY:'http://proxy:8080'},{ALL_PROXY:'socks://proxy:1'},{HTTPS_PROXY:'socks://proxy:1'}])assert.throws(()=>createRouteAgent({env,version:'24.21.0',Agent}));
  assert.throws(()=>createRouteAgent({env:{},version:'24.4.0',Agent}));
});
test('transport requires explicit route and rejects other host/parameters before network',async()=>{
  const f=fakeNetwork(),t=createTransport(f);
  await assert.rejects(()=>createTransport()(requestSpec(1,'current_players')),/explicit_route/);
  for(const url of ['https://evil.example/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=1',requestSpec(1,'current_players').url+'&key=secret',requestSpec(1,'reviews_all_time').url+'&key=secret'])await assert.rejects(()=>t({url}));
  const modified=requestSpec(1,'reviews_all_time');const u=new URL(modified.url);const i=JSON.parse(u.searchParams.get('input_json'));i.key='secret';u.searchParams.set('input_json',JSON.stringify(i));await assert.rejects(()=>t({...modified,url:u.href}));
  assert.equal(f.calls,0);
});
test('transport uses verified TLS GET with no auth/cookies and exact allowed headers',async()=>{
  const f=fakeNetwork(),r=await createTransport(f)(requestSpec(1,'current_players'));
  assert.equal(r.kind,'json');assert.equal(f.options.rejectUnauthorized,true);assert.equal(f.options.method,'GET');
  assert.deepEqual(Object.keys(f.options.headers).sort(),['Accept','Accept-Encoding','User-Agent']);assert.equal(f.agentDestroyed,1);
});
for(const [status,kind] of [[301,'redirect_refused'],[401,'access_denied'],[403,'access_denied'],[429,'rate_limited'],[500,'http_error']])test(`HTTP ${status} makes one attempt, no follow or retry`,async()=>{
  const f=fakeNetwork({status,headers:{location:'https://evil.example/?token=secret'}});const r=await createTransport(f)(requestSpec(1,'current_players'));
  assert.equal(r.kind,kind);assert.equal(f.calls,1);assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('body cap, invalid JSON/content-type and end-to-end timeout fail closed',async()=>{
  for(const [config,expected] of [[{chunks:[Buffer.alloc(LIMITS.body_bytes+1)]},'body_limit'],[{chunks:[Buffer.from('bad')]},'invalid_json'],[{headers:{'content-type':'text/html'}},'invalid_content_type'],[{neverEnd:true},'timeout']]){
    const f=fakeNetwork(config),r=await createTransport({...f,timeoutMs:10})(requestSpec(1,'current_players'));assert.equal(r.kind,expected);
  }
});
test('pilot is exactly three games / six sequential calls with all ledger categories visible',async()=>{
  const {report,calls,starts}=await simulate('pilot');assert.equal(calls,6);assert.equal(report.healthy,true);assert.equal(report.kind,'mock');
  assert.equal(report.targets.length,72);assert.equal(report.date_probe_targets.length,6);assert.equal(report.review_window_verdict,'not_attempted');
  assert.equal(report.baseline_category_counts.find(x=>x.category==='previous_failed_target').success,1);
  for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=1100);
});
test('403/429/network errors stop entire run and preserve unattempted targets',async()=>{
  for(const kind of ['access_denied','rate_limited','network_error']){
    const {report,calls}=await simulate('pilot',(s,n)=>n===2?{kind,http_status:kind==='rate_limited'?429:403,bytes:0}:fixture(s));
    assert.equal(calls,2);assert.equal(report.status,'stopped');assert.equal(report.healthy,false);assert.equal(report.targets.filter(x=>x.status==='not_attempted').length,70);
  }
});
test('cohort checks 36 identities and six paginated months with partition + inclusive boundary checks',async()=>{
  const {report,calls}=await simulate('cohort');assert.equal(calls,102);assert.equal(report.status,'completed');assert.equal(report.review_window_verdict,'bounded_six_window_checks_passed');
  assert.equal(report.date_probes.length,6);assert.ok(report.date_probes.every(x=>x.complete&&x.unique_reviews===2&&x.pages_attempted===2&&x.partition.sum_matches_month&&x.inclusive_boundary.exercised));
  assert.equal(report.coverage.find(x=>x.axis==='all').current_players_success,36);
  const data=JSON.stringify(report);for(const secret of ['NEVER_SAVE','recommendationid','steamid','"cursor":"next"'])assert.equal(data.includes(secret),false);
});
test('zero matching months never claim exercised date-boundary semantics',async()=>{
  const {report}=await simulate('cohort',s=>s.filters.date_range_start!==undefined?{kind:'json',http_status:200,bytes:100,data:body([],0)}:fixture(s));
  assert.equal(report.review_window_verdict,'inconclusive_or_incomplete');assert.ok(report.date_probes.every(x=>x.complete&&x.status==='inconclusive'&&!x.inclusive_boundary.exercised));
});
test('date failure is terminal incomplete and attempt counter includes failing page',async()=>{
  const {report,calls}=await simulate('cohort',(s,n)=>n===73?{kind:'rate_limited',http_status:429,bytes:0}:fixture(s));
  assert.equal(calls,73);assert.equal(report.date_probes[0].status,'incomplete');assert.equal(report.date_probes[0].pages_attempted,1);assert.equal(report.date_probe_targets[1].status,'not_attempted');
});
test('pagination cap, duplicate IDs and unstable totals do not imply complete history',async()=>{
  let page=0;
  const {report}=await simulate('cohort',s=>{
    if(s.filters.date_range_start===PERIOD.start&&s.filters.date_range_end===PERIOD.end){page++;return {kind:'json',http_status:200,bytes:100,data:body([review(1,PERIOD.split+50)],page%2?5:6,{first:s.filters.cursor==='*',cursor:`cursor-${page}`})};}
    return fixture(s);
  });
  assert.ok(report.date_probes.every(x=>!x.complete&&x.duplicate_reviews===3&&x.pages_attempted===4&&x.pagination_stop==='bounded_page_cap'));
  assert.equal(report.review_window_verdict,'inconclusive_or_incomplete');assert.ok(report.request_counts.attempted<=120);
});
test('cursor cannot stay unchanged on a nonempty page',async()=>{
  const {report}=await simulate('cohort',s=>s.filters.date_range_start===PERIOD.start&&s.filters.date_range_end===PERIOD.end?{kind:'json',http_status:200,bytes:10,data:body([review(1,PERIOD.start)],1,{cursor:'*'})}:fixture(s));
  assert.equal(report.stop_reason,'cursor_did_not_advance');assert.equal(report.date_probes[0].status,'incomplete');
});
test('pilot gate rejects mock/stale/future/failed/mismatched reports',async()=>{
  const {report}=await simulate('pilot',null,{kind:'live',bundleFingerprint:'fingerprint'});const now=Date.parse(report.finished_at);
  assert.equal(validatePilot(report,{fingerprint:'fingerprint',now}),true);
  for(const r of [{...report,kind:'mock'},{...report,healthy:false},{...report,mode:'cohort'},{...report,bundle_fingerprint:'changed'},{...report,finished_at:new Date(now-86400001).toISOString()},{...report,finished_at:new Date(now+300001).toISOString()}])assert.throws(()=>validatePilot(r,{fingerprint:'fingerprint',now}));
});
test('run time cap stops before dispatch and never fabricates missing values',async()=>{
  let n=1791630000000,count=0;
  const report=await runProbe({mode:'cohort',cohort,now:()=>n,wait:async ms=>{n+=ms;},transport:async s=>{count++;n+=20000;return fixture(s);}});
  assert.equal(report.stop_reason,'run_time_cap_reached');assert.ok(count<72);assert.ok(report.targets.some(x=>x.status==='not_attempted'));
});

test('failure diagnostics expose only fixed schema names and types',async()=>{
  const raw={response:{query_summary:{num_reviews:'SECRET_VALUE'},reviews:[],PRIVATE_SECRET_KEY:'SECRET_VALUE',author:{steamid:'PRIVATE_ID'}}};
  const d=responseDiagnostic(raw);assert.equal(d.known_field_shapes['query_summary.num_reviews'],'string');assert.equal(JSON.stringify(d).includes('SECRET'),false);assert.equal(JSON.stringify(d).includes('PRIVATE'),false);
  const {report}=await simulate('pilot',(s,n)=>n===2?{kind:'json',http_status:200,bytes:15,data:raw}:fixture(s));
  assert.equal(report.observations[1].error_code,'invalid_reviews_schema');assert.deepEqual(report.observations[1].response_diagnostic,d);assert.equal(JSON.stringify(report).includes('SECRET'),false);
});

test('pilot gate rejects duplicated targets and altered filters',async()=>{
  const {report}=await simulate('pilot',null,{kind:'live',bundleFingerprint:'fingerprint'});const opts={fingerprint:'fingerprint',now:Date.parse(report.finished_at)};
  const duplicate=structuredClone(report);duplicate.observations[1]=duplicate.observations[0];assert.throws(()=>validatePilot(duplicate,opts),/targets/);
  const filters=structuredClone(report);filters.observations[1].filters.purchase_type=1;assert.throws(()=>validatePilot(filters,opts),/filters/);
});

test('checkpoint latency cannot collapse dispatch spacing or overrun run budget',async()=>{
  let n=1791630000000;const starts=[];
  const r=await runProbe({mode:'pilot',cohort,now:()=>n,wait:async ms=>{n+=ms;},onCheckpoint:async()=>{n+=2000;},transport:async spec=>{starts.push(n);return fixture(spec);}});
  assert.equal(r.status,'completed');for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=1100);
  let m=1791630000000,calls=0;const capped=await runProbe({mode:'pilot',cohort,now:()=>m,wait:async ms=>{m+=ms;},onCheckpoint:async()=>{m+=600001;},transport:async spec=>{calls++;return fixture(spec);}});
  assert.equal(capped.stop_reason,'run_time_cap_reached');assert.equal(calls,0);assert.equal(capped.request_counts.attempted,0);
});

test('pre-dispatch deadline does not count an unattempted date page',async()=>{
  const start=1791630000000;let n=start;
  const report=await runProbe({mode:'cohort',cohort,now:()=>n,wait:async ms=>{n+=ms;},transport:async s=>fixture(s),onCheckpoint:async r=>{if(r.date_probes.length&&r.observations.length===72)n=start+600001;}});
  assert.equal(report.request_counts.attempted,72);assert.equal(report.date_probes[0].pages_attempted,0);assert.equal(report.date_probes[0].pages_successful,0);assert.equal(report.date_probes[0].status,'incomplete');
});


test('omitted review array is accepted only with explicit zero page count and safe first-page total',()=>{
  const empty=body([],0);delete empty.response.reviews;
  const parsed=parseReviews(empty);assert.equal(parsed.aggregate.returned_count,0);assert.equal(parsed.aggregate.empty_array_omitted,true);
  for(const mutate of [d=>{delete d.response.query_summary.num_reviews;},d=>{d.response.query_summary.num_reviews=1;},d=>{d.response.reviews=null;},d=>{d.response.total_matching=2;},d=>{delete d.response.total_matching;},d=>{delete d.response.query_summary.total_positive;}]){
    const d=structuredClone(empty);mutate(d);assert.throws(()=>parseReviews(d));
  }
});
test('omitted terminal continuation array keeps nonzero overall matching count',()=>{
  const terminal=body([],2,{first:false,cursor:'done'});delete terminal.response.reviews;
  const p=parseReviews(terminal,{firstPage:false,pageSize:100,window:{start:PERIOD.start,end:PERIOD.end}});
  assert.equal(p.aggregate.returned_count,0);assert.equal(p.aggregate.total_matching,2);assert.equal(p.aggregate.empty_array_omitted,true);
});
test('date-only mode cannot replay current snapshots; omitted zero windows remain explicit',async()=>{
  const {report,calls}=await simulate('dates',s=>{
    assert.ok(s.filters.date_range_start!==undefined);assert.ok(s.endpoint.includes('IUserReviewsService'));
    const d=body([],0);delete d.response.reviews;return {kind:'json',http_status:200,bytes:191,data:d};
  });
  assert.equal(calls,18);assert.equal(report.mode,'dates');assert.equal(report.limits.request_cap,42);assert.equal(report.observations.filter(o=>o.purpose==='current_snapshot').length,0);
  assert.equal(report.review_window_verdict,'inconclusive_or_incomplete');assert.ok(report.date_probes.every(x=>x.complete&&x.unique_reviews===0&&!x.inclusive_boundary.exercised));
});
test('date-only nonempty pagination still requires terminal completeness',async()=>{
  const {report,calls}=await simulate('dates',s=>{
    const r=fixture(s);if(r.data.response.reviews.length===0)delete r.data.response.reviews;return r;
  });
  assert.equal(calls,30);assert.equal(report.review_window_verdict,'bounded_six_window_checks_passed');assert.ok(report.date_probes.every(x=>x.complete));
});
test('pinned live prior cohort admits only the original HTTP200 schema recovery',async()=>{
  const actual=JSON.parse(await readFile(new URL('../data/prior-cohort-report.json',import.meta.url),'utf8'));
  const opts={appids:cohort.targets.map(x=>x.appid),now:Date.parse(actual.finished_at)+1000};
  const proof=validateCurrentProof(actual,opts);assert.equal(proof.accepted_current_player_games,36);assert.equal(proof.accepted_review_games,36);assert.equal(proof.prior_failure_reclassified,false);
  for(const change of [r=>{r.observations[0].status='failed';},r=>{r.observations[0].appid=999;},r=>{r.observations[1].filters.purchase_type=1;},r=>{r.observations.at(-1).http_status=403;},r=>{r.stop_reason='access_denied';},r=>{r.observations.at(-1).error_code='network_error';},r=>{r.observations[0].aggregate.player_count=-1;}]){
    const r=structuredClone(actual);change(r);assert.throws(()=>validateCurrentProof(r,opts));
  }
  assert.throws(()=>validateCurrentProof(actual,{...opts,now:Date.parse(actual.finished_at)+86400001}));
});
test('diagnostic numeric fields are only validated aggregate counts',()=>{
  const d=responseDiagnostic({response:{query_summary:{num_reviews:0},total_matching:0}});assert.deepEqual(d.known_numeric_counts,{num_reviews:0,total_matching:0});
  const invalid=responseDiagnostic({response:{query_summary:{num_reviews:'PRIVATE'},total_matching:-1}});assert.deepEqual(invalid.known_numeric_counts,{num_reviews:null,total_matching:null});assert.equal(JSON.stringify(invalid).includes('PRIVATE'),false);
});


