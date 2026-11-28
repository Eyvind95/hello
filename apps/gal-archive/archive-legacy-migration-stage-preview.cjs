'use strict';
// Portable staging core. Inputs must be independently hash-verified by the offline
// caller before parsing; this function is NOT a source approval or write adapter.
// No deletion, replacement, reassignment, database or renderer integration.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=x=>JSON.parse(JSON.stringify(x));
const check=(x,m)=>{if(!x)throw Error(m)};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const role=x=>({me:'user',ai:'assistant',user:'user',assistant:'assistant'})[x];
const split=(s,i)=>i>0&&i<s.length&&/[\uD800-\uDBFF]/.test(s[i-1])&&/[\uDC00-\uDFFF]/.test(s[i]);
function stage({backup,raw,index,indexSha256,backupSha256,sourceSha256,quizRefs=[],quizCandidateIndexSha256=null,unboundIndex=null,unboundIndexSha256=null}){
 check(index?.status==='preview-only'&&index.canonical===false&&index.importable===false&&sha(indexSha256)&&sha(backupSha256)&&sha(sourceSha256),'invalid offline index');
 check(backup.id===index.cycleId&&backup.title===index.cycleTitle&&backup.world==='sentinel'&&index.manager==='暗夢後輩'&&index.backup.sha256===backupSha256&&index.source.sha256===sourceSha256&&index.source.chatId===raw.chatId,'target/source binding mismatch');
 check(raw.format==='gal-predecessor-chat'&&raw.status==='completed'&&raw.evidence?.topReached===true&&raw.evidence?.bottomReached===true&&raw.evidence?.continuity===true&&Array.isArray(raw.rows)&&raw.rows.length===raw.count&&raw.rows.every((r,i)=>r.index===i),'source continuity mismatch');
 check(Array.isArray(index.parts)&&index.parts.every(p=>sha(p.sha256)&&typeof p.path==='string')&&new Set(index.parts.map(p=>p.path)).size===index.parts.length,'invalid approved ledger references');
 check(Array.isArray(backup.pilotMessages)&&Array.isArray(index.candidateRefs)&&index.candidateRefs.length===index.counts.candidates&&backup.pilotMessages.length===index.counts.oldTotal,'approved counts mismatch');
 const map=new Map(raw.rows.map(r=>[r.id,r]));check(map.size===raw.rows.length,'duplicate source');
 const owned=backup.pilotMessages.map((r,i)=>r.manager===index.manager?i:null).filter(i=>i!==null),allowed=new Set(owned);
 check(owned.length===index.counts.oldManager,'manager scope mismatch');
 function excerpt(ref){
  const r=map.get(ref.sourceId),a=ref.rangeUtf16?.[0],b=ref.rangeUtf16?.[1];
  check(r&&r.index===(ref.index??ref.sourceIndex??r.index)&&!r.id.startsWith('assistant|composite:')&&r.identityBasis!=='unresolved-native-composite'&&Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>a&&b<=r.text.length&&!split(r.text,a)&&!split(r.text,b),'invalid source excerpt');
  check(ref.role===undefined||ref.role===r.role,'source role mismatch');
  return {sourceId:r.id,sourceIndex:r.index,role:r.role,rangeUtf16:[a,b],text:r.text.slice(a,b),sourceCreatedAt:r.sourceCreatedAt??null,attachmentReferences:clone(r.attachments??[])};
 }
 const seen=new Set();
 const pendingPilot=index.candidateRefs.map((ref,i)=>{
  check(ref.candidateOrdinal===i&&Array.isArray(ref.matchedOldOrdinals)&&new Set(ref.matchedOldOrdinals).size===ref.matchedOldOrdinals.length&&ref.matchedOldOrdinals.every(n=>allowed.has(n)),'candidate ordinal or protected old owner mismatch');
  const item=excerpt(ref),k=JSON.stringify([item.sourceId,item.rangeUtf16]);check(!seen.has(k),'duplicate pending candidate');seen.add(k);
  // These links are from an approved text matching ledger, never an identity grant.
  return {...item,candidateOrdinal:i,matchedOldOrdinals:ref.matchedOldOrdinals.slice(),disposition:'pending-correspondence',automaticDelete:false};
 });
 const oldQuiz=backup.quizLogs??[];check(Array.isArray(oldQuiz)&&Array.isArray(quizRefs),'invalid quiz');
 check(!quizRefs.length||sha(quizCandidateIndexSha256)&&quizRefs.length===oldQuiz.length,'quiz candidate binding mismatch');
 const quizSeen=new Set();
 const pendingQuiz=quizRefs.map((ref,i)=>{
  const item=excerpt(ref),old=oldQuiz[i],k=JSON.stringify([item.sourceId,item.rangeUtf16]);check(!quizSeen.has(k)&&old&&role(old.role)===item.role,'quiz order or role mismatch');quizSeen.add(k);
  return {...item,oldOrdinal:i,oldRecord:clone(old),exactText:old.text===item.text,whitespaceMatch:old.text.replace(/\s/gu,'')===item.text.replace(/\s/gu,''),correspondence:'order-and-role-hypothesis-only',automaticDelete:false,automaticAssignManager:false};
 });
 let unbound=null;
 if(unboundIndex!==null){
  check(sha(unboundIndexSha256)&&unboundIndex.status==='preview-only'&&unboundIndex.canonical===false&&unboundIndex.importable===false&&unboundIndex.cycleId===null&&unboundIndex.manager===index.manager&&unboundIndex.source.sha256===sourceSha256&&unboundIndex.source.chatId===raw.chatId&&Array.isArray(unboundIndex.parts)&&unboundIndex.parts.every(p=>sha(p.sha256)),'unbound index scope mismatch');
  unbound={indexSha256:unboundIndexSha256,cycleId:null,counts:clone(unboundIndex.counts),parts:clone(unboundIndex.parts),scope:'independent-not-attached-to-cycle'};
 }
 return {format:'gal-legacy-migration-staging-preview',version:1,status:'preview-only',canonical:false,importable:false,backupSha256,sourceSha256,indexSha256,target:{worldKey:backup.world,cycleId:backup.id,cycleTitle:backup.title},manager:index.manager,approvedLedgerParts:clone(index.parts),pendingPilot,pendingQuiz,quizCandidateIndexSha256,protectedPilotOrdinals:backup.pilotMessages.map((r,i)=>allowed.has(i)?null:i).filter(i=>i!==null),protectedQuizOrdinals:oldQuiz.map((r,i)=>i),protectedEggs:{present:Object.prototype.hasOwnProperty.call(backup,'easterEggs'),value:clone(backup.easterEggs??null)},unbound,operations:[]};
}
function applyPreview(state,backup,plan){
 check(plan?.format==='gal-legacy-migration-staging-preview'&&plan.status==='preview-only'&&plan.importable===false&&plan.canonical===false&&Array.isArray(plan.operations)&&plan.operations.length===0,'not a no-write plan');
 check(state&&same(state.snapshot,backup),'stale or modified backup');
 if(state.preview!==null){check(same(state.preview,plan),'conflicting existing stage');return clone(state)}
 return {snapshot:clone(backup),preview:clone(plan)};
}
function rollbackPreview(state,backup,plan){
 check(state&&same(state.snapshot,backup)&&same(state.preview,plan),'changed stage or backup; refuse rollback');
 return {snapshot:clone(backup),preview:null};
}
module.exports={stage,applyPreview,rollbackPreview};
