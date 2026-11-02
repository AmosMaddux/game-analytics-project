import { CollectionError, ENDPOINTS } from './transport.mjs';
export const REVIEW_FILTERS=Object.freeze({filter:1,languages:['all'],review_type:0,purchase_type:0,filter_offtopic_activity:true,display_language:'english',num_per_page:1,cursor:'*'});
const uint=value=>Number.isSafeInteger(value)&&value>=0;
export function metricRequest(appid,metric) {
  if(!uint(appid)||appid<1||appid>4294967295)throw new CollectionError('invalid_appid');
  if(metric==='players')return `${ENDPOINTS.players}?appid=${appid}`;
  if(metric==='reviews')return `${ENDPOINTS.reviews}?${new URLSearchParams({input_json:JSON.stringify({appid,...REVIEW_FILTERS})})}`;
  throw new CollectionError('invalid_metric');
}
export function parseMetric(data,metric) {
  const response=data?.response??data;
  if(metric==='players') {
    if(response?.result!==1||!uint(response.player_count))throw new CollectionError('invalid_players_schema');
    return {value:response.player_count,unit:'concurrent_players',scope:'Steam-connected concurrent players at collection time; not owners, sales, daily average or historical peak.'};
  }
  const summary=response?.query_summary;
  const explicitEmpty=response?.reviews===undefined&&summary?.num_reviews===0&&response?.total_matching===0;
  if(!summary||!uint(summary.total_reviews)||!uint(summary.total_positive)||!uint(summary.total_negative)||summary.total_positive+summary.total_negative!==summary.total_reviews||(!explicitEmpty&&(!Array.isArray(response.reviews)||response.reviews.length>1)))throw new CollectionError('invalid_reviews_schema');
  // Deliberately discard every individual review, user identity and review text.
  return {value:summary.total_reviews,unit:'reviews',scope:'All-language, all-time Steam-purchase review API total; off-topic activity filtered. Not comparable to the English store summary.',filters:REVIEW_FILTERS,totalPositive:summary.total_positive,totalNegative:summary.total_negative};
}
export async function collectSteamMetrics({appids,transport,onObservation,onAttempt,completed=new Set(),now=()=>new Date()}={}) {
  if(!Array.isArray(appids)||appids.length>transport.limits.maxGames||new Set(appids).size!==appids.length)throw new CollectionError('invalid_target_set');
  const result={accepted:0,failed:0,skipped:0};
  for(const appid of appids)for(const metric of ['players','reviews']) {
    const itemKey=`${appid}:${metric}`;
    if(completed.has(itemKey)){result.skipped++;continue;}
    const url=metricRequest(appid,metric);
    try {
      const value=parseMetric(await transport.request(url),metric);
      const collectedAt=now().toISOString();
      await onObservation({appid,metric,...value,collectedAt,measuredAt:null,sourceUrl:url,sourceLabel:metric==='players'?'Steam Web API · current players':'Steam Web API · review query summary',methodVersion:'steam-aggregate-2.0'});
      await onAttempt?.({appid,metric,itemKey,status:'accepted',attemptedAt:collectedAt,errorCode:null});result.accepted++;
    }catch(error) {
      const errorCode=error instanceof CollectionError?error.code:'collection_failed';
      await onAttempt?.({appid,metric,itemKey,status:'failed',attemptedAt:now().toISOString(),errorCode});result.failed++;
      if(['access_denied','redirect_blocked','request_limit','byte_limit','runtime_limit','endpoint_blocked','throttled'].includes(errorCode))throw error;
    }
  }
  return result;
}
