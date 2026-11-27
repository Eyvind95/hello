'use strict';
// Evidence-only, no website importer, mutations, Firebase or delete plan.
const crypto=require('node:crypto');
const native=require('./chrome-extension/predecessor-chat-core.js');
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(bytes,expected){
 check(Buffer.isBuffer(bytes)&&/^[a-f0-9]{64}$/.test(expected)&&digest(bytes)===expected,'原件 SHA-256 不符');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
const normalize=t=>t.replace(/\s/gu,'');
const role=r=>({me:'user',ai:'assistant',user:'user',assistant:'assistant'})[r];
const split=(t,i)=>i>0&&i<t.length&&/[\uD800-\uDBFF]/.test(t[i-1])&&/[\uDC00-\uDFFF]/.test(t[i]);
function source(bytes,expected){
 const d=read(bytes,expected);
 check(d.format==='gal-predecessor-chat'&&d.version===1&&d.status==='completed'&&d.canonical===false&&d.evidence?.topReached===true&&d.evidence?.bottomReached===true&&d.evidence?.continuity===true,'原件非完整可核對來源');
 check(typeof d.chatId==='string'&&Array.isArray(d.rows)&&d.rows.length===d.count&&d.rows.every((x,i)=>x.index===i),'原件身分或索引不符');
 native.validateRows(d.rows);
 return {d,map:new Map(d.rows.map(x=>[x.id,x]))};
}
function hydrate(ref,map){
 const r=map.get(ref.sourceId);check(r&&(!('index' in ref)||ref.index===r.index)&&!native.isComposite(r),'來源 ID 或索引不符');
 check(Array.isArray(ref.rangeUtf16)&&ref.rangeUtf16.length===2,'缺少原文範圍');
 const [a,b]=ref.rangeUtf16;
 check(Number.isInteger(a)&&Number.isInteger(b)&&0<=a&&a<b&&b<=r.text.length&&!split(r.text,a)&&!split(r.text,b),'UTF-16 範圍錯誤');
 const text=r.text.slice(a,b);
 return {sourceId:r.id,index:r.index,role:r.role,rangeUtf16:[a,b],text,textSha256:digest(Buffer.from(text)),sourceCreatedAt:r.sourceCreatedAt??null,attachmentReferences:structuredClone(r.attachments??[])};
}
function uniqueRefs(refs,map){
 check(Array.isArray(refs),'候選範圍須為陣列');
 const seen=new Set();return refs.map(ref=>{
  const r=hydrate(ref,map),k=JSON.stringify([ref.tab??null,r.sourceId,r.rangeUtf16]);
  check(!seen.has(k),'候選來源範圍重複');seen.add(k);return r;
 });
}
function previewLegacy({backupBytes,backupSha256,sourceBytes,sourceSha256,target,manager,candidateRefs}){
 const old=read(backupBytes,backupSha256),{d,map}=source(sourceBytes,sourceSha256);
 check(typeof manager==='string'&&manager.trim()&&target&&old.id===target.cycleId&&old.world===target.worldKey&&old.title===target.cycleTitle&&Array.isArray(old.pilotMessages),'備份輪迴綁定不符');
 check(old.pilotMessages.every(x=>typeof x.id==='string'&&typeof x.text==='string')&&new Set(old.pilotMessages.map(x=>x.id)).size===old.pilotMessages.length,'舊紀錄 ID 或正文錯誤');
 const c=uniqueRefs(candidateRefs,map),oldRows=old.pilotMessages.map((record,oldOrdinal)=>({record,oldOrdinal})).filter(x=>x.record.manager===manager);
 const reverse=new Map();
 const matches=oldRows.map(({record,oldOrdinal})=>{
  const norm=normalize(record.text);
  const hits=c.flatMap((r,i)=>{
   if(!norm||role(record.role)!==r.role||norm!==normalize(r.text))return [];
   const owners=reverse.get(i)||[];owners.push(oldOrdinal);reverse.set(i,owners);
   return [{candidateOrdinal:i,sourceId:r.sourceId,sourceIndex:r.index,rangeUtf16:r.rangeUtf16,match:record.text===r.text?'exact':'whitespace-only',sourceIdAlreadyEqual:record.predecessorSource?.id===r.sourceId}];
  });
  return {oldOrdinal,oldRecord:structuredClone(record),hits,automaticDelete:false};
 });
 for(const m of matches){
  for(const h of m.hits)h.reverseOldOrdinals=reverse.get(h.candidateOrdinal).slice();
  m.disposition=!m.hits.length?'unmatched-retain':m.hits.length>1?'ambiguous-retain':m.hits[0].reverseOldOrdinals.length>1?'multiple-old-to-one-review':'mutual-unique-text-review';
 }
 const counts={oldTotal:old.pilotMessages.length,oldManager:oldRows.length,otherManagerOrUnassigned:old.pilotMessages.length-oldRows.length,candidates:c.length,naiveTotal:old.pilotMessages.length+c.length,exactOld:matches.filter(m=>m.hits.some(h=>h.match==='exact')).length,normalizedOld:matches.filter(m=>m.hits.length).length,uniqueOld:matches.filter(m=>m.hits.length===1).length,mutualUnique:matches.filter(m=>m.disposition==='mutual-unique-text-review').length,multipleOldOrCandidate:matches.filter(m=>m.hits.length&&m.disposition!=='mutual-unique-text-review').length,unmatchedOld:matches.filter(m=>!m.hits.length).length,unmatchedCandidates:c.length-reverse.size,sourceIdDirectMatches:matches.filter(m=>m.hits.some(h=>h.sourceIdAlreadyEqual)).length};
 return {format:'gal-legacy-pilot-migration-preview',version:1,status:'preview-only',canonical:false,importable:false,target:structuredClone(target),manager,backupSha256,sourceSha256,chatId:d.chatId,counts,oldMatches:matches,candidateRefs:c.map((x,i)=>({...x,candidateOrdinal:i,matchedOldOrdinals:reverse.get(i)||[]})),protectedOldOrdinals:old.pilotMessages.map((r,i)=>r.manager!==manager?i:null).filter(x=>x!==null),operations:[]};
}
function previewUnbound({sourceBytes,sourceSha256,manager,refs}){
 const {d,map}=source(sourceBytes,sourceSha256);
 check(typeof manager==='string'&&manager.trim()&&Array.isArray(refs)&&refs.every(r=>r.cycle===null&&(!('cycleId' in r)||r.cycleId===null)&&['realChatLogs','casinoLogs'].includes(r.tab)),'未綁定資料不得推測輪迴');
 const rows=uniqueRefs(refs,map);
 return {format:'gal-predecessor-unbound-evidence-preview',version:1,status:'preview-only',canonical:false,importable:false,manager,cycleId:null,chatId:d.chatId,sourceSha256,records:rows.map((r,i)=>({...r,tab:refs[i].tab,cycleId:null})),operations:[]};
}
module.exports={previewLegacy,previewUnbound};
