#!/usr/bin/env node
'use strict';
// Offline, read-only revalidation of V0.8.38 failed full-scan evidence.
// Never outputs story text, creates a canonical file, or claims live WHIF proof.
// Usage: node revalidate-cycle9-v038.js "unverified-scan.json" > "offline-report.json"
const fs=require('node:fs');
require('../chrome-extension/gal-core.js');
const core=globalThis.GalArchiveCore;
const RUN='d0a712ef-6aed-4cb8-bb01-fcbda007f60a';
function replay(file){
 if(!file||file.format!=='gal-ai-unverified-scan'||file.version!==1||
  file.importable!==false||file.complete!==false||file.validated!==false||
  file.scannerVersion!=='0.8.38'||file.scanRunId!==RUN)
  throw Error('必須提供第9周目指定工作 V0.8.38 的原始未驗證掃描檔');
 if(!Array.isArray(file.rows)||file.rows.length!==382||file.collectedCount!==382)
  throw Error('缺少完整382筆或保全檔筆數與聲明不一致');
 const aiIds=[],playerIds=[];
 const rows=file.rows.map((r,i)=>{
  if(r.scanIndex!==i||!['ai','me'].includes(r.role)||typeof r.domText!=='string'||
   !r.domText.trim())throw Error('第 '+i+' 則索引/角色/文字損壞');
  const native=r.formatSource?.nativeReply;
  if(r.role==='ai'){
   if(!native||native.reason!=='available'||native.markerCount!==1||
      !native.messageId||native.scannedText!==r.domText||
      typeof native.text!=='string'||!native.text.trim())
    throw Error('第 '+i+' 則 AI 原生來源缺失或不唯一');
   if(native.messageId!==r.sourceMessageId||r.nativeText!==native.text)
    throw Error('第 '+i+' 則 AI 保全來源欄位互相不一致');
   aiIds.push(native.messageId);
  }else{
   for(const u of r.playerSources||[]){
    if(u.id)playerIds.push(u.id);
   }
  }
  return {role:r.role,text:r.domText,eventType:r.eventType||null,
   worldName:r.worldName||null,autoContinue:r.autoContinue===true,
   formatSource:r.formatSource||undefined};
 });
 if(new Set(aiIds).size!==aiIds.length)throw Error('原生 AI ID 重複');
 if(new Set(playerIds).size!==playerIds.length)throw Error('原生玩家 ID 重複');
 if(aiIds.some(id=>playerIds.includes(id)))throw Error('AI 與玩家共用原生 ID');
 if(rows[229].role!=='ai'||rows[229].eventType)throw Error('scanIndex 229 非普通 AI');
 const result=core.validate(rows,file.target?.worldName||null);
 const cmp=i=>{
  const r=rows[i],original=r.formatSource?.nativeReply?.text;
  if(r.role!=='ai'||!original)return null;
  const c=core.compareNativeParagraphs(r.text,original,{
   source:r.eventType==='event'?'whif-event-content':'whif-message-content',
   event:r.eventType==='event',verifiedUntimedNative:!core.parseGameTime(r.text),
   chapterTitle:r.formatSource?.nativeReply?.chapterTitle,
   statusText:r.formatSource?.statusText,
   codeBlocks:r.formatSource?.codeBlocks||[]
  });
  return {index:i,contentEqual:c.comparison.contentEqual,clockEqual:c.comparison.clockEqual,
   noTime:c.comparison.verifiedNoClock,
   projectedNativeQuotePairs:c.comparison.untimedCombinedProjection?.omittedQuotePairs??null,
   formatMarkers:c.comparison.formatMarkers.map(x=>x.kind),
   scannedNonWhitespace:c.comparison.scannedNonWhitespace,
   originalNonWhitespace:c.comparison.nativeNonWhitespace,
   remainingUnexplained:c.comparison.remainingUnexplained,
   preservedOriginalParagraphs:!!c.text&&c.text.includes('\n\n')};
 };
 const reply229=result.messages.find(x=>x.scanIndex===229);
 const reply230=result.messages.find(x=>x.scanIndex===230);
 const events=result.events.map(x=>x.scanIndex);
 const report={
  format:'gal-ai-v038-cycle9-offline-forensic-replay',importable:false,
  scannerCore:core.version,scanRunId:RUN,rawRows:rows.length,
  allAiNativeIdsUnique:true,aiNativeIdCount:aiIds.length,
  observedPlayerNativeIds:playerIds.length,playerNativeIdsUnique:true,
  validatedOffline:result.ok,errors:result.errors,
  pairs:result.pairs,events:events.length,eventIndices:events,
  verifiedUntimedCount:result.verifiedUntimedCount,
  index229:cmp(229),index341:cmp(341),
  index229Reconciled:!!reply229&&reply229.verifiedUntimedNative===true&&reply229.gameTime===null,
  index230PlayerPreserved:rows[230].role==='me',
  note:'僅以已保存的DOM與React文字重新驗證，無法重新確認現場 markerCount/頁尾。不得直接當成正式正史或Firebase資料。'
 };
 return report;
}
if(require.main===module){
 try{
  const input=process.argv[2];
  if(!input)throw Error('請提供 V0.8.38 未驗證掃描 JSON 路徑');
  const r=replay(JSON.parse(fs.readFileSync(input,'utf8')));
  console.log(JSON.stringify(r,null,2));
  if(!r.validatedOffline||!r.index229Reconciled||r.events!==4||
     !r.index229?.contentEqual||!r.index229?.clockEqual)process.exitCode=2;
 }catch(e){console.error('第9周目離線重驗拒絕：'+e.message);process.exitCode=1}
}
module.exports={replay};
