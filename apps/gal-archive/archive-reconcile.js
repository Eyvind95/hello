/* Manual recovery of one fully scanned, fail-closed Gal AI historical checkpoint.
 * NEVER marks a failed scan as machine-validated. Requires a second-run
 * native provenance diagnostic and explicit user review of the two merges.
 * No network, no file writes; the archive's existing preview/backup/apply
 * flow remains the only way to change local records.
 */
(function(root,factory){
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.GalArchiveReconcile=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const EXPECTED={cycleId:'a20b0ddc-2a88-41a5-a980-b81c4f988816',
  checkpointRun:'cbaad410-6316-4cbd-9e27-cfde6797f22c',
  auditRun:'51f9e7bc-f376-4c62-8f69-ce5f6aba354c',
  url:'https://www.whif.io/chat/34677088-588c-48e7-a1be-44c405c82e70',
  merged:[1474,2268],continuations:[1536,1798,2007],
  events:[95,1567,1588,1599],rows:2630,playerRows:1311,nativePlayers:1313};
 function fail(why){throw Error('救援來源驗收拒絕：'+why)}
 function hash(str){
  let a=0x811c9dc5,b=0x811c9dc5;
  for(let i=0;i<str.length;i++){
   a=Math.imul(a^str.charCodeAt(i),16777619)>>>0;
   b=Math.imul(b^str.charCodeAt(i),2246822519)>>>0;
  }
  return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
 }
 function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
 function requireEqual(value,expect,reason){if(!same(value,expect))fail(reason)}
 function verify(cp,diag,confirmed){
  if(!confirmed)fail('請先人工核對第 1475／2269 則兩處連續玩家原文');
  if(cp?.format!=='gal-ai-incomplete-scan-checkpoint'||cp?.importable!==false||
   cp?.complete!==false||cp?.validated!==false||cp?.scannerVersion!=='0.8.36')
   fail('只接受原始 V0.8.36 不可匯入保全，不接受偽裝成已完成的 JSON');
  requireEqual(cp.scanRunId,EXPECTED.checkpointRun,'原始保全工作 ID 不符');
  requireEqual(cp.target?.cycleId,EXPECTED.cycleId,'原始輪迴 ID 不符');
  requireEqual(cp.source?.url,EXPECTED.url,'WHIF 原始聊天網址不符');
  if(!Array.isArray(cp.rows)||cp.rows.length!==EXPECTED.rows||
    cp.collectedCount!==EXPECTED.rows)fail('2630 筆原始保全資料不完整');
  if(diag?.scanRunId!==EXPECTED.auditRun||diag?.cycleId!==EXPECTED.cycleId||
    diag?.scope!=='full'||diag?.bottomProof?.stable!==true||
    diag?.trustedCount!==EXPECTED.rows)fail('V0.8.37 終態診斷來源／頁尾／筆數未驗證');
  const ac=diag.autoContinueAudit,ps=ac?.playerSourceAudit,ev=diag.eventAudit;
  if(!ac||ac.ok!==false||ac.problems?.length!==1||
   !ac.problems[0]?.errors?.includes('more-observed-user-messages-than-player-rows'))
   fail('本次診斷存在非雙來源玩家合併的其他問題');
  if(ac.observedNativeMarkers!==2632||ac.scannedRows!==EXPECTED.rows||
   ac.unknownMarkers?.length||ac.unaccountedAIOrEvents?.length||
   ac.observedUserMessages!==EXPECTED.nativePlayers||ac.playerRows!==EXPECTED.playerRows)
   fail('原生標記與掃描列的數量／來源完整性證據不符');
  if(!ps||ps.countDifference!==2||ps.originalUserMarkers!==EXPECTED.nativePlayers||
   ps.renderedPlayerRows!==EXPECTED.playerRows||ps.mappedNativeUserMarkers!==EXPECTED.nativePlayers||
   ps.unmappedNativeUserMarkers!==0||ps.rowsWithoutProvenUserMarker!==0||
   ps.rowsWithMultipleNativeUserSources!==2||
   ps.sourceInMultiplePlayerRows?.length||ps.linkedButNotObserved?.length||
   ps.unmappedNativeUserDetails?.length||ps.rowsWithoutProvenUserMarkerIndices?.length)
   fail('玩家來源 ID 無法全部一對一／一對多核對');
  if(!Array.isArray(ps.multipleNativeSourceDetails)||ps.multipleNativeSourceDetails.length!==2)
   fail('合併來源定位不是兩處');
  requireEqual(ps.multipleNativeSourceDetails.map(x=>x.scanIndex).sort((a,b)=>a-b),EXPECTED.merged,
   '合併玩家來源不位於 1474／2268');
  requireEqual(ac.gaps?.map(x=>x.scanIndex),EXPECTED.continuations,
   '三處 AI 自動繼續索引不符');
  if(ac.gaps.some(x=>x.ok!==true||x.errors?.length||
   x.noGapMarkers!==true||x.bothOrdinary!==true))
   fail('AI 自動繼續存在來源驗證失敗');
  if(!ev||ev.exportedEvents!==4||ev.unresolvedAccepted!==0||
   ev.unresolvedHeaders!==0||ev.unreadableHistoryMarkers!==0||
   ev.ordinaryAiVerified!==ev.ordinaryAiTotal||
   ev.historyMarkersObserved!==2632)
   fail('事件來源／已接取／正常 AI 原生證據有缺漏');
  // eventAudit.complete=false in this failed work is a DEPENDENT flag
  // caused by the player-count gate. Its independently measured facts are checked.
  requireEqual(ev.headers?.map(x=>x.scanIndex),EXPECTED.events,
   '事件標頭的原生位置不符');
  if(ev.headers.some(x=>x.classified!==true))fail('存在未分類事件標頭');
  const ids=new Set();
  const roles={me:0,ai:0};
  cp.rows.forEach((r,i)=>{
   if(r.scanIndex!==i||!['me','ai'].includes(r.role)||!r.text?.trim()||
      typeof r.text!=='string'||r.text.length>30000)fail('第 '+i+' 則資料損壞、空白或來源身份不明');
   roles[r.role]++;
   if(r.role==='ai'){
    if(r.nativeReason!=='available'||!r.sourceMessageId||
       typeof r.nativeText!=='string'||!r.nativeText.trim()||
       ids.has(r.sourceMessageId))
     fail('第 '+i+' 則 AI／事件缺少唯一原生 ID 或原文');
    ids.add(r.sourceMessageId);
   }else if(r.nativeText||r.sourceMessageId)fail('玩家來源欄位與保全格式異常');
  });
  if(roles.me!==EXPECTED.playerRows||roles.ai!==1319||ids.size!==1319)
   fail('玩家／AI／事件列數量不符');
  requireEqual(cp.rows.filter(x=>x.eventType==='event').map(x=>x.scanIndex),EXPECTED.events,
   '保全事件位置不符');
  requireEqual(cp.rows.filter(x=>x.autoContinue===true).map(x=>x.scanIndex),EXPECTED.continuations,
   '保全自動繼續位置不符');
  for(const detail of ps.multipleNativeSourceDetails){
   const i=detail.scanIndex,raw=cp.rows[i],prev=cp.rows[i-1],next=cp.rows[i+1];
   if(raw.role!=='me'||prev?.role!=='ai'||next?.role!=='ai'||
     detail.nativeUserSourceCount!==2||detail.sourceHashes?.length!==2||
     new Set(detail.sourceHashes).size!==2||
     detail.playerTextLength!==raw.text.length||
     detail.previousAiSourceHash!==hash(prev.sourceMessageId)||
     detail.nextAiSourceHash!==hash(next.sourceMessageId))
    fail('第 '+(i+1)+' 則玩家與相鄰 AI 原生 ID／文字長度不符');
  }
  return {ok:true,sourceCount:EXPECTED.nativePlayers,playerRows:roles.me,
   mergedRows:ps.multipleNativeSourceDetails.map(x=>({
    scanIndex:x.scanIndex,sourceHashes:x.sourceHashes,
    previousAiSourceHash:x.previousAiSourceHash,
    nextAiSourceHash:x.nextAiSourceHash
   }))};
 }
 function convert(cp,diag,confirmed,core){
  const proof=verify(cp,diag,confirmed);
  if(!core?.validate||!core?.compareNativeParagraphs)fail('Gal AI 原生完整性驗證器尚未載入');
  const sourceCount=new Map();
  for(const r of cp.rows)if(r.sourceMessageId)
   sourceCount.set(r.sourceMessageId,(sourceCount.get(r.sourceMessageId)||0)+1);
  const rows=cp.rows.map(r=>({
   role:r.role,text:r.text,eventType:r.eventType||null,
   worldName:r.worldName||null,autoContinue:r.autoContinue===true,
   formatSource:r.role==='ai'&&r.sourceMessageId?{nativeReply:{
    reason:r.nativeReason,messageId:r.sourceMessageId,text:r.nativeText,
    scannedText:r.text,markerCount:sourceCount.get(r.sourceMessageId)===1?1:0
   }}:undefined
  }));
  const validated=core.validate(rows,cp.target.worldName);
  if(!validated.ok)fail('離線逐筆重驗未通過：'+validated.errors.slice(0,3).join('／'));
  requireEqual(validated.events.map(x=>x.scanIndex),EXPECTED.events,'離線事件驗證未通過');
  if(validated.autoContinues!==3||validated.pairs!==EXPECTED.playerRows||
   validated.messages.length!==2625)fail('離線回合配對數量不正確');
  const path=new URL(EXPECTED.url).origin+new URL(EXPECTED.url).pathname;
  const chatKey=(hash(path)+hash(path+'|Gal AI')).slice(0,32);
  const build=(entry,kind)=>{
   const scanIndex=entry.scanIndex;
   const sourceEventId='galnative-'+hash(path+'|'+scanIndex+'|'+kind);
   return {id:sourceEventId,role:entry.role,text:entry.text,gameTime:entry.gameTime||null,
    sourceEventId,sourcePartIndex:0,chatKey,messageOrder:scanIndex,scanIndex,
    sourceKind:'gal-ai-native',sourceSite:'https://www.whif.io',
    sourceRecovery:'manual-two-source-reconciliation'};
  };
  const warning=[],allMessages=validated.messages.map(entry=>{
   const item=build(entry,'message'),raw=cp.rows[entry.scanIndex];
   if(entry.verifiedUntimedNative)item.nativeClockEvidence='verified-original-without-game-time';
   if(entry.autoContinue)item.autoContinue={
    kind:'whif-adjacent-character-replies',
    previousSourceEventId:'galnative-'+hash(path+'|'+(entry.scanIndex-1)+'|message')
   };
   if(item.role==='ai'){
    const compared=core.compareNativeParagraphs(raw.text,raw.nativeText,{
     source:'whif-message-content',
     verifiedUntimedNative:entry.verifiedUntimedNative===true
    });
    if(compared.text!==null)item.text=compared.text;
    else warning.push('scanIndex '+entry.scanIndex+'：原生段落投影無法單獨核實，仍使用保全掃描文字');
   }else if(EXPECTED.merged.includes(entry.scanIndex)){
    const detail=proof.mergedRows.find(x=>x.scanIndex===entry.scanIndex);
    item.nativeUserMergeVerified=false; // Manual review, NOT per-source full text proof.
    item.nativeUserMergeReview={method:'user-visual-review-of-WHIF-bubbles',
     sourceCount:2,sourceHashes:detail.sourceHashes,
     adjacentAiSourceHashes:[detail.previousAiSourceHash,detail.nextAiSourceHash],
     originalSourceSegmentsAvailable:false,renderedMergedTextPreserved:true};
   }
   return item;
  });
  const events=validated.events.map(entry=>{
   const ev=build(entry,'event');return {...ev,role:'ai',status:'accepted',
    title:entry.title,worldName:entry.worldName||null};
  });
  let opening=validated.opening;
  const originalOpening=cp.rows[0];
  const compared=core.compareNativeParagraphs(originalOpening.text,originalOpening.nativeText,{
   source:'whif-message-content',opening:true
  });
  if(compared.text!==null)opening=compared.text;
  else warning.push('開場：原生段落投影無法單獨核實，保留保全文字');
  return {
   format:'gal-ai-authoritative-scan',version:1,
   generatedAt:new Date().toISOString(),scope:'entire-opening-to-bottom',
   source:{url:EXPECTED.url,origin:'https://www.whif.io',path:new URL(EXPECTED.url).pathname,
    gameClockOnly:true},
   target:{...cp.target,uid:'',manager:'',managerNames:[]},
   opening,messages:allMessages,events,
   validation:{ok:true,pairs:validated.pairs,events:events.length,
    autoContinues:validated.autoContinues,
    openingChars:opening.length,
    gameTimeCount:allMessages.filter(x=>!!x.gameTime).length,
    unknownGameTimeCount:validated.unknownGameTimeCount,
    verifiedUntimedCount:validated.verifiedUntimedCount,
    warnings:[...validated.warnings,...warning],
    errors:[]},
   rawRows:cp.rows.length,readOnlyUntilImported:true,
   reconciliation:{kind:'manual-reviewed-player-source-merges',
    machineScanComplete:false,checkpointImportable:false,
    checkpointRun:cp.scanRunId,auditRun:diag.scanRunId,
    checkpointVersion:'0.8.36',auditVersion:'0.8.37',
    verifiedSourceCount:proof.sourceCount,
    approvedIndices:proof.mergedRows,exactOriginalSegmentsAvailable:false,
    manualApproved:true,remainingWarnings:warning},
   note:'V0.8.36 未完成保全＋V0.8.37 終態來源審計的手動救援；不是掃描器正常通過。'
  };
 }
 return {hash,verify,convert,EXPECTED};
});
