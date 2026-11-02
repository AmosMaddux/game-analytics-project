import type {D1Database} from './db.ts';
import type {SourcePcRow} from './pc-release-policy.mjs';
export interface BroadCatalogRecord {
 appid:number;igdbId:number;name:string;sourceUrl:string;fetchedAt:string;sourceUpdatedAt:string|null;firstReleaseDate:string|null;
 gameType:{id:number;type:string};genres:{id:number;name:string|null}[];themes:{id:number;name:string|null}[];keywords:{id:number;name:string|null}[];
 gameModes:{id:number;name:string|null}[];playerPerspectives:{id:number;name:string|null}[];
 releaseDates:(SourcePcRow&{region?:{region:string}|null;fetchedAt:string})[];
 identity:{steamFetchedAt:string;steamName:string;status:string;typeBasis:string};
}
export async function latestResearchCatalog(db:D1Database,asOf:string):Promise<Map<number,BroadCatalogRecord>>{
 const result=await db.prepare('SELECT appid,raw_json,collected_at,import_id FROM research_catalog_records WHERE julianday(collected_at)<=julianday(?) ORDER BY julianday(collected_at),import_id').bind(asOf).all<{appid:number;raw_json:string}>();
 const rows=new Map<number,BroadCatalogRecord>();for(const row of result.results)rows.set(row.appid,JSON.parse(row.raw_json) as BroadCatalogRecord);return rows;
}
