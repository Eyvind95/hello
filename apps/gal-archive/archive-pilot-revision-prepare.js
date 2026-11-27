/* Build only from independently verified actual-site readback, never candidate-only R2. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./archive-pilot-import.js'):root.ArchivePilotImport,typeof module==='object'&&module.exports?require('./archive-pilot-revision.js'):root.ArchivePilotRevision);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchivePilotRevisionPrepare=api})(globalThis,function(normal,core){
'use strict';
const fail=m=>{throw Error(m)},same=(a,b)=>core.canonical(a)===core.canonical(b),HEX=/^[0-9a-f]{64}$/;
async function checked(input,label){
 if(!input||!HEX.test(input.sha256)||typeof input.text!=='string'||await core.sha(input.text)!==input.sha256)fail(label+' 原件 SHA-256 不符');
 return JSON.parse(input.text.replace(/^\uFEFF/,''));
}
const owned=(r,chat)=>r.predecessorSource?.chatId===chat;
async function prepare({snapshotFile,ledgerFile,pairs,revisionId}){
 const snapshot=await checked(snapshotFile,'網站實際 R2 快照'),ledger=await checked(ledgerFile,'獨立驗收清冊');
 if(snapshot.format!=='gal-predecessor-revision-site-snapshot'||snapshot.version!==1||snapshot.mode!=='read-only-double-read')fail('不是實際網站雙次唯讀快照');
 const {snapshotSha256,...content}=snapshot;
 if(!HEX.test(snapshotSha256)||await core.digest(content)!==snapshotSha256)fail('快照內部雜湊不符');
 if(ledger.format!=='gal-predecessor-r3-change-ledger'||!Array.isArray(ledger.decisions)||!Array.isArray(pairs)||!pairs.length||!Array.isArray(snapshot.targets)||pairs.length!==snapshot.targets.length)fail('修正清冊／快照／候選數量不符');
 const decisions=ledger.decisions.filter(x=>x.dataChanged===true);
 if(decisions.length!==ledger.actualChanges)fail('清冊實際操作總數不符');
 const seen=new Set(),consumed=new Set(),sources=new Map(),targets=[],records=[],inputHashes=[];
 for(const pair of pairs){
  const a=normal.unpack(await checked(pair.r2,'R2 候選')),b=normal.unpack(await checked(pair.r3,'R3 候選')),t=a.pack.target;
  if(seen.has(t.cycleId)||!same(t,b.pack.target)||a.pack.chatId!==b.pack.chatId||a.pack.manager!==b.pack.manager||a.pack.sourceSha256!==b.pack.sourceSha256||a.sourceText!==b.sourceText||await core.sha(a.sourceText)!==a.pack.sourceSha256||!same(a.pack.easterEggs,b.pack.easterEggs))fail('R2/R3 來源、綁定或彩蛋差異');
  seen.add(t.cycleId);
  const matches=snapshot.targets.filter(x=>same(x.target,t));if(matches.length!==1)fail('實際快照目標不唯一');
  const entry=matches[0],actual=entry.local;
  if(entry.equal!==true||!same(actual,entry.cloud)||await core.digest(actual)!==entry.localSha256||await core.digest(entry.cloud)!==entry.cloudSha256||entry.localSha256!==entry.cloudSha256)fail('網站本機與 Firebase 狀態不一致');
  for(const k of ['localCycles','cloudCycles']){
   const i=snapshot.inventories?.[k]?.filter(x=>x.id===t.cycleId);
   if(i?.length!==1||i[0].sha256!==entry.localSha256)fail('實際快照清冊不符');
  }
  if(!same(normal.binding(actual),t))fail('實際輪迴綁定不符');
  const empty={...structuredClone(actual),...Object.fromEntries(core.FIELDS.map(k=>[k,[]])),easterEggs:''};
  const r2=normal.plan(empty,a.source,a.pack,a.pack.sourceSha256).updated,r3=normal.plan(empty,b.source,b.pack,b.pack.sourceSha256).updated;
  const maps=new Map();
  for(const field of core.FIELDS){
   const old=(actual[field]??[]).filter(x=>owned(x,a.pack.chatId)),expected=r2[field];
   if(old.length!==expected.length)fail('網站 R2 來源數與核准 R2 候選不符：'+field);
   for(let i=0;i<old.length;i++){
    const x=old[i],y=expected[i];
    // Images and user metadata are allowed here; their actual complete hash
    // is taken below, and deletion will reject such data.
    if(!['id','role','manager','text'].every(k=>x[k]===y[k])||!same(x.predecessorSource,y.predecessorSource)||(field==='rejectedEvents'&&!same(x.rejectedEvidence,y.rejectedEvidence)))fail('網站 R2 舊來源或正文有異動：'+field+' '+y.id);
   }
   maps.set(field,{old:new Map(old.map(x=>[x.predecessorSource.id,x])),next:new Map(r3[field].map(x=>[x.predecessorSource.id,x]))});
  }
  const operations=[];
  for(const d of decisions.filter(x=>x.cycleUUID===t.cycleId)){
   if(!core.FIELDS.includes(d.field)||!['add','remove','replace'].includes(d.operation)||d.worldKey!==t.worldKey||d.cycleTitle!==t.cycleTitle||d.manager!==a.pack.manager)fail('審定操作綁定不符');
   const k=JSON.stringify([d.cycleUUID,d.field,d.sourceId]);if(consumed.has(k))fail('審定操作重複');consumed.add(k);
   const m=maps.get(d.field),old=m.old.get(d.sourceId),next=m.next.get(d.sourceId);
   if((old?.text??null)!==(d.oldText??null)||(next?.text??null)!==(d.newText??null)||(old&&old.predecessorSource.index!==d.index)||(next&&next.predecessorSource.index!==d.index))fail('審定操作與實際舊值或新候選不符');
   operations.push({field:d.field,sourceId:d.sourceId,action:d.operation,old:old?{text:old.text,index:old.predecessorSource.index,sourceSha256:old.predecessorSource.sha256,rowSha256:await core.digest(old)}:null});
  }
  sources.set(a.pack.sourceSha256,a.sourceText);records.push(actual);targets.push({beforeSha256:entry.localSha256,candidate:b.pack,operations});
  inputHashes.push({target:t,r2Sha256:pair.r2.sha256,r3Sha256:pair.r3.sha256});
 }
 if(consumed.size!==decisions.length)fail('審定操作有未套入目標');
 const bundle={format:core.FORMAT,version:core.VERSION,revisionId,sources:[...sources].map(([sha256,sourceText])=>({sha256,sourceText})),targets,
  audit:{snapshotFileSha256:snapshotFile.sha256,snapshotSha256,ledgerSha256:ledgerFile.sha256,inputHashes,historyNotes:structuredClone(ledger.historyNotes??[])}};
 const preview=await core.inspect(records,bundle);
 if(preview.changes.length!==ledger.actualChanges)fail('修正版預覽操作數量不符');
 return {bundle,preview};
}
return {prepare};
});
