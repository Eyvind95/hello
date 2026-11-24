#!/usr/bin/env node
'use strict';
/**
 * Read-only offline replay of GalArchiveCore.validate() against an incomplete
 * V0.8.34/V0.8.35 checkpoint. Does NOT reproduce a WHIF page's actual
 * markerCount, DOM ancestry, codeBlocks or event audit; NOT an import approval.
 * Usage: node apps/gal-archive/tools/revalidate-checkpoint.js "checkpoint.json"
 */
const fs=require('node:fs');
const path=require('node:path');
require('../chrome-extension/gal-core.js');
const core=globalThis.GalArchiveCore;
const problem=1685,expectedEvents=[95,1567,1588,1599];
function replay(checkpoint){
 if(checkpoint?.format!=='gal-ai-incomplete-scan-checkpoint'||
    checkpoint.importable!==false||checkpoint.complete!==false||
    !Array.isArray(checkpoint.rows))throw Error('只能分析原始不可匯入的進度保全 JSON');
 const counts=new Map();
 for(const item of checkpoint.rows){
  if(item.sourceMessageId)counts.set(item.sourceMessageId,(counts.get(item.sourceMessageId)||0)+1);
 }
 const rows=checkpoint.rows.map((item,index)=>{
  if(item.scanIndex!==index)throw Error('scanIndex 不連續，保全資料可能損壞');
  const formatSource=item.nativeReason==='available'&&item.sourceMessageId&&
    typeof item.nativeText==='string'
   ?{nativeReply:{
      reason:'available',
      // ASSUMPTION for offline replay, NOT live markerCount proof.
      markerCount:counts.get(item.sourceMessageId)===1?1:0,
      messageId:item.sourceMessageId,
      scannedText:item.text,text:item.nativeText
    }}:undefined;
  return {role:item.role,text:item.text,eventType:item.eventType||null,
   worldName:item.worldName||null,autoContinue:item.autoContinue===true,
   formatSource};
 });
 if(rows.length<=problem)throw Error('沒有 scanIndex 1685');
 if(rows[problem].role!=='ai'||rows[problem].eventType)throw Error('1685 不是普通 AI 回覆，拒絕重驗');
 const id=checkpoint.rows[problem].sourceMessageId;
 if(!id||counts.get(id)!==1)throw Error('1685 原生來源 ID 不唯一或不存在');
 const validated=core.validate(rows,checkpoint.target?.worldName||null);
 const target=validated.messages.find(row=>row.scanIndex===problem);
 const events=validated.events.map(event=>event.scanIndex);
 const report={
  format:'gal-ai-offline-replay-only',
  scannerCore:core.version,
  scanRunId:checkpoint.scanRunId||null,
  cycleId:checkpoint.target?.cycleId||null,
  collectedRows:rows.length,
  continuousIndices:true,
  validationOkOffline:validated.ok,
  errorCount:validated.errors.length,
  errors:validated.errors.slice(0,12),
  warningsCount:validated.warnings.length,
  ordinaryPairs:validated.pairs,
  autoContinues:validated.autoContinues,
  unknownGameTimeCount:validated.unknownGameTimeCount,
  verifiedUntimedCount:validated.verifiedUntimedCount,
  problem1685:{
   sourceIdUnique:true,
   retainedInValidation:Boolean(target),
   gameTime:target?.gameTime??null,
   sourceVerifiedUntimedNative:target?.verifiedUntimedNative===true,
   nextRowRole:rows[1686]?.role||null
  },
  eventScanIndices:events,
  expectedEvents:expectedEvents.map(index=>({scanIndex:index,
   recognizedAsEvent:events.includes(index),
   sourceIdUnique:!!checkpoint.rows[index]?.sourceMessageId&&
    counts.get(checkpoint.rows[index].sourceMessageId)===1})),
  importable:false,
  limitations:'保全檔沒有現場 markerCount、DOM 來源界線、格式 metadata 及完整 eventAudit；此結果只驗證保存的文字和配對演算法，不是即時 WHIF 完整驗收，不得匯入正式正史。'
 };
 return report;
}
if(require.main===module){
 try{
  if(!process.argv[2])throw Error('請提供完整保全 JSON 路徑');
  const file=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  process.stdout.write(JSON.stringify(replay(file),null,2)+'\n');
 }catch(error){console.error('離線重驗失敗：'+error.message);process.exitCode=1;}
}
module.exports={replay};
