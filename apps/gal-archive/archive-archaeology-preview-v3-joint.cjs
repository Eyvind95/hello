'use strict';
// Offline-only adapter. Independent registry and reviews are trusted operator
// inputs, never derived from the submitted candidate. No storage/network writes.
const api=require('./archive-archaeology-preview-v3.cjs');
const crypto=require('node:crypto');
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.trim().length>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=(...parts)=>JSON.stringify(parts);
const hex=/^[a-f0-9]{64}$/;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function cycleKey(t){
 check(obj(t)&&['worldKey','cycleId','cycleTitle'].every(k=>str(t[k])),'缺少輪迴綁定');
 return key(t.worldKey,t.cycleId);
}
function registryMap(registry){
 check(Array.isArray(registry)&&registry.length,'缺少獨立備份輪迴表');
 const map=new Map();
 for(const r of registry){
  const k=cycleKey(r);
  check(!map.has(k)&&str(r.backupFileId)&&str(r.backupHeader)&&str(r.reviewId)&&Array.isArray(r.aliases)&&r.aliases.every(str)&&new Set(r.aliases).size===r.aliases.length,'輪迴表重複或證據不符');
  check(r.backupHeader.includes('｜'+r.cycleTitle+'｜輪迴 ID '+r.cycleId+'｜'),'備份表頭與正式標題或UUID不符');
  map.set(k,r);
 }
 return map;
}
const targetOf=r=>({worldKey:r.worldKey,cycleId:r.cycleId,cycleTitle:r.cycleTitle});
function normalizeCandidateTargets(candidate,registry){
 check(obj(candidate)&&candidate.format===api.FORMAT&&candidate.version===api.VERSION&&str(candidate.manager)&&Array.isArray(candidate.targets),'考古預覽格式不符');
 const map=registryMap(registry),seen=new Set(),changes=[];
 const targets=candidate.targets.map(t=>{
  const k=cycleKey(t.target),r=map.get(k);
  check(r&&!seen.has(k),'未核定或重複輪迴');seen.add(k);
  check(t.target.cycleTitle===r.cycleTitle||r.aliases.includes(t.target.cycleTitle),'輪迴別名未核定');
  if(t.target.cycleTitle!==r.cycleTitle)changes.push({manager:candidate.manager,...targetOf(r),previousTitle:t.target.cycleTitle,backupFileId:r.backupFileId,reviewKeysMustBeReissued:true});
  return {...t,target:{...t.target,cycleTitle:r.cycleTitle}};
 });
 // Approval keys contain the title. Never rewrite review/coverage keys.
 return {candidate:{...candidate,targets},changes,status:'preview-only',canonical:false,importable:false};
}
function retainJointResearch({artifacts,review,registry,approvedSources}){
 check(obj(review)&&str(review.reviewId)&&str(review.task)&&obj(review.hashes)&&obj(review.counts)&&obj(review.target)&&Array.isArray(artifacts),'缺少共同研究獨立技術核定');
 const target=registryMap(registry).get(cycleKey(review.target));
 check(target&&target.cycleTitle===review.target.cycleTitle,'共同研究正式輪迴不符');
 const kinds=['red33','flare34','receipt','fine32'],docs=new Map(),approved=new Map(approvedSources.map(s=>[key(s.sha256,s.chatId),s]));
 check(artifacts.length===kinds.length,'共同研究證據檔不齊');
 for(const a of artifacts){
  check(kinds.includes(a.kind)&&!docs.has(a.kind)&&a.sha256===review.hashes[a.kind]&&hex.test(a.sha256)&&Buffer.isBuffer(a.bytes)&&digest(a.bytes)===a.sha256,'共同研究原件雜湊或身分不符');
  let d;try{d=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(a.bytes).replace(/^\uFEFF/,''))}catch{throw Error('共同研究原件JSON無效')}
  check(obj(d)&&d.task===review.task&&d.status==='preview-only'&&d.canonical===false&&d.importable===false,'共同研究證據狀態不符');
  docs.set(a.kind,{sha256:a.sha256,data:d});
 }
 const red=docs.get('red33').data,flare=docs.get('flare34').data,receipt=docs.get('receipt').data,fine=docs.get('fine32').data;
 check(red.version==='RED-V3.3-countersign'&&flare.version==='FLARE-V3.4'&&receipt.version==='RED-V3.4-receipt'&&fine.version==='3.2-flare-stage002'&&receipt.countersignStage==='complete','共同研究回簽版本不符');
 const has=(arr,sha)=>Array.isArray(arr)&&arr.some(x=>x.sha256===sha);
 check(has(receipt.inputs,review.hashes.red33)&&has(receipt.inputs,review.hashes.flare34)&&has(flare.inputFiles,review.hashes.red33)&&has(flare.inputFiles,review.hashes.fine32),'共同研究回簽鏈不符');
 check(cycleKey(fine.target)===cycleKey(target)&&(fine.target.cycleTitle===target.cycleTitle||target.aliases.includes(fine.target.cycleTitle)),'共同研究候選輪迴不符');
 check(Array.isArray(red.sources)&&Array.isArray(flare.sourceFiles)&&red.sources.length===flare.sourceFiles.length,'共同研究來源清冊不符');
 const sourceKeys=a=>a.map(x=>key(x.sha256,x.chatId,x.count)).sort();
 check(same(sourceKeys(red.sources),sourceKeys(flare.sourceFiles))&&red.sources.every(x=>approved.get(key(x.sha256,x.chatId))?.count===x.count),'共同研究引用未通過來源預覽');
 const count=(a,n)=>Array.isArray(a)&&Number.isSafeInteger(n)&&a.length===n,n=review.counts;
 check(count(red.formalWorks,n.formalWorks)&&same(red.formalWorks,flare.formalWorks)&&count(red.quoteDispositions,n.relations)&&count(flare.quoteEvidence,n.relations)&&count(red.newDifferences,n.differences)&&count(flare.changes,n.differences)&&count(fine.occurrences,n.occurrences)&&count(fine.stage002ReviewedRows,n.fineClassifications),'共同研究筆數或作品不符');
 const ids=new Set(),answers=[];
 for(const w of red.formalWorks){
  check(str(w.type)&&str(w.author)&&hex.test(w.sha256)&&hex.test(w.textSha256)&&str(w.sourceId)&&Number.isSafeInteger(w.sourceIndex)&&Array.isArray(w.rangeUtf16)&&w.rangeUtf16.length===2&&w.rangeUtf16.every(Number.isSafeInteger)&&w.rangeUtf16[0]>=0&&w.rangeUtf16[1]>w.rangeUtf16[0]&&approved.has(key(w.sha256,w.chatId)),'正式作品來源格式不符');
  const id=key(w.sha256,w.chatId,w.sourceId,w.sourceIndex,...w.rangeUtf16,w.type,w.author);
  check(!ids.has(id),'正式作品來源重複');ids.add(id);
  if(w.type.startsWith('原生答卷')){check(w.sourceId.startsWith('assistant|message:'),'答卷不是GPT原生回應');answers.push(w)}
 }
 check(answers.length===2&&new Set(answers.map(x=>x.author)).size===2&&new Set(answers.map(x=>key(x.chatId,x.sourceId))).size===2,'雙原生答卷不得合併');
 const endpoint=x=>key(x.chatId,x.sourceId,x.index,x.role,x.rangeUtf16,x.textSha256),quotes=new Map(red.quoteDispositions.map(q=>[q.quoteId,q]));
 check(quotes.size===n.relations&&new Set(flare.quoteEvidence.map(q=>q.quoteId)).size===n.relations,'引用關係ID重複');
 for(const q of flare.quoteEvidence){
  const r=quotes.get(q.quoteId);
  check(r&&endpoint(q.carrier)===endpoint(r.carrier)&&endpoint(q.match)===endpoint(r.match)&&q.delete===false&&r.delete===false&&q.countAsNewAnswer===false&&r.countAsNewAnswer===false,'引用端點或答卷重複計數不符');
 }
 check(Number.isSafeInteger(n.unresolvedAuthor)&&flare.counts?.unresolvedAuthorRetained===n.unresolvedAuthor&&receipt.counts?.unresolvedAuthorRetained===n.unresolvedAuthor,'未決作者不得升格或刪除');
 // Preserve the entire immutable input documents and independent pointers.
 // No text-based deduplication, new attribution, or new countersign.
 return {task:review.task,target:targetOf(target),reviewId:review.reviewId,status:'preview-only',canonical:false,importable:false,formalWorks:structuredClone(flare.formalWorks),nativeAnswerSources:answers.map(w=>({author:w.author,sha256:w.sha256,chatId:w.chatId,sourceId:w.sourceId,sourceIndex:w.sourceIndex,rangeUtf16:w.rangeUtf16.slice()})),counts:{...n},artifacts:kinds.map(kind=>({kind,...docs.get(kind)}))};
}
function jointPreview({batches,registry,jointResearch}){
 check(Array.isArray(batches)&&batches.length>=2,'共同預覽需至少兩個獨立管理者');
 const map=registryMap(registry),cycles=new Map(),managers=new Set(),sources=new Map(),titleChanges=[];
 for(const batch of batches){
  const normalized=normalizeCandidateTargets(batch.candidate,registry),manager=normalized.candidate.manager;
  check(!managers.has(manager),'管理者批次重複');managers.add(manager);titleChanges.push(...normalized.changes);
  const result=api.preview({originals:batch.originals,review:batch.review,candidate:normalized.candidate,requireFullCoverage:true});
  check(result.coverage.status==='complete-against-independent-ledger','管理者覆蓋未通過獨立清冊：'+manager);
  for(const src of result.sourceEvidence){
   const k=key(src.sha256,src.chatId),old=sources.get(k);
   check(!old||same(old,src),'共同來源驗收結果不符');sources.set(k,src);
  }
  for(const t of result.targets){
   const k=cycleKey(t.target),record=map.get(k);
   if(!cycles.has(k))cycles.set(k,{target:targetOf(record),managers:[]});
   const sections=Object.fromEntries(api.SECTIONS.map(section=>[section,t[section].map(entry=>({...entry,manager,managedId:key(manager,section,entry.source.chatId,entry.source.sourceId)}))]));
   cycles.get(k).managers.push({manager,sections,sourceEvidence:result.sourceEvidence,coverage:result.coverage});
  }
 }
 if(jointResearch){
  const research=retainJointResearch({...jointResearch,registry,approvedSources:[...sources.values()]});
  const cycle=cycles.get(cycleKey(research.target));
  check(cycle&&cycle.managers.length>=2,'共同研究輪迴缺少雙方來源');cycle.jointResearch=research;
 }
 return {format:'gal-predecessor-joint-preview-result',version:api.VERSION,status:'preview-only',canonical:false,importable:false,managers:[...managers],titleChanges,targets:[...cycles.values()],sourceEvidence:[...sources.values()]};
}
module.exports={normalizeCandidateTargets,retainJointResearch,jointPreview};
