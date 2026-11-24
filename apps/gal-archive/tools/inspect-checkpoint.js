#!/usr/bin/env node
'use strict';
/*
 * Read-only forensic audit of a V0.8.34 incomplete scan checkpoint.
 * No WHIF navigation, Firebase writes, or import-file generation.
 * Usage: node apps/gal-archive/tools/inspect-checkpoint.js "checkpoint.json" ["diagnostic.json"]
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
require('../chrome-extension/gal-core.js');
const core=globalThis.GalArchiveCore;
const wantedEvents=[95,1567,1588,1599];
const failedAi=1685,followingPlayer=1686;
const sha=id=>id?crypto.createHash('sha256').update(String(id)).digest('hex').slice(0,12):null;
const cpLen=value=>[...String(value||'')].length;
const noSpace=value=>[...String(value||'').replace(/\s/gu,'')];
const short=value=>String(value||'').replace(/\r/g,'\\r').replace(/\n/g,'\\n').slice(0,110);
function diff(a,b){
 const x=noSpace(a),y=noSpace(b);
 let start=0;
 while(start<x.length&&start<y.length&&x[start]===y[start])start++;
 let suffix=0;
 while(suffix<x.length-start&&suffix<y.length-start&&x[x.length-1-suffix]===y[y.length-1-suffix])suffix++;
 const view=seq=>seq.slice(Math.max(0,start-18),start+26).join('');
 const codepoint=c=>c?'U+'+c.codePointAt(0).toString(16).toUpperCase():null;
 return {firstMismatchNonWhitespaceOffsetZeroBased:start,
  scannedNonWhitespace:x.length,nativeNonWhitespace:y.length,
  commonSuffix:suffix,unexplainedScanned:x.length-start-suffix,
  unexplainedNative:y.length-start-suffix,
  scannedWindow:short(view(x)),nativeWindow:short(view(y)),
  firstScannedCodePoint:codepoint(x[start]),firstNativeCodePoint:codepoint(y[start])};
}
function inspect(file,diagnosticFile){
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 if(input.format!=='gal-ai-incomplete-scan-checkpoint'||input.importable!==false||
    input.complete!==false||!Array.isArray(input.rows))
  throw Error('拒絕分析：不是明確標記為不可匯入的 V0.8.34 進度保全格式');
 const rows=input.rows;
 if(rows.length<=followingPlayer)throw Error('保全檔尚未包含第 1686 筆（0 起算）');
 const ids=new Map();
 for(const row of rows){
  const id=row.sourceMessageId;
  if(id)ids.set(id,(ids.get(id)||0)+1);
 }
 const eventPositions=rows.filter(row=>row.role==='ai'&&row.eventType==='event').map(row=>row.scanIndex);
 const eventEvidence=wantedEvents.map(index=>{
  const row=rows[index],id=row?.sourceMessageId;
  return {scanIndex:index,exists:!!row,role:row?.role||null,
   eventType:row?.eventType||null,sourceIdSha256Prefix:sha(id),
   sourceIdOccurrences:id?ids.get(id):0,
   nativeReason:row?.nativeReason||null,nativePresent:typeof row?.nativeText==='string'&&row.nativeText.length>0,
   nativeHasGameTime:core.parseGameTime(row?.nativeText)?.civil||null,
   domHasGameTime:core.parseGameTime(row?.text)?.civil||null};
 });
 const row=rows[failedAi],next=rows[followingPlayer];
 const native=typeof row.nativeText==='string'?row.nativeText:'';
 const rendered=String(row.text||'');
 const result=native?core.compareNativeParagraphs(rendered,native,
  {source:'whif-message-content',verifiedUntimedNative:true}):null;
 const rawDiff=diff(rendered,native);
 const c=result?.comparison||{};
 const ai={scanIndex:failedAi,displayedNumberOneBased:failedAi+1,
  role:row.role,eventType:row.eventType||null,
  nativeReason:row.nativeReason,
  sourceIdSha256Prefix:sha(row.sourceMessageId),
  sourceIdOccurrences:row.sourceMessageId?ids.get(row.sourceMessageId):0,
  domUtf16Length:rendered.length,nativeUtf16Length:native.length,
  domCodePoints:cpLen(rendered),nativeCodePoints:cpLen(native),
  domClock:core.parseGameTime(rendered)?.civil||null,
  nativeClock:core.parseGameTime(native)?.civil||null,
  domExplicitUnknown:core.isExplicitUnknownGameTime(rendered),
  nativeExplicitUnknown:core.isExplicitUnknownGameTime(native),
  nativeStartsWithHiddenTemplate:/^\s*\{\{[^{}]{1,200}\}\}/u.test(native),
  nativeContainsCodeFence:/^\s*\x60{3}/m.test(native),
  comparison:{
   contentEqual:c.contentEqual??null,clockEqual:c.clockEqual??null,
   firstDifference:c.firstDifference||null,
   remainingUnexplained:c.remainingUnexplained||null,
   ignoredDifferences:c.ignoredDifferences||null,
   formatMarkers:c.formatMarkers||[],
   features:c.features||null,
   legacyProjectionTrace:c.legacyProjectionTrace||null,
   exactNativeProjectionAccepted:result?.text!==null
  },
  rawNonWhitespaceDiff:rawDiff,
  note:'保全檔未保存全部現場格式 metadata，因此離線比較是診斷，不代表掃描器可直接驗收；禁止因比較通過而跳過來源證據。'
 };
 const nextInfo={scanIndex:followingPlayer,displayedNumberOneBased:followingPlayer+1,
  role:next.role,eventType:next.eventType||null,
  domUtf16Length:String(next.text||'').length,
  sourceIdSha256Prefix:sha(next.sourceMessageId),
  sourceIdOccurrences:next.sourceMessageId?ids.get(next.sourceMessageId):0};
 const report={format:'gal-ai-checkpoint-forensic-audit',
  inspectedAt:new Date().toISOString(),inputFile:path.basename(file),
  scanRunId:input.scanRunId||null,cycleId:input.target?.cycleId||null,
  sourceUrl:input.source?.url||null,checkpointImportable:input.importable,
  retainedRows:rows.length,allObservedEventPositions:eventPositions,
  requiredEventEvidence:eventEvidence,failedAi:ai,followingPlayer:nextInfo};
 if(diagnosticFile){
  const diagnostic=JSON.parse(fs.readFileSync(diagnosticFile,'utf8'));
  const candidates=diagnostic.eventAudit?.nativeCandidates||[];
  const headers=diagnostic.eventAudit?.headers||[];
  report.eventCrossCheck=wantedEvents.map(index=>{
   const c=candidates.find(x=>x.scanIndex===index);
   const h=headers.find(x=>x.scanIndex===index);
   const checkpoint=eventEvidence.find(x=>x.scanIndex===index);
   return {
    scanIndex:index,checkpointIsEvent:checkpoint?.role==='ai'&&checkpoint.eventType==='event',
    nativeSourcePresent:checkpoint?.nativePresent===true,
    sourceIdUnique:checkpoint?.sourceIdOccurrences===1,
    diagnosticCandidateFound:!!c,diagnosticAccepted:c?.accepted??null,
    diagnosticKind:c?.kind||null,diagnosticReason:c?.reason||null,
    headerFound:!!h,headerReason:h?.reason||null,
    provisionalClassificationConfirmed:!!(c&&c.accepted===true&&checkpoint?.role==='ai'&&
      checkpoint.eventType==='event'&&checkpoint.nativePresent&&checkpoint.sourceIdOccurrences===1)
   };
  });
  report.originalDiagnostic={
   scannerVersion:diagnostic.version||diagnostic.scannerVersion||null,
   trustedCount:diagnostic.trustedCount??null,
   bottomProof:diagnostic.bottomProof||null,
   unresolvedAccepted:diagnostic.eventAudit?.unresolvedAccepted??null,
   unresolvedHeaders:diagnostic.eventAudit?.unresolvedHeaders??null,
   eventAuditComplete:diagnostic.eventAudit?.complete??null,
   note:'原版 failed 診斷的 eventAudit 用空白 validation 重算；不能單憑 unresolvedAccepted 推斷已接取事件遺失。'
  };
 }
 return report;
}
if(require.main===module){
 try{
  if(!process.argv[2])throw Error('使用方式：node inspect-checkpoint.js "保全.json" ["掃描診斷.json"]');
  const report=inspect(process.argv[2],process.argv[3]);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
 }catch(error){console.error('掃描檢驗失敗：'+error.message);process.exitCode=1;}
}
module.exports={inspect,diff};
