#!/usr/bin/env node
'use strict';
/*
 * STRICT OFFLINE EXPLORATION ONLY.
 * Model how WHIF may hide templates/fence delimiters/image tokens in one
 * UNTImED AI reply. Never produce an importable archive or apply changes.
 * The source row's unique ID and full UI metadata must STILL be validated
 * in the live scanner before any safe parser change can be released.
 *
 * Usage: node apps/gal-archive/tools/inspect-1685-projections.js
 *   "Gal_AI_未完成掃描保全_第5輪迴_....json" [--context]
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const IDX=1685;
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex').slice(0,12);
const norm=x=>String(x||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
const compact=x=>[...norm(x).replace(/\s/gu,'')];
const imageTail=/(?:[ \t]*\n)?\{\{(?:img|image):+[^{}\n]+\}\}[ \t]*$/i;
const template=/\{\{([^{}]{1,1000})\}\}/gu;
const fence=/^[ \t]*\x60{3}([^\n]*)\n([\s\S]*?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/gm;
const unsafe=/^(?:user|char|character|img(?:age)?\s*:|[\w.-]+\s*:\/{2})/i;
const quoteChars=new Set(['「','」']);
function difference(a,b){
 const x=compact(a),y=compact(b);let prefix=0;
 while(prefix<x.length&&prefix<y.length&&x[prefix]===y[prefix])prefix++;
 let suffix=0;
 while(suffix<x.length-prefix&&suffix<y.length-prefix&&x.at(-1-suffix)===y.at(-1-suffix))suffix++;
 const cp=char=>char?'U+'+char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'):null;
 return {prefix,suffix,unexplainedDom:x.length-prefix-suffix,unexplainedNative:y.length-prefix-suffix,
  domCodePoint:cp(x[prefix]),nativeCodePoint:cp(y[prefix]),
  domContext:x.slice(Math.max(0,prefix-12),prefix+18).join(''),
  nativeContext:y.slice(Math.max(0,prefix-12),prefix+18).join('')};
}
function quoteProjection(candidate,dom){
 const x=compact(dom),y=compact(candidate),omitted=[],unexplained=[];
 let j=0;
 for(let i=0;i<y.length;i++){
  if(j<x.length&&x[j]===y[i]){j++;continue}
  if(quoteChars.has(y[i])){omitted.push(y[i]);continue}
  unexplained.push(y[i]);
  return {pass:false,omitted:omitted.length,matched:j,reason:'non-quote-difference'};
 }
 if(j!==x.length)return {pass:false,omitted:omitted.length,matched:j,reason:'dom-has-extra-text'};
 let balance=0;
 for(const mark of omitted){
  balance+=mark==='「'?1:-1;
  if(balance<0)return {pass:false,omitted:omitted.length,matched:j,reason:'unbalanced-quote-order'};
 }
 return {pass:balance===0,omitted:omitted.length,matched:j,
  reason:balance===0?'exact-with-balanced-hidden-quotes':'unbalanced-quotes'};
}
function variants(native){
 const states=[{value:norm(native),operations:[]}],seen=new Set();
 const output=[];
 function enqueue(value,ops){
  const key=value+'|'+ops.length;
  if(seen.has(key))return;
  seen.add(key);states.push({value,operations:ops});
 }
 // Each branch removes only syntactically identified display-wrapper tokens.
 // The whole visible message must match exactly to count as a possible proof.
 while(states.length&&output.length<240){
  const state=states.shift(),v=state.value,ops=state.operations;
  output.push(state);
  if(ops.length>=5)continue;
  if(imageTail.test(v))enqueue(v.replace(imageTail,'').trimEnd(),
   [...ops,{kind:'terminal-image-token'}]);
  const matches=[...v.matchAll(template)].filter(m=>!unsafe.test(m[1].trim()));
  const templateUsed=ops.filter(o=>o.kind==='hidden-template').length;
  if(templateUsed<2){
   for(const m of matches.slice(0,3))enqueue(v.slice(0,m.index)+v.slice(m.index+m[0].length),
    [...ops,{kind:'hidden-template',position:m.index,labelHash:hash(m[1]),characters:m[0].length}]);
  }
  const already=ops.filter(o=>o.kind.startsWith('code-fence')).length;
  if(already<2){
   for(const m of [...v.matchAll(fence)].slice(0,2)){
    const head=m[1].trim(),body=m[2],start=m.index,end=start+m[0].length;
    if(head&&!/^[a-z][\w+.-]*$/i.test(head)){
      // A visible non-language header MAY be part of the rendered text.
      enqueue(v.slice(0,start)+head+'\n'+body+v.slice(end),
       [...ops,{kind:'code-fence-keep-header',position:start,headerHash:hash(head)}]);
    }
    enqueue(v.slice(0,start)+body+v.slice(end),
     [...ops,{kind:'code-fence-body-only',position:start,headerHash:head?hash(head):null}]);
   }
  }
 }
 return output;
}
function analyze(data){
 if(data?.format!=='gal-ai-incomplete-scan-checkpoint'||data.importable!==false||data.complete!==false)
  throw Error('需要不可匯入的 V0.8.34 原始保全檔');
 const rows=data.rows;
 if(!Array.isArray(rows)||rows.length<=IDX)throw Error('缺少 scanIndex 1685');
 const row=rows[IDX];
 if(row.scanIndex!==IDX||row.role!=='ai'||row.eventType)
  throw Error('scanIndex 1685 角色／事件類型不正確，拒絕猜測');
 if(row.nativeReason!=='available'||typeof row.nativeText!=='string'||!row.sourceMessageId)
  throw Error('缺少可識別的原生來源');
 if(rows.filter(x=>x.sourceMessageId===row.sourceMessageId).length!==1)
  throw Error('原生來源 ID 不唯一');
 const source=norm(row.nativeText),display=norm(row.text);
 const all=variants(source).map(state=>{
  const d=difference(display,state.value),quote=quoteProjection(state.value,display);
  const exact=compact(display).join('')===compact(state.value).join('');
  return {ops:state.operations,exact,quote,check:d};
 });
 const best=all.sort((a,b)=>Number(b.exact||b.quote.pass)-Number(a.exact||a.quote.pass)||
  b.check.prefix-a.check.prefix||
  a.check.unexplainedDom+a.check.unexplainedNative-b.check.unexplainedDom-b.check.unexplainedNative);
 const selected=best.slice(0,8).map(x=>({
  operations:x.ops,exactNonWhitespaceMatch:x.exact,
  exactMatchAfterBalancedQuoteProjection:x.quote.pass,
  hiddenQuoteCharacters:x.quote.omitted,
  commonPrefix:x.check.prefix,commonSuffix:x.check.suffix,
  unexplainedDom:x.check.unexplainedDom,unexplainedNative:x.check.unexplainedNative,
  firstMismatchDomCodePoint:x.check.domCodePoint,
  firstMismatchNativeCodePoint:x.check.nativeCodePoint,
  _privateContext:{dom:x.check.domContext,native:x.check.nativeContext}
 }));
 const fully=best.filter(x=>x.exact||x.quote.pass);
 return {format:'gal-ai-untimed-1685-projection-diagnostic',scanRunId:data.scanRunId,
  scanIndex:IDX,sourceIdHash:hash(row.sourceMessageId),
  domUtf16:display.length,nativeUtf16:source.length,
  domHasClock:/\d{4}\s*年\s*\d{1,2}\s*月/.test(display),
  nativeHasClock:/\d{4}\s*年\s*\d{1,2}\s*月/.test(source),
  original:difference(display,source),
  rawStructure:{
   hiddenTemplateCount:[...source.matchAll(template)].filter(m=>!unsafe.test(m[1].trim())).length,
   hiddenTemplatePositions:[...source.matchAll(template)].filter(m=>!unsafe.test(m[1].trim())).map(m=>m.index),
   fenceBlockCount:[...source.matchAll(fence)].length,
   terminalImageMarker:imageTail.test(source),
   nativeLeadingCodePoint:source[0]?.codePointAt(0).toString(16)||null
  },
  candidatesTested:all.length,exactCandidateCount:fully.length,
  candidates:selected,
  warning:'僅供離線找出確切格式差異，未驗證當時 DOM codeBlocks/statusText/chapterTitle；即使 exact=true 仍不得跳過來源驗證、重新簽發正史或填入假時間。'};
}
function redact(report,showContext){
 const data=JSON.parse(JSON.stringify(report));
 if(!showContext){
  delete data.original.domContext;delete data.original.nativeContext;
  for(const c of data.candidates)delete c._privateContext;
 }else{
  for(const c of data.candidates){c.context=c._privateContext;delete c._privateContext;}
 }
 return data;
}
if(require.main===module){
 try{
  if(!process.argv[2])throw Error('用法：node inspect-1685-projections.js "保全.json" [--context]');
  const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const report=analyze(data);
  process.stdout.write(JSON.stringify(redact(report,process.argv.includes('--context')),null,2)+'\n');
 }catch(error){console.error('診斷失敗：'+error.message);process.exitCode=1;}
}
module.exports={analyze,redact,difference,quoteProjection,variants};
