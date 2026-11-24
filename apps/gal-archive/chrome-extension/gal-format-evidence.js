/* Private, fail-closed local native-format audit. Never uploads story text. */
(function(root,factory){
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.GalArchiveFormatEvidence=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const verified=new Set(['applied','source-matched-no-change']);
 function markerPositions(value){
  const text=String(value||''),found=[];
  const expressions=[
   ['template',/\{\{[^{}\n]{1,300}\}\}/gu],
   ['chinese-open-quote',/「/gu],['chinese-close-quote',/」/gu],
   ['fence',/^[ \t]*\x60{3}[^\n]*/gm]
  ];
  for(const [kind,regexp] of expressions){
   for(const item of text.matchAll(regexp)){
    found.push({kind,utf16Offset:item.index,nonWhitespaceOffset:
     [...text.slice(0,item.index).replace(/\s/g,'')].length,
     utf16Length:item[0].length,
     nonWhitespaceLength:[...item[0].replace(/\s/g,'')].length});
   }
  }
  return found.sort((a,b)=>a.utf16Offset-b.utf16Offset);
 }
 function contextRow(rows,index){
  const row=rows[index],native=row?.formatSource?.nativeReply||{};
  return {scanIndex:index,role:row?.role||null,eventType:row?.eventType||null,
   domText:row?.text??null,
   nativeText:native.reason==='available'?native.text:null,
   sourceMessageId:native.messageId||null,
   originalGameTimeHeader:String(row?.text||'').split('\n').slice(0,12).join('\n')};
 }
 function evidence(rows,index,check,core){
  const row=rows[index],native=row?.formatSource?.nativeReply||{};
  return {scanIndex:index,role:row?.role||null,eventType:row?.eventType||null,
   reason:check?.reason||'not-validated',
   sourceMessageId:native.messageId||null,
   sourceMarkerCount:native.markerCount??null,
   sourceReason:native.reason||'native-source-unavailable',
   originalDomText:row?.text??null,
   originalNativeText:native.reason==='available'?native.text:null,
   nativeFormatMarkers:markerPositions(native.text),
   domFormatMarkers:markerPositions(row?.text),
   time:{scanned:core?.parseGameTime?.(row?.text||'')||null,
    native:core?.parseGameTime?.(native.text||'')||null},
   comparison:check?.comparison||null,
   neighborhood:rows.slice(Math.max(0,index-1),Math.min(rows.length,index+2))
    .map((_,offset)=>contextRow(rows,Math.max(0,index-1)+offset))};
 }
 function summarize(rows,checks,core,integrityOk){
  const found=new Map((checks||[]).map(x=>[x.check?.scanIndex,x.check]));
  const indices=rows.flatMap((row,i)=>row.role==='ai'?[i]:[]);
  const failures=indices.filter(i=>{
   const check=found.get(i);
   return !check||!verified.has(check.reason)||
     (check.source!=='whif-message-content'&&check.source!=='native-copy');
  }).map(i=>evidence(rows,i,found.get(i),core));
  const result={
   schemaVersion:1,integrityOk:integrityOk===true,
   nativeFormatComplete:failures.length===0&&indices.length===found.size,
   checkedNativeRows:indices.length,verifiedNativeRows:indices.length-failures.length,
   failedNativeRows:failures.length,failures,
   note:'掃描結構完整性與原生格式驗收彼此獨立。格式失敗保留完整DOM／原生文字供本機鑑識；此資料不可直接匯入正史。'
  };
  return result;
 }
 function inspectRaw(rows,core,integrityOk){
  const ids=new Map();
  for(const row of rows||[]){
   const id=row.formatSource?.nativeReply?.messageId;
   if(id)ids.set(id,(ids.get(id)||0)+1);
  }
  const checks=(rows||[]).flatMap((row,index)=>{
   if(row.role!=='ai')return [];
   const source=row.formatSource?.nativeReply;
   if(source?.reason!=='available'||!source.messageId||
      source.scannedText!==row.text||source.markerCount!==1||
      ids.get(source.messageId)!==1)
    return [{check:{scanIndex:index,reason:'original-source-not-unique-or-unavailable',
     source:'rendered-dom'}}];
   let compared=null;
   try{
    compared=core.compareNativeParagraphs(row.text,source.text,{
     source:row.eventType==='event'?'whif-event-content':'whif-message-content',
     event:row.eventType==='event',opening:index===0,
     eventTitle:row.eventType==='event'?String(row.text).split('\n')[0]:undefined,
     chapterTitle:source.chapterTitle,
     statusText:row.formatSource?.statusText,
     codeBlocks:row.formatSource?.codeBlocks,
     verifiedUntimedNative:index>0&&row.eventType!=='event'&&
      !core.parseGameTime(row.text)&&!core.parseGameTime(source.text)
    });
   }catch(error){
    return [{check:{scanIndex:index,reason:'native-format-compare-threw:'+String(error),
     source:'rendered-dom'}}];
   }
   const success=compared.text!==null&&compared.comparison?.contentEqual&&
    compared.comparison?.clockEqual;
   return [{check:{scanIndex:index,
    reason:success?(compared.text===row.text?'source-matched-no-change':'applied'):'content-or-clock-not-proven',
    source:success?'whif-message-content':'rendered-dom',
    comparison:compared.comparison}}];
  });
  const result=summarize(rows,checks,core,integrityOk);
  result.inspection='post-failure-saved-rows-replay';
  result.nativeFormatComplete=false;
  return result;
 }
 return {version:'0.8.46',markerPositions,evidence,summarize,inspectRaw};
});
