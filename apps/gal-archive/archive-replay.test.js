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
 assert.match(html,/id="archiveReplayDownload"[^>]*disabled/);assert.match(html,/archive-replay\.js\?v=12/);assert.match(sw,/archive-replay\.js/);assert.match(sw,/gal-format-evidence\.js/);
 assert.doesNotMatch(js,/\bfetch\s*\(|indexedDB|firestore|localStorage|sessionStorage/);
});

test('V0.9.06 player quote proof is narrow and rejects other changes',()=>{
 const text=fs.readFileSync(require.resolve('./archive-replay.js'),'utf8');
 const proof=new Function("const norm=s=>String(s??'').replace(/\\s/gu,'');"+text.slice(text.indexOf(' function playerQuoteProof('),text.indexOf(' const hash='))+"\nreturn playerQuoteProof")();
 assert.equal(proof('甲“測試”乙','甲\n「測試」\n乙'),true);
 for(const d of ['甲「測試”乙','甲「測試」丙','甲「」乙','甲測試乙','甲」測試「乙'])assert.equal(proof('甲“測試”乙',d),false);
});

test('early complete failures are revalidated, but aggregate count is not independent source proof',()=>{
 const f=fixture();
 const world={worldName:'測試世界',worldKey:'test',cycleNumber:1,archiveKey:'test::synthetic-cycle'};
 Object.assign(f.cp.target,world);Object.assign(f.diag,world);Object.assign(f.state,world);
 f.cp.failedPhase=f.diag.failedPhase='integrity';f.diag.validationPhases.integrity='failed';
 f.cp.phaseHistory=f.diag.phaseHistory=['bottom-confirmed','integrity','failure'].map(phase=>({phase}));
 f.diag.autoContinueAudit=null;f.diag.playerSourceAudit=null;f.diag.autoContinueCandidates=[];
 const first=run(f);assert.equal(first.report.integrityOk,true);assert.equal(first.report.nativeFormatAudit.verified,2);assert.equal(first.report.sourceAuditOk,false);assert.equal(first.canonical,null);
 const inventory=[{id:'native-0',kind:'ordinary-message',sender:'chapter',playerRows:[]},{id:'native-1',kind:'ordinary-message',sender:'user',playerRows:[1]},{id:'native-2',kind:'ordinary-message',sender:'character',playerRows:[]}];
 f.cp.historySourceManifest=structuredClone(inventory);f.diag.historySourceManifest=structuredClone(inventory);
 const ok=run(f);assert.equal(ok.report.sourceAuditOk,true);assert.ok(ok.canonical);assert.equal(ok.canonical.offlineRecovery.sourceAuditReused,false);
 for(const mutate of [x=>x.diag.historySourceManifest[1].id='foreign',x=>{x.cp.historySourceManifest[1].playerRows=[];x.diag.historySourceManifest[1].playerRows=[]},x=>{x.cp.historySourceManifest[1].sender='character';x.diag.historySourceManifest[1].sender='character'}]){
  const x=structuredClone(f);mutate(x);assert.equal(run(x).canonical,null);
 }
});
test('optional evidence input and actual WHIF monospace frame selector are wired',()=>{
 const html=fs.readFileSync(require.resolve('./index.html'),'utf8'),src=fs.readFileSync(require.resolve('./chrome-extension/gal-content.js'),'utf8');
 assert.match(html,/id="archiveReplayProbes"[^>]*multiple/);
 assert.match(src,/pre,code,span\.message-bubble-text\.TemplatedText\.font-mono/);
 assert.match(src,/historySourceManifest:\s*fullDiagnostic\?\.historySourceManifest/);
 assert.match(src,/diagnostic\.historySourceManifest=\[\.\.\.eventAudit\.history\]/);
});

test('independent source supplement proves ordered IDs, original hashes, both edges and player identity',()=>{
 const f=fixture(),world={worldName:'測試世界',worldKey:'test',cycleNumber:1,archiveKey:'test::synthetic-cycle'};
 Object.assign(f.cp.target,world);Object.assign(f.diag,world);Object.assign(f.state,world);
 f.cp.failedPhase=f.diag.failedPhase='integrity';f.diag.validationPhases.integrity='failed';f.cp.phaseHistory=f.diag.phaseHistory=['bottom-confirmed','integrity','failure'].map(phase=>({phase}));f.diag.autoContinueAudit=null;f.diag.playerSourceAudit=null;f.diag.autoContinueCandidates=[];
 const entries=f.cp.rows.map((r,i)=>({id:'native-'+i,index:100+i,order:i,kind:'ordinary-message',sender:i===0?'chapter':i===1?'user':'character',accepted:null,nativeHash:hash(r.nativeText),nativeNormHash:hash(r.nativeText.replace(/\s/gu,'')),nativeLength:r.nativeText.length,previousId:i?'native-'+(i-1):null,nextId:i<2?'native-'+(i+1):null,...(i===1?{player:{ownerId:'native-1',bodyParts:1,bodyNormHash:hash(r.nativeText),hasMedia:false}}:{})}));
 const w=(top,ids)=>({top,height:1000,clientHeight:500,ids,indices:ids.map(id=>entries.find(r=>r.id===id).index),stable:true});
 const windows=[w(0,['native-0','native-1']),w(500,['native-1','native-2'])];
 const edge=w=>({stable:true,waitedMs:8300,checks:[0,8300].map(at=>({at,top:w.top,height:w.height,clientHeight:w.clientHeight,ids:w.ids}))});
 const p={format:'gal-ai-history-source-proof',version:1,forensicOnly:true,importable:false,complete:true,scope:'independent-live-source-inventory',scanRunId:'other-run',scannerVersion:'0.9.14',coreVersion:'0.9.14',source:f.cp.source,target:f.cp.target,entries,windows,firstProof:edge(windows[0]),lastProof:edge(windows[1]),eventCards:[],autoContinueIds:[]};
 const go=p=>replay(f.cp,f.diag,f.state,core,evidence,[],p);
 // Older integrity failure may have stopped the ordinary AI audit early.
 f.cp.eventAudit.ordinaryAiTotal=f.cp.eventAudit.ordinaryAiVerified=0;
 f.diag.eventAudit.ordinaryAiTotal=f.diag.eventAudit.ordinaryAiVerified=0;
 const rebuilt=go(p).canonical;assert.ok(rebuilt);assert.equal(rebuilt.offlineRecovery.historySupplementRunId,'other-run');
 assert.equal(rebuilt.eventAudit.ordinaryAiTotal,1);assert.equal(rebuilt.eventAudit.ordinaryAiVerified,1);
 assert.deepEqual(rebuilt.offlineRecovery.originalEventAuditCounts,{ordinaryAiTotal:0,ordinaryAiVerified:0});
 const verifier=require('./archive-replay.js').verifyHistorySupplement;
 const labeled=structuredClone(f.cp);labeled.rows[1].domText='**測試標籤**\n'+labeled.rows[1].nativeText;
 const q=structuredClone(p);Object.assign(q.entries[1].player,{bodyNormHash:hash('格式投影後文字'),markerNormHash:hash('格式投影後文字'),outsideLabelHashes:[hash('測試標籤')]});
 const labels=[{i:1,label:'測試標籤'}],details={};
 assert.equal(verifier(labeled,q,labels,[],details),true);assert.deepEqual(details.labelProofIndices,[1]);
 for(const mutate of [x=>x.entries[1].player.hasMedia=true,x=>x.entries[1].player.outsideLabelHashes=[hash('其他標籤')],x=>x.entries[1].player.markerNormHash='different',x=>x.entries[1].nativeHash='different']){
  const x=structuredClone(q);mutate(x);assert.equal(verifier(labeled,x,labels,[]),false);
 }
 const media=structuredClone(q);media.entries[1].player.hasMedia=true;const blocked={};assert.equal(verifier(labeled,media,labels,[],blocked),false);assert.deepEqual(blocked.playerIssues,[{scanIndex:1,reason:'live-player-media-present'}]);
 const wrong=structuredClone(labeled);wrong.rows[1].domText+='缺漏';assert.equal(verifier(wrong,q,labels,[]),false);
 for(const mutate of [x=>x.entries[1].nativeHash='wrong',x=>x.entries[1].index++,x=>x.entries[1].sender='character',x=>x.entries[1].player.ownerId='foreign',x=>x.windows[1].ids=['native-2'],x=>x.firstProof.waitedMs=7999,x=>x.lastProof.checks.pop(),x=>x.target={...x.target,cycleId:'other'},x=>x.complete=false,x=>x.autoContinueIds=['native-2']]){
  const x=structuredClone(p);mutate(x);assert.equal(go(x).canonical,null);
 }
});
test('source-only overlap never appends disjoint or reordered windows',()=>{
 const s=fs.readFileSync(require.resolve('./chrome-extension/gal-content.js'),'utf8');
 const append=new Function(s.slice(s.indexOf('function historySourceAppend('),s.indexOf('function historySourceSample('))+'\nreturn historySourceAppend')();
 const ids=[];append(ids,['a','b']);append(ids,['b','c']);append(ids,['c','d']);assert.deepEqual(ids,['a','b','c','d']);
 for(const w of [['z'],['b','d'],['d','a'],['d','d']])assert.throws(()=>append(ids,w));
 const body=s.slice(s.indexOf('async function historySourceProbe('),s.indexOf('async function anchorRecoveryProbe('));assert.doesNotMatch(body,/\bsnapshot\(|\bboundaryRead\(|markdownFromDom|parseGameTime/);
});

test('native player image references only permit bounded WHIF image links',()=>{
 const api=require('./archive-replay.js');
 const url='https://img.whif.io/synthetic/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/768';
 assert.equal(api.validNativeImageUrl(url),true);
 for(const v of [url+'?x=1',url+'#x',url.replace('https:','http:'),url.replace('img.whif.io','example.invalid'),url.replace('/768','/999'),url.replace('img.whif.io','img.whif.io.evil.invalid'),'javascript:alert(1)'])assert.equal(api.validNativeImageUrl(v),false);
 assert.equal(api.capturedPlayerImage({source:{url:'https://whif.io/chat/test'}},{},{id:'x',player:{}},{generatedAt:'2026-01-01T00:00:00Z'},{sourceId:'other'}),null);
 const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
 assert.match(html,/nativeImageReferences.*historySupplementRunId/s);
 assert.match(html,/rel="noopener noreferrer">查看 WHIF 原生附圖/);
 assert.match(html,/nativeSourceMessageId','nativeImageReferences'\]\.every/);
});

test('hidden player proof inserts original content only at manifest-bound neighboring source IDs',()=>{
 const api=require('./archive-replay.js'),h=api.hash,core=globalThis.GalArchiveCore;
 const target={cycleId:'cycle',cycleTitle:'第1輪迴',worldName:'測試世界',worldKey:'test',cycleNumber:1,archiveKey:'test::cycle'},url='https://www.whif.io/chat/test';
 const row=(id,text,i)=>{const e={messageId:id,kind:'ordinary-message',sender:'character'};return {role:'ai',scanIndex:i,sourceMessageId:id,sourceEvidence:e,nativeText:text,domText:text,formatSource:{nativeReply:{reason:'available',markerCount:1,messageId:id,text,scannedText:text,eventEvidence:e}}}};
 const cp={format:'gal-ai-unverified-scan',importable:false,forensicOnly:true,scanRunId:'old',source:{url},target,rows:[row('open','開場',0),row('a','前方',1),row('b','後方',2)],historySourceManifest:['open','a','p','b'].map(id=>({id,kind:'ordinary-message',sender:id==='p'?'user':'character',playerRows:[]}))};
 const raw='{{測試內容}}',native={reason:'player-anchor-evidence',text:raw,eventEvidence:{messageId:'p',kind:'ordinary-message',sender:'user'},nativeHash:h(raw),nativeNormHash:h(raw),nativeLength:raw.length};
 const dom=(attr)=>({outerHTML:'<div '+attr+'="p"></div>',textContent:'',innerText:'',geometry:{ownerId:'p'}});
 const snapshot={sourceId:'p',native,hasMedia:false,loading:false,order:['a','p','b'],markerDom:dom('data-selection-copy-message-id'),wrapperDom:dom('data-message-id'),adjacent:[['a','前方'],['b','後方']].map(([id,s])=>({id,source:{messageId:id,sender:'character',kind:'ordinary-message'},nativeHash:h(s),nativeLength:s.length}))};
 const proof={format:'gal-ai-hidden-player-source-proof',version:1,forensicOnly:true,importable:false,complete:true,stable:true,scope:'visible-player-anchor',scanRunId:'new',source:{url},target,scannerVersion:'0.10.6',coreVersion:'0.10.6',input:{anchorId:'p',neighbors:['a','b']},first:snapshot,second:JSON.parse(JSON.stringify(snapshot))};
 const result=api.restoreHiddenPlayerRows(cp,[proof],core);
 assert.equal(result.rows[2].nativeText,raw);assert.equal(result.rows[3].sourceMessageId,'b');assert.deepEqual(result.manifest[2].playerRows,[2]);assert.equal(cp.rows.length,3);
 for(const bad of [{...proof,stable:false},{...proof,source:{url:'https://www.whif.io/chat/other'}},{...proof,second:{...snapshot,hasMedia:true}},{...proof,second:{...snapshot,order:['p','a','b']}},{...proof,second:{...snapshot,native:{...native,nativeHash:'wrong'}}}])assert.throws(()=>api.restoreHiddenPlayerRows(cp,[bad],core));
});

test('legacy diagnostic reference round-trip preserves all fields and refuses conflicts',()=>{
 const api=require('./archive-replay.js'),a={scanIndex:1,sourceMessageId:null,domText:'完整測試'};
 const original={errors:[{scanIndex:1,error:'test',message:a,context:[a]},{scanIndex:2,error:'test2',message:null,context:[a]}]};
 const before=JSON.stringify(original),report=api.diagnosticRoundTrip(original);
 assert.equal(report.ok,true);assert.equal(report.uniqueRows,1);assert.equal(report.issues,2);assert.equal(JSON.stringify(original),before);
 assert.throws(()=>api.diagnosticRoundTrip({errors:[...original.errors,{message:{...a,domText:'錯誤'},context:[]}]}));
});
test('story display preserves all player templates and hides only AI templates without mutating source',()=>{
 const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
 const show=new Function(html.slice(html.indexOf('function archiveGalVisibleText('),html.indexOf('function archiveAdventureBodyHtml('))+'\nreturn archiveGalVisibleText')();
 const raw='前文{{測試模板}}後文';
 assert.equal(show(raw,'me'),raw);assert.equal(show(raw,'ai'),'前文後文');
 assert.equal(show('前文{{未閉合','ai'),'前文{{未閉合');
});
