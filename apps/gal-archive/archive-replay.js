/* Local-only recovery from complete, source-audited failed scans.
 * A replay is not a new live scan. Original failed files remain unchanged.
 */
(function(root,factory){
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.GalArchiveReplay=api;
 if(typeof document!=='undefined')api.mount(document,root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const assert=(ok,why)=>{if(!ok)throw Error(why)};
 const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const norm=s=>String(s??'').replace(/\s/gu,'');
 const empty=a=>Array.isArray(a)&&a.length===0;
 const hash=str=>{let h1=2166136261,h2=0x811c9dc5;for(let i=0;i<str.length;i++){
  h1=Math.imul(h1^str.charCodeAt(i),16777619)>>>0;h2=Math.imul(h2^str.charCodeAt(i),2246822519)>>>0;
 }return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0')};
 function replay(cp,diag,state,core,evidence){
  assert(core?.validate&&core?.compareNativeParagraphs&&evidence?.summarize&&core.version===evidence.version,'核心及格式模組未載入或版本不同，請強制更新');
  assert(cp?.format==='gal-ai-unverified-scan'&&cp.version===1&&cp.importable===false&&cp.validated===false&&cp.complete===false&&cp.forensicOnly===true&&cp.scope==='unverified-read-progress','只接受原始未驗證保全 JSON');
  const n=cp.rows?.length,run=cp.scanRunId,id=cp.target?.cycleId,version=cp.scannerVersion;
  assert(Number.isInteger(n)&&n>=3&&n<=20000&&cp.collectedCount===n&&cp.rawRows===n,'保全筆數不符');
  assert(typeof run==='string'&&run&&typeof id==='string'&&id&&cp.target.worldName&&cp.target.cycleTitle,'缺少批次或輪迴歸屬');
  assert(/^0\.8\.(?:4[0-9]|[5-9]\d|\d{3,})$/.test(version)&&version===cp.coreVersion&&Number(version.split('.')[2])<=Number(core.version.split('.')[2]),'不支援此舊版或更新版本保全');
  assert(diag?.scanRunId===run&&diag.cycleId===id&&diag.scope==='full'&&diag.scannerVersion===version&&diag.coreVersion===version&&diag.trustedCount===n,'診斷與保全批次、版本或筆數不符');
  assert(state?.format==='gal-archive-scan-status'&&state.version===2&&state.scanRunId===run&&state.cycleId===id&&state.cycleTitle===cp.target.cycleTitle&&state.scannerVersion===version&&state.scope==='full'&&state.state==='failed'&&state.scanned===n&&state.unverifiedCount===n&&state.exportPending===false&&empty(state.pendingFiles)&&state.files?.unverified&&state.files?.diagnostic,'狀態檔不是同批次已完成保全的失敗終態');
  const url=new URL(cp.source?.url);
  assert(['https://www.whif.io','https://whif.io'].includes(url.origin)&&/^\/chat\/[^/]+\/?$/.test(url.pathname)&&url.href===url.origin+url.pathname&&state.source===url.href,'原始 WHIF 聊天來源不一致');
  const bottom=cp.bottomProof;
  assert(bottom?.stable===true&&bottom.reason==='stable'&&bottom.waitedMs>=8000&&bottom.collected===n&&Number.isFinite(bottom.initialScrollHeight)&&bottom.initialScrollHeight>0&&bottom.initialScrollHeight===bottom.finalScrollHeight&&eq(bottom,diag.bottomProof),'未到頁尾或缺少完整8秒穩定證明：禁止正式輸出');
  // Earlier failures have no live source audit. Do not fabricate it from
  // the presence of saved rows or change the old failure flags.
  assert(cp.phase==='failure'&&diag.phase==='failure'&&cp.failedPhase===diag.failedPhase&&cp.failedPhase==='serialize'&&diag.validationPhases?.integrity==='passed'&&diag.validationPhases?.nativeFormatting==='failed','原批次尚未完成現場來源稽核及格式驗收階段，不能安全轉正；需實機驗收');
  assert(cp.phaseHistory?.some(x=>x.phase==='bottom-confirmed')&&cp.phaseHistory?.some(x=>x.phase==='source-audit')&&cp.phaseHistory?.some(x=>x.phase==='native-format')&&eq(cp.phaseHistory,diag.phaseHistory),'缺少一致的現場驗收階段紀錄');
  const ac=diag.autoContinueAudit,ps=ac?.playerSourceAudit,ev=diag.eventAudit;
  assert(ac?.ok===true&&ac.notApplicable!==true&&ac.scannedRows===n&&empty(ac.problems)&&empty(ac.unknownMarkers)&&empty(ac.unaccountedAIOrEvents)&&eq(ps,diag.playerSourceAudit),'原批次缺少已通過的現場來源稽核');
  assert(ev&&eq(cp.eventAudit,ev)&&ev.unresolvedAccepted===0&&ev.unresolvedHeaders===0&&ev.unreadableHistoryMarkers===0&&empty(ev.unverifiedCards),'事件及歷史標記稽核未通過');
  const ids=new Set(),playerIds=new Set(),eventIndices=[],autoIndices=[],merged=[];
  const addId=s=>{assert(typeof s==='string'&&s&&!ids.has(s),'原生來源 ID 重複或缺失');ids.add(s)};
  const rows=cp.rows.map((r,i)=>{
   assert(r.scanIndex===i&&['ai','me'].includes(r.role)&&typeof r.domText==='string'&&r.domText.trim()&&r.domText.length<=25000&&r.originalText===r.domText,'索引、身分或原始DOM文字異常：'+i);
   const fs=r.formatSource;
   if(r.role==='ai'){
    const native=fs?.nativeReply,e=native?.eventEvidence;
    assert(native?.reason==='available'&&native.markerCount===1&&r.nativeMarkerCount===1&&native.messageId===r.sourceMessageId&&native.scannedText===r.domText&&typeof native.text==='string'&&native.text.trim()&&native.text===r.nativeText&&native.text.length<=30000&&e?.messageId===native.messageId&&eq(e,r.sourceEvidence),'原生 AI／事件證據不完整：'+i);
    addId(native.messageId);
    if(r.eventType==='event'){
     assert(i>0&&e.kind==='event-message'&&e.accepted===true,'事件無已接取原生證明：'+i);eventIndices.push(i);
    }else assert(!r.eventType&&e.kind==='ordinary-message'&&(i===0?e.sender==='chapter'||e.sender==='character':e.sender==='character'||e.sender==='assistant'),'開場或普通AI來源身分不符：'+i);
    if(r.autoContinue===true)autoIndices.push(i);
   }else{
    const sources=fs?.playerSources;
    assert(!r.eventType&&!r.autoContinue&&!fs?.playerGapHasMedia&&Array.isArray(sources)&&sources.length>0&&eq(sources,r.playerSources),'玩家來源分界缺失：'+i);
    for(const s of sources){
     assert(s.sender==='user'&&s.kind==='ordinary-message'&&s.nativeReason==='available'&&s.nativeSender==='user'&&s.nativeMessageId===s.id&&s.hasText===true&&!s.hasMedia&&typeof s.nativeText==='string'&&s.nativeText.trim(),'玩家原文未驗證：'+i);
     addId(s.id);playerIds.add(s.id);
    }
    assert(r.nativeText===sources.map(s=>s.nativeText).join('\n\n')&&norm(r.nativeText)===norm(r.domText),'玩家原文與DOM不一致：'+i);
    if(sources.length>1)merged.push({i,sources});
   }
   return {role:r.role,text:r.domText,eventType:r.eventType||null,worldName:r.worldName||null,autoContinue:r.autoContinue===true,formatSource:fs};
  });
  const playerRows=rows.filter(r=>r.role==='me').length,aiRows=n-playerRows-eventIndices.length-1;
  assert(ac.observedNativeMarkers===ids.size&&ac.markerCountDifference===ids.size-n&&ac.observedUserMessages===playerIds.size&&ac.playerRows===playerRows&&ps?.originalUserMarkers===playerIds.size&&ps.renderedPlayerRows===playerRows&&ps.mappedNativeUserMarkers===playerIds.size&&ps.unmappedNativeUserMarkers===0&&ps.rowsWithoutProvenUserMarker===0&&ps.countDifference===playerIds.size-playerRows&&ps.rowsWithMultipleNativeUserSources===merged.length&&empty(ps.sourceInMultiplePlayerRows)&&empty(ps.linkedButNotObserved)&&empty(ps.unmappedNativeUserDetails)&&empty(ps.rowsWithoutProvenUserMarkerIndices),'玩家／歷史來源數量或唯一性不一致');
  assert(Array.isArray(ps.multipleNativeSourceDetails)&&ps.multipleNativeSourceDetails.length===merged.length&&(!merged.length||ps.safeSourceMerge===true),'玩家多來源未完整證明');
  for(const {i,sources} of merged){
   const d=ps.multipleNativeSourceDetails.find(x=>x.scanIndex===i);
   assert(d?.contentProof?.ok===true&&d.nativeUserSourceCount===sources.length&&eq(d.sourceHashes,sources.map(s=>hash(s.id)))&&d.previousAiSourceHash===hash(cp.rows[i-1]?.sourceMessageId||'')&&d.nextAiSourceHash===hash(cp.rows[i+1]?.sourceMessageId||''),'多來源玩家證據不一致：'+i);
  }
  assert(eq(ac.candidateIndices,autoIndices)&&Array.isArray(ac.gaps)&&ac.gaps.length===autoIndices.length,'自動繼續來源清單不符');
  for(const i of autoIndices){
   const prev=rows[i-1],curr=rows[i],p=prev?.formatSource?.nativeReply,c=curr.formatSource.nativeReply,g=curr.formatSource.playerGap,a=ac.gaps.find(x=>x.scanIndex===i);
   assert(i>=2&&prev.role==='ai'&&!prev.eventType&&!curr.eventType&&p.messageId!==c.messageId&&g?.previousId===p.messageId&&g.currentId===c.messageId&&g.previous==='character'&&g.current==='character'&&empty(g.markers)&&g.loading===false&&a?.ok===true&&empty(a.errors)&&a.previousSourceHash===hash(p.messageId)&&a.currentSourceHash===hash(c.messageId)&&a.bothOrdinary===true&&a.noGapMarkers===true&&a.notLoading===true,'自動繼續證據不完整：'+i);
  }
  assert(ev.historyMarkersObserved===ids.size&&ev.exportedEvents===eventIndices.length&&ev.ordinaryAiTotal===aiRows&&ev.ordinaryAiVerified===aiRows&&ev.headerCandidates===eventIndices.length&&Array.isArray(ev.headers)&&eq(ev.headers.map(x=>x.scanIndex).sort((a,b)=>a-b),eventIndices)&&ev.headers.every(x=>x.classified===true)&&Array.isArray(ev.nativeCandidates),'事件數量或標頭不一致');
  const accepted=ev.nativeCandidates.filter(x=>x.accepted===true);
  assert(accepted.length===eventIndices.length&&ev.nativeCandidates.every(x=>x.accepted===true||x.accepted===false)&&eventIndices.every(i=>accepted.some(x=>x.scanIndex===i&&x.reason==='classified-event'&&x.sourceRef===hash(cp.rows[i].sourceMessageId))),'事件原生ID或接取證據不完整');
  const v=core.validate(rows,cp.target.worldName);
  assert(v.ok&&empty(v.errors)&&v.messages.length+v.events.length+1===n&&v.pairs===playerRows&&v.autoContinues===autoIndices.length&&eq(v.events.map(x=>x.scanIndex),eventIndices),'新版完整性重驗失敗：'+v.errors?.slice(0,5).join('；'));
  const checks=[],opening={role:'ai',scanIndex:0,text:v.opening,gameTime:core.parseGameTime(v.opening)?.iso||null};
  for(const entry of [opening,...v.messages.filter(x=>x.role==='ai'),...v.events]){
   const r=rows[entry.scanIndex],fs=r.formatSource,source=fs.nativeReply,event=r.eventType==='event';
   const result=core.compareNativeParagraphs(entry.text,source.text,{source:event?'whif-event-content':'whif-message-content',event,opening:entry.scanIndex===0,eventTitle:event?entry.title:undefined,chapterTitle:source.chapterTitle,statusText:fs.statusText,codeBlocks:fs.codeBlocks,verifiedUntimedNative:entry.verifiedUntimedNative===true});
   const ok=entry.text===source.scannedText&&result.text!==null&&result.comparison?.contentEqual===true&&result.comparison?.clockEqual===true;
   checks.push({check:{scanIndex:entry.scanIndex,reason:ok?(entry.text===result.text?'source-matched-no-change':'applied'):'content-or-clock-not-proven',source:ok?'whif-message-content':'rendered-dom',comparison:result.comparison}});
   if(ok)entry.text=result.text;
  }
  const audit=evidence.summarize(rows,checks,core,v.ok);
  const report={format:'gal-archive-offline-revalidation',version:1,scanRunId:run,cycleId:id,originalScannerVersion:version,coreVersion:core.version,rawRows:n,integrityOk:v.ok,bottomProof:bottom,sourceAuditOk:true,nativeFormatAudit:{checked:audit.checkedNativeRows,verified:audit.verifiedNativeRows,failed:audit.failedNativeRows,complete:audit.nativeFormatComplete},failedIndices:audit.failures.map(x=>x.scanIndex),warnings:v.warnings,importable:false,method:'saved-complete-source-audited-batch'};
  if(!audit.nativeFormatComplete)return {report,canonical:null};
  for(const {i,sources} of merged){
   const entry=v.messages.find(x=>x.scanIndex===i&&x.role==='me');
   assert(entry,'多來源玩家未出現在正式回合');
   entry.text=sources.map(s=>s.nativeText).join('\n\n');
   entry.nativeUserSegments=sources.map((s,position)=>({position,sourceIdHash:hash(s.id),text:s.nativeText}));
  }
  const path=url.origin+url.pathname,chatKey=(hash(path)+hash(path+'|Gal AI')).slice(0,32);
  const build=(entry,i,kind)=>{
   const sourceEventId='galnative-'+hash(path+'|'+i+'|'+kind);
   return {id:sourceEventId,role:entry.role,text:entry.text,gameTime:entry.gameTime||null,sourceEventId,sourcePartIndex:0,chatKey,messageOrder:entry.scanIndex,scanIndex:entry.scanIndex,sourceKind:'gal-ai-native',sourceSite:url.origin};
  };
  const messages=v.messages.map((m,i)=>{const row=build(m,i,'message');
   if(m.verifiedUntimedNative)row.nativeClockEvidence='verified-original-without-game-time';
   if(m.nativeUserSegments){row.nativeUserSegments=m.nativeUserSegments;row.nativeUserMergeVerified=true}
   return row;
  });
  v.messages.forEach((m,i)=>{if(m.autoContinue)messages[i].autoContinue={kind:'whif-adjacent-character-replies',previousSourceEventId:messages[i-1].sourceEventId}});
  const events=v.events.map(e=>({...build(e,e.scanIndex,'event'),role:'ai',status:'accepted',title:e.title,worldName:e.worldName||null}));
  assert(new Set([...messages,...events].map(x=>x.id)).size===n-1,'正式 ID 重複');
  const canonical={format:'gal-ai-authoritative-scan',version:1,generatedAt:new Date().toISOString(),scope:'entire-opening-to-bottom',source:{url:path,origin:url.origin,path:url.pathname,gameClockOnly:true},target:{...cp.target,uid:'',manager:'',managerNames:[]},opening:opening.text,messages,events,rawRows:n,scanRunId:run,scannerVersion:version,coreVersion:core.version,readOnlyUntilImported:true,
   validation:{ok:true,integrityOk:true,nativeFormatComplete:true,pairs:v.pairs,events:events.length,autoContinues:v.autoContinues,openingChars:opening.text.length,gameTimeCount:messages.filter(m=>!!m.gameTime).length,unknownGameTimeCount:v.unknownGameTimeCount||0,verifiedUntimedCount:v.verifiedUntimedCount||0,warnings:v.warnings,errors:[]},
   nativeFormatAudit:report.nativeFormatAudit,eventAudit:{...ev,complete:true,zeroEventAssessment:events.length?'not-zero':'no-accepted-event-in-observed-history'},offlineRecovery:{method:report.method,originalScannerVersion:version,originalFailure:cp.failedPhase,coreVersion:core.version,originalRun:run,liveRescan:false,sourceAuditReused:true,bottomProof:bottom},note:'由完整保全及同批次現場來源稽核離線重驗產出；並非重新實機掃描。匯入前仍須核對目標輪迴、預覽與備份。'};
  report.importable=true;
  return {report,canonical};
 }
 function mount(doc,host){
  const $=id=>doc.getElementById(id),modal=$('archiveReplayModal');
  if(!modal)return;
  let result=null,ticket=0;
  const fields=['archiveReplayRaw','archiveReplayDiag','archiveReplayState'];
  const status=t=>$('archiveReplayStatus').textContent=t;
  const clear=()=>{ticket++;result=null;$('archiveReplayDownload').disabled=true;$('archiveReplayReport').disabled=true;$('archiveReplayRun').disabled=false};
  const reset=()=>{clear();fields.forEach(id=>$(id).value='');status('選擇同一次掃描的三份 JSON；只在此瀏覽器處理，不匯入、不上傳。')};
  $('archiveReplayOpen').onclick=()=>{reset();modal.classList.remove('hidden')};
  $('archiveReplayClose').onclick=()=>{reset();modal.classList.add('hidden')};
  fields.forEach(id=>$(id).onchange=()=>{clear();status('檔案已變更，請重新驗收。')});
  $('archiveReplayRun').onclick=async()=>{
   clear();const t=ticket;$('archiveReplayRun').disabled=true;
   status('正在讀取並核對保全、診斷及狀態…');
   try{
    const files=fields.map(id=>$(id).files?.[0]);
    assert(files.every(Boolean),'請選齊三份 JSON');
    assert(files.every((f,i)=>f.size<=(i===0?100:20)*1024*1024),'檔案超過安全大小限制');
    const [cp,diag,state]=await Promise.all(files.map(async f=>JSON.parse(await f.text())));
    if(t!==ticket)return;
    result=replay(cp,diag,state,host.GalArchiveCore,host.GalArchiveFormatEvidence);
    const r=result.report;
    // Run the ordinary site's own import gate before enabling download.
    // Do not mutate current cycle or start an import here.
    if(result.canonical&&typeof host.galNativeVerify==='function'&&typeof host.current==='function'){
     const current=host.current();
     if(current?.id===cp.target.cycleId){
      const gate=host.galNativeVerify(result.canonical,current);
      assert(!gate.fail.length,'網站正式匯入檢查未通過：'+gate.fail.slice(0,4).join('；'));
     }
    }
    $('archiveReplayDownload').disabled=!result.canonical;
    $('archiveReplayReport').disabled=false;
    status((result.canonical?'✅ 離線驗收通過，可下載正式正史':'⛔ 格式仍有異常，不可匯入')+'\n輪迴：'+cp.target.cycleTitle+'\n原始版本：'+r.originalScannerVersion+' → 重驗核心：'+r.coreVersion+'\n完整資料：'+r.rawRows+' 筆\n原生格式：'+r.nativeFormatAudit.verified+'/'+r.nativeFormatAudit.checked+'\n警告：'+r.warnings.length+' 項\n'+(r.failedIndices.length?'異常索引：'+r.failedIndices.join('、')+'\n':'')+'不會修改本機正史或 Firebase。');
   }catch(e){if(t===ticket){result={canonical:null,report:{format:'gal-archive-offline-revalidation',importable:false,error:String(e.message||e)}};$('archiveReplayReport').disabled=false;status('⛔ '+String(e.message||e)+'\n原檔不變，禁止正式輸出。')}}
   finally{if(t===ticket)$('archiveReplayRun').disabled=false}
  };
  const download=(obj,name)=>{const a=doc.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  $('archiveReplayDownload').onclick=()=>{if(result?.canonical)download(result.canonical,'Gal_AI_離線重驗正史_'+result.canonical.target.cycleTitle+'.json')};
  $('archiveReplayReport').onclick=()=>{if(result?.report)download(result.report,'保全資料重驗診斷.json')};
 }
 return {replay,mount,hash};
});
