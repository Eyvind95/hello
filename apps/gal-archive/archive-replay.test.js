'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
require('./chrome-extension/gal-core.js');
const core=globalThis.GalArchiveCore,evidence=require('./chrome-extension/gal-format-evidence.js'),{replay,hash}=require('./archive-replay.js');
function fixture(){
 const run='synthetic-run',id='synthetic-cycle',version='0.8.47',url='https://www.whif.io/chat/synthetic';
 const ai=(i,text,sender='character',event=false)=>{
  const messageId='native-'+i,e={messageId,kind:event?'event-message':'ordinary-message',sender,accepted:event?true:null};
  return {scanIndex:i,role:'ai',eventType:event?'event':null,domText:text,originalText:text,nativeText:text,sourceMessageId:messageId,sourceEvidence:e,nativeMarkerCount:1,formatSource:{nativeReply:{reason:'available',markerCount:1,messageId,text,scannedText:text,eventEvidence:e}}};
 };
 const meText='測試玩家',sources=[{id:'native-1',kind:'ordinary-message',sender:'user',nativeReason:'available',nativeSender:'user',nativeMessageId:'native-1',hasText:true,hasMedia:false,nativeText:meText}];
 const rows=[ai(0,'輪迴開場測試正文。','chapter'),{scanIndex:1,role:'me',domText:meText,originalText:meText,nativeText:meText,playerSources:sources,formatSource:{playerSources:sources,playerGapHasMedia:false}},ai(2,'｜2026年8月22日｜\n｜🕒18:45｜\n｜📍測試地點｜\n普通回覆。')];
 const bottom={stable:true,reason:'stable',waitedMs:8338,collected:3,initialScrollHeight:1000,finalScrollHeight:1000};
 const phaseHistory=['bottom-confirmed','source-audit','native-format','serialize','failure'].map(phase=>({phase}));
 const ev={complete:false,headerCandidates:0,headers:[],nativeCandidates:[],unverifiedCards:[],exportedEvents:0,ordinaryAiTotal:1,ordinaryAiVerified:1,unresolvedAccepted:0,unresolvedHeaders:0,unreadableHistoryMarkers:0,historyMarkersObserved:3};
 const ps={originalUserMarkers:1,renderedPlayerRows:1,countDifference:0,mappedNativeUserMarkers:1,unmappedNativeUserMarkers:0,unmappedNativeUserDetails:[],rowsWithMultipleNativeUserSources:0,multipleNativeSourceDetails:[],rowsWithoutProvenUserMarker:0,rowsWithoutProvenUserMarkerIndices:[],sourceInMultiplePlayerRows:[],linkedButNotObserved:[]};
 const cp={format:'gal-ai-unverified-scan',version:1,importable:false,validated:false,complete:false,forensicOnly:true,scope:'unverified-read-progress',scanRunId:run,scannerVersion:version,coreVersion:version,target:{cycleId:id,cycleTitle:'第1輪迴',worldName:'測試世界'},source:{url},collectedCount:3,rawRows:3,phase:'failure',failedPhase:'serialize',phaseHistory,bottomProof:bottom,eventAudit:ev,rows};
 const diag={scanRunId:run,cycleId:id,scope:'full',scannerVersion:version,coreVersion:version,trustedCount:3,phase:'failure',failedPhase:'serialize',phaseHistory,bottomProof:bottom,validationPhases:{integrity:'passed',nativeFormatting:'failed'},autoContinueAudit:{ok:true,scannedRows:3,observedNativeMarkers:3,markerCountDifference:0,observedUserMessages:1,playerRows:1,candidateIndices:[],gaps:[],problems:[],unknownMarkers:[],unaccountedAIOrEvents:[],playerSourceAudit:ps},playerSourceAudit:ps,eventAudit:ev};
 const state={format:'gal-archive-scan-status',version:2,scanRunId:run,cycleId:id,cycleTitle:'第1輪迴',scannerVersion:version,scope:'full',state:'failed',scanned:3,unverifiedCount:3,exportPending:false,pendingFiles:[],source:url,files:{unverified:'raw.json',diagnostic:'diag.json'}};
 return structuredClone({cp,diag,state});
}
const run=f=>replay(f.cp,f.diag,f.state,core,evidence);
test('complete saved batch exports canonical schema without rewriting original evidence',()=>{
 const f=fixture(),before=JSON.stringify(f),r=run(f);
 assert.equal(JSON.stringify(f),before);assert.equal(r.report.nativeFormatAudit.verified,2);
 assert.equal(r.report.importable,false);assert.equal(r.report.canonicalAvailable,true);
 assert.equal(r.canonical.format,'gal-ai-authoritative-scan');assert.equal(r.canonical.validation.nativeFormatComplete,true);
 assert.equal(r.canonical.scannerVersion,'0.8.47');assert.equal(r.canonical.coreVersion,core.version);
 assert.equal(r.canonical.offlineRecovery.liveRescan,false);assert.equal(r.canonical.messages[0].id,'galnative-'+hash(f.cp.source.url+'|0|message'));
 assert.equal(r.canonical.messages[1].gameTime,'2026-08-22T10:45:00.000Z');
 assert.equal(r.canonical.messages[0].gameTime,r.canonical.messages[1].gameTime);
});
test('incomplete and early-phase batches cannot be promoted even if collected rows validate',()=>{
 for(const mutate of [f=>{f.cp.bottomProof=null},f=>{f.cp.bottomProof.waitedMs=7999},f=>{f.cp.failedPhase=f.diag.failedPhase='integrity'},f=>{f.diag.autoContinueAudit=null},f=>{f.state.state='running'},f=>{f.diag.scanRunId='wrong'},f=>{f.state.scanned=2},f=>{f.cp.source.url='https://example.com/chat/a'},f=>{f.diag.eventAudit.unresolvedAccepted=1}]){
  const f=fixture();mutate(f);assert.throws(()=>run(f));
 }
});
test('tampered, duplicate or missing player and AI native evidence remains rejected',()=>{
 for(const mutate of [f=>{f.cp.rows[2].scanIndex=4},f=>{f.cp.rows[2].formatSource.nativeReply.markerCount=2},f=>{f.cp.rows[2].sourceMessageId='native-1'},f=>{f.cp.rows[1].playerSources[0].nativeText+='變更'},f=>{f.cp.rows[1].formatSource.playerSources=[]},f=>{f.cp.rows[2].nativeText+='變更'},f=>{f.diag.playerSourceAudit.mappedNativeUserMarkers=0}]){
  const f=fixture();mutate(f);assert.throws(()=>run(f));
 }
});
test('a remaining native content difference returns only a diagnostic, not canonical JSON',()=>{
 const f=fixture();f.cp.rows[2].nativeText+='新增文字';f.cp.rows[2].formatSource.nativeReply.text=f.cp.rows[2].nativeText;
 const r=run(f);assert.equal(r.canonical,null);assert.deepEqual(r.report.failedIndices,[2]);assert.equal(r.report.importable,false);
});
test('website button, separate files, local-only report and cache assets are wired',()=>{
 const html=fs.readFileSync(require.resolve('./index.html'),'utf8'),sw=fs.readFileSync(require.resolve('./sw.js'),'utf8'),js=fs.readFileSync(require.resolve('./archive-replay.js'),'utf8');
 for(const id of ['archiveReplayOpen','archiveReplayRaw','archiveReplayDiag','archiveReplayState','archiveReplayRun','archiveReplayDownload','archiveReplayReport'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/id="archiveReplayDownload"[^>]*disabled/);assert.match(html,/archive-replay\.js\?v=4/);assert.match(sw,/archive-replay\.js/);assert.match(sw,/gal-format-evidence\.js/);
 assert.doesNotMatch(js,/\bfetch\s*\(|indexedDB|firestore|localStorage|sessionStorage/);
});

test('V0.9.06 player quote proof is narrow and rejects other changes',()=>{
 const text=fs.readFileSync(require.resolve('./archive-replay.js'),'utf8');
 const proof=new Function("const norm=s=>String(s??'').replace(/\\s/gu,'');"+text.slice(text.indexOf(' function playerQuoteProof('),text.indexOf(' const hash='))+"\nreturn playerQuoteProof")();
 assert.equal(proof('甲“測試”乙','甲\n「測試」\n乙'),true);
 for(const d of ['甲「測試”乙','甲「測試」丙','甲「」乙','甲測試乙','甲」測試「乙'])assert.equal(proof('甲“測試”乙',d),false);
});
