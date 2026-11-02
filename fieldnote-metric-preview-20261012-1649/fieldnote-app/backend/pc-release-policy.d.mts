export interface SourcePcRow {id:number;date:string|null;year?:number|null;month?:number|null;platform?:{id:number}|null;dateFormat?:{id:number;format?:string|null}|null;status?:{name:string}|null}
export const PC_RELEASE_POLICY:string;
export function selectSourcePcDate(rows:SourcePcRow[],asOf:string):{date:string|null;precision:'day'|'unknown';evidenceId:number|null;reason:string;sourceStatus?:string};
