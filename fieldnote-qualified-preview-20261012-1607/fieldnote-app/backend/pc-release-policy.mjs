/** Source-reported IGDB PC metadata only; never verifies Steam launch or 1.0. */
export const PC_RELEASE_POLICY='igdb-pc-earliest-unambiguous-v2';
const key=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[ _-]/g,''):'';
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function selectSourcePcDate(releaseDates,asOf){
 const pc=releaseDates.filter(row=>row.platform?.id===6);
 const playable=row=>row.status==null||['fullrelease','earlyaccess'].includes(key(row.status?.name));
 const exact=row=>row.dateFormat?.id===0&&['yyyymmdd','yyyymmmmdd'].includes(key(row.dateFormat.format))&&instant(row.date)&&Date.parse(row.date)<=Date.parse(asOf)&&playable(row);
 const rows=pc.filter(exact).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id-b.id);
 if(!rows.length)return {date:null,precision:'unknown',evidenceId:null,reason:'no_exact_past_playable_pc_date'};const first=rows[0];
 const lowerBound=row=>{if(!instant(row.date))return null;const year=row.year??Number(row.date.slice(0,4)),month=row.month??Number(row.date.slice(5,7));if(row.dateFormat?.id===0)return row.date;if(row.dateFormat?.id===1&&year>=1&&year<=9999&&month>=1&&month<=12)return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-01T00:00:00.000Z`;if(row.dateFormat?.id===2&&year>=1&&year<=9999)return `${String(year).padStart(4,'0')}-01-01T00:00:00.000Z`;if([3,4,5,6].includes(row.dateFormat?.id)&&year>=1&&year<=9999)return `${String(year).padStart(4,'0')}-${String((row.dateFormat.id-3)*3+1).padStart(2,'0')}-01T00:00:00.000Z`;return null;};
 if(pc.some(row=>!exact(row)&&(!lowerBound(row)||Date.parse(lowerBound(row))<=Date.parse(first.date))&&!['alpha','beta','cancelled','canceled','prerelease','prereleased'].includes(key(row.status?.name))))return {date:null,precision:'unknown',evidenceId:null,reason:'earlier_or_undated_pc_release_unresolved'};
 return {date:first.date.slice(0,10),precision:'day',evidenceId:first.id,sourceStatus:first.status?.name??'not_reported',reason:'earliest_known_exact_igdb_pc_date_not_steam_first_playable'};
}
