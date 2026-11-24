'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const helper=require('./archive-reconcile.js');
const P=helper.EXPECTED;
function fixture(){
 const cp={format:'gal-ai-incomplete-scan-checkpoint',version:1,importable:false,
  complete:false,validated:false,scannerVersion:'0.8.36',scanRunId:P.checkpointRun,
  collectedCount:2630,target:{cycleId:P.cycleId,cycleTitle:'第5輪迴',
   worldName:'《全員精神穩定，感情除外》'},source:{url:P.url},rows:[]};
 const events=new Set(P.events),continues=new Set(P.continuations);
 let awaiting=false;
 const ids=new Set();
 const eventHeaders=P.events.map(scanIndex=>({scanIndex,classified:true}));
 for(let i=0;i<2630;i++){
  const event=events.has(i),auto=continues.has(i);
  let role='ai';
  if(i&&!event&&!auto){
   if(awaiting){role='ai';awaiting=false}
   else{role='me';awaiting=true}
  }
  const id='whif-native-'+i;
  const text=i===1474?'甲乙':i===2268?'丙丁戊':'第'+i+'筆';
  cp.rows.push({scanIndex:i,role,text,eventType:event?'event':null,
   worldName:event?cp.target.worldName:null,autoContinue:auto,
   sourceMessageId:role==='ai'?id:null,
   nativeReason:role==='ai'?'available':null,
   nativeText:role==='ai'?text:null});
  if(role==='ai')ids.add(id);
 }
 const details=P.merged.map(scanIndex=>({
  scanIndex,nativeUserSourceCount:2,
  sourceHashes:['user-hash-'+scanIndex+'-a','user-hash-'+scanIndex+'-b'],
  previousAiSourceHash:helper.hash('whif-native-'+(scanIndex-1)),
  nextAiSourceHash:helper.hash('whif-native-'+(scanIndex+1)),
  playerTextLength:cp.rows[scanIndex].text.length
 }));
 const diag={
  scanRunId:P.auditRun,cycleId:P.cycleId,scope:'full',trustedCount:2630,
  bottomProof:{stable:true,collected:2630,waitedMs:8345},
  autoContinueAudit:{
   ok:false,problems:[{scope:'history',errors:['more-observed-user-messages-than-player-rows']}],
   observedNativeMarkers:2632,scannedRows:2630,unknownMarkers:[],unaccountedAIOrEvents:[],
   observedUserMessages:1313,playerRows:1311,
   gaps:P.continuations.map(scanIndex=>({scanIndex,ok:true,errors:[],bothOrdinary:true,noGapMarkers:true})),
   playerSourceAudit:{
    originalUserMarkers:1313,renderedPlayerRows:1311,countDifference:2,
    mappedNativeUserMarkers:1313,unmappedNativeUserMarkers:0,
    unmappedNativeUserDetails:[],rowsWithMultipleNativeUserSources:2,
    multipleNativeSourceDetails:details,rowsWithoutProvenUserMarker:0,
    rowsWithoutProvenUserMarkerIndices:[],sourceInMultiplePlayerRows:[],linkedButNotObserved:[]
   }
  },
  eventAudit:{complete:false,exportedEvents:4,unresolvedAccepted:0,
   unresolvedHeaders:0,unreadableHistoryMarkers:0,
   ordinaryAiVerified:1314,ordinaryAiTotal:1314,
   historyMarkersObserved:2632,headers:eventHeaders}
 };
 return {cp,diag};
}
test('fully observed 2630-source checkpoint and independent forensic diagnostic permit manual recovery preflight',()=>{
 const {cp,diag}=fixture();
 const proof=helper.verify(cp,diag,true);
 assert.equal(proof.ok,true);
 assert.equal(proof.sourceCount,1313);
 assert.deepEqual(proof.mergedRows.map(x=>x.scanIndex),[1474,2268]);
});
test('cannot silently import failed checkpoint without explicit user approval',()=>{
 const {cp,diag}=fixture();
 assert.throws(()=>helper.verify(cp,diag,false),/人工核對/);
});
test('cannot substitute different checkpoint run, source, loop, or scan version',()=>{
 for(const tweak of [
  x=>{x.cp.scanRunId='wrong'},x=>{x.cp.target.cycleId='another'},
  x=>{x.cp.source.url='https://www.whif.io/chat/other'},
  x=>{x.cp.scannerVersion='0.8.37'},x=>{x.cp.importable=true},
  x=>{x.cp.rows.pop()},x=>{x.cp.rows[1474].text=''},
  x=>{x.cp.rows[1474].scanIndex=10},x=>{x.diag.bottomProof.stable=false},
  x=>{x.diag.scanRunId='another'},x=>{x.diag.scope='preview'}
 ]){
  const x=fixture();tweak(x);
  assert.throws(()=>helper.verify(x.cp,x.diag,true),/拒絕/,tweak.toString());
 }
});
test('cannot accept other missing markers, untrusted events, inaccurate merged source hashes or lost message content',()=>{
 for(const tweak of [
  x=>{x.diag.autoContinueAudit.unknownMarkers.push('x')},
  x=>{x.diag.autoContinueAudit.unaccountedAIOrEvents.push('x')},
  x=>{x.diag.autoContinueAudit.playerSourceAudit.unmappedNativeUserMarkers=1},
  x=>{x.diag.autoContinueAudit.playerSourceAudit.rowsWithMultipleNativeUserSources=1},
  x=>{x.diag.autoContinueAudit.playerSourceAudit.multipleNativeSourceDetails[0].playerTextLength=999},
  x=>{x.diag.autoContinueAudit.playerSourceAudit.multipleNativeSourceDetails[0].nextAiSourceHash='wrong'},
  x=>{x.diag.autoContinueAudit.playerSourceAudit.multipleNativeSourceDetails[1].sourceHashes[1]='user-hash-2268-a'},
  x=>{x.diag.autoContinueAudit.gaps[0].ok=false},
  x=>{x.diag.eventAudit.unresolvedHeaders=1},
  x=>{x.diag.eventAudit.ordinaryAiVerified=1313},
  x=>{x.cp.rows[95].eventType=null},
  x=>{x.cp.rows[1536].autoContinue=false},
  x=>{x.cp.rows[201].sourceMessageId=x.cp.rows[199].sourceMessageId}
 ]){
  const x=fixture();tweak(x);
  assert.throws(()=>helper.verify(x.cp,x.diag,true),/拒絕/,tweak.toString());
 }
});
test('manual rescue export never falsely claims that native user message boundaries or original text were recovered',()=>{
 const {cp,diag}=fixture();
 const core={
  validate(rows){return {ok:true,errors:[],warnings:[],opening:'開場文字',
   messages:rows.slice(1).filter(x=>x.eventType!=='event').map((x,i,all)=>({
    role:x.role,text:x.text,scanIndex:cp.rows.findIndex(r=>r.text===x.text),
    gameTime:x.role==='ai'?'2026-08-22T18:45:00.000Z':'2026-08-22T18:45:00.000Z',
    autoContinue:x.autoContinue
   })),events:cp.rows.filter(x=>x.eventType==='event').map(x=>({
    scanIndex:x.scanIndex,role:'ai',text:x.text,title:'事件',worldName:cp.target.worldName,gameTime:null
   })),pairs:1311,autoContinues:3,unknownGameTimeCount:0,verifiedUntimedCount:0}
  },
  compareNativeParagraphs(text){return {text,comparison:{contentEqual:true}}}
 };
 // Synthetic duplicated text isn't unique; use each indexed input as the
 // primary verification target rather than trying to recreate real chronology.
 const result=helper.convert(cp,diag,true,core);
 assert.equal(result.format,'gal-ai-authoritative-scan');
 assert.equal(result.reconciliation.machineScanComplete,false);
 assert.equal(result.reconciliation.checkpointImportable,false);
 assert.equal(result.reconciliation.exactOriginalSegmentsAvailable,false);
 assert.equal(result.reconciliation.approvedIndices.length,2);
 assert.equal(result.validation.errors.length,0);
 assert.equal(result.messages.find(x=>x.scanIndex===1474).nativeUserMergeVerified,false);
 assert.equal(result.messages.find(x=>x.scanIndex===2268).nativeUserMergeReview.sourceCount,2);
 assert.ok(!result.messages.find(x=>x.scanIndex===1474).nativeUserSegments);
});
