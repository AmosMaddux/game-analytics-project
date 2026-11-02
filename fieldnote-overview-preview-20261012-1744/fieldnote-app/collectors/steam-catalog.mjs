import { ENDPOINTS, CollectionError } from './transport.mjs';
import { normalizeAppList } from './steam-catalog-probe.mjs';
/** Public game identity fields only; no keyed URL, key or request body is retained. */
export async function collectSteamCatalog({transport,checkpoint={},onCheckpoint,now=()=>new Date()}={}) {
  let cursor=checkpoint.cursor??0,pageIndex=checkpoint.pageIndex??0;
  const apps=new Map((checkpoint.apps??[]).map(item=>[item.appid,item]));
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(pageIndex)||pageIndex<0||pageIndex>transport.limits.maxPages)throw new CollectionError('invalid_catalog_checkpoint');
  let complete=checkpoint.complete===true;
  while(!complete&&pageIndex<transport.limits.maxPages) {
    const input={include_games:true,include_dlc:false,include_software:false,include_videos:false,include_hardware:false,last_appid:cursor,max_results:50000};
    const data=await transport.request(ENDPOINTS.steamCatalog,JSON.stringify(input));
    const response=data?.response;
    if(!response||!Array.isArray(response.apps)||response.apps.length>50000)throw new CollectionError('invalid_catalog_response');
    const page=response.apps.length?normalizeAppList({applist:{apps:response.apps}}):[];
    if(page.some((item,index)=>item.appid<=cursor||(index>0&&item.appid<=page[index-1].appid)))throw new CollectionError('invalid_catalog_order');
    for(const item of page) {if(apps.has(item.appid)&&apps.get(item.appid).name!==item.name)throw new CollectionError('conflicting_catalog_identity');apps.set(item.appid,item);}
    if(page.length)cursor=page.at(-1).appid;
    pageIndex++;transport.counters.pages=pageIndex;
    complete=response.have_more_results===false||(response.have_more_results===undefined&&page.length<50000);
    if(!page.length&&!complete)throw new CollectionError('catalog_pagination_stalled');
    await onCheckpoint?.({cursor,pageIndex,apps:[...apps.values()],complete});
  }
  if(!complete)throw new CollectionError('page_limit');
  return {version:'steam-catalog-evidence-1.0',source:'Steam',sourceUrl:ENDPOINTS.steamCatalog,sourceStatus:'official_game_only_catalog',status:'complete',collectedAt:now().toISOString(),apps:[...apps.values()],pageCount:pageIndex};
}
