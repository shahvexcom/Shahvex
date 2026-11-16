/** Preserve every byte of operator comments; replace only this call's owned block. */
export function mergeCallComments(existing:string, summary:string, callId:string, limit=255, requireFullSummary=false) {
 const start=`[SV:${callId}]`,end='[/SV]';
 const from=existing.indexOf(start),to=from<0?-1:existing.indexOf(end,from);
 if(from>=0&&to<0)throw Error('Incomplete Shahvex comment marker; manual reconciliation required');
 const prefix=from<0?existing:existing.slice(0,from),suffix=from<0?'':existing.slice(to+end.length);
 const marker=`${start}${summary.replace(/;/g,'').replace(/[\r\n|]/g,' ')}${end}`;
 const separator=prefix&&!prefix.endsWith(' ')?' ':'';
 if(prefix.length+suffix.length+separator.length+marker.length<=limit)return prefix+separator+marker+suffix;
 if(requireFullSummary)throw Error('Native comments capacity cannot hold the complete collected information; existing notes preserved');
 const reference=`${start}Details on website${end}`;
 if(prefix.length+suffix.length+separator.length+reference.length>limit)throw Error('Native comments full; operator comments preserved, transfer blocked');
 return prefix+separator+reference+suffix;
}
