'use strict';
// Offline review only. No website storage, Firebase, network or ordinary importer adapter.
const crypto=require('node:crypto');
const native=require('./chrome-extension/predecessor-chat-core.js');
const FORMAT='gal-predecessor-archaeology-preview', VERSION=3;
const SECTIONS=['pilotMessages','quizLogs','casinoLogs','realChatLogs','rejectedEvents','easterEggs'];
const JOINED='gal-predecessor-prefix-supplement-evidence';
const HEX=/^[a-f0-9]{64}$/;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.trim().length>0;
const check=(v,m)=>{if(!v)throw Error(m)};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=(...parts)=>JSON.stringify(parts);
const withoutIndex=({index,...r})=>r;
const unresolved=r=>r.identityBasis==='unresolved-native-composite'||r.id.startsWith('assistant|composite:')||r.compositeNative!==undefined||r.compositeHtml!==undefined;
function readOriginal(bytes,expected){
 check(Buffer.isBuffer(bytes)&&HEX.test(expected)&&digest(bytes)===expected,'原件 bytes 或 SHA-256 不符');
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/^\uFEFF/,''))}catch{throw Error('原件 JSON 或 UTF-8 無效')}
 check(obj(data)&&data.version===1&&str(data.chatId)&&str(data.runId),'原件聊天身分錯誤');
 return data;
}
function rowsOf(rows,count){
 check(Array.isArray(rows)&&Number.isSafeInteger(count)&&count>0&&rows.length===count,'來源筆數不符');
 check(rows.every((r,i)=>obj(r)&&r.index===i),'來源索引不符');
 native.validateRows(rows);
 return rows;
}
function sourceView(data,originals){
 const local=rowsOf(data.rows,data.count);
 if(data.format==='gal-predecessor-chat'&&data.status==='completed'){
  check(data.evidence?.topReached===true&&data.evidence?.bottomReached===true&&data.evidence?.continuity===true,'完成檔缺少上下端或連續性證據');
  return {rows:local,warnings:['rendered-branch-only'],basis:'completed-display'};
 }
 check(data.format===JOINED&&['joined-observed-prefix','joined-evidence'].includes(data.status)&&data.canonical===false&&data.importable===false&&data.continuity===false&&data.fidelity==='rendered-dom'&&data.error===null,'不允許的來源證據類型');
 const e=data.evidence,b=data.base;
 check(obj(e)&&obj(b)&&HEX.test(b.sha256)&&e.originalCheckpointUnchanged===true&&e.lastConflict===null,'接合證據不足');
 const observed=data.status==='joined-observed-prefix';
 check(observed?e.observedTopVerified===true&&e.openingVerified===false&&e.openingBasis==='observed-top-only'&&e.observedFirstId===local[0].id:e.openingVerified===true&&e.expectedId===local[0].id,'開頭證據狀態不符');
 check(local[0].role==='user','開頭角色不符');
 const original=originals.get(b.sha256);
 check(original&&original.chatId===data.chatId&&original.runId===b.runId&&original.count===b.count,'缺少實際原保全或基準身分不符');
 check(['gal-predecessor-chat','gal-predecessor-offline-reconciliation-candidate'].includes(original.format),'原保全格式未支援');
 const base=rowsOf(original.rows,b.count);
 check(base[0].id===b.firstId&&Number.isSafeInteger(e.added)&&Number.isSafeInteger(e.matched)&&e.added>=1&&e.matched>=2&&e.matched<=base.length&&local.length===e.added+e.matched,'接合筆數或前沿不符');
 const c=rowsOf(data.candidateRows,e.joinedCandidateCount);
 check(c.length===e.added+base.length,'接合候選總數不符');
 // Reconstruct exactly from observed prefix and independently supplied base.
 // Comparison follows the scanner's limited comparison rule for overlap only.
 for(let i=0;i<e.matched;i++){
  check(native.compareRow(withoutIndex(base[i]),withoutIndex(local[e.added+i])).equal,'原保全重疊正文、角色或格式不符');
 }
 const reconstructed=[...local.slice(0,e.added),...base];
 check(c.every((r,i)=>same(withoutIndex(r),withoutIndex(reconstructed[i]))),'候選並非原前綴及原保全的精確接合');
 return {rows:c,basis:observed?'observed-prefix-join':'specified-opening-join',warnings:['rendered-branch-only',...(observed?['true-opening-unverified']:[])],baseSha256:b.sha256};
}
const markers=/(?:^|\n)[ \t]*(?:[（(][ \t]*)?(我|他)[ \t]*[：:][ \t]*(?:[）)])?/gu;
const splitPair=(s,i)=>i>0&&i<s.length&&/[\uD800-\uDBFF]/.test(s[i-1])&&/[\uDC00-\uDFFF]/.test(s[i]);
function exactSpan(row,f){
 check(obj(f)&&Number.isSafeInteger(f.start)&&Number.isSafeInteger(f.end)&&f.start>=0&&f.end>f.start&&f.end<=row.text.length&&!splitPair(row.text,f.start)&&!splitPair(row.text,f.end)&&str(f.text)&&row.text.slice(f.start,f.end)===f.text,'片段偏移、Unicode 邊界或原文不符');
 return {start:f.start,end:f.end,text:f.text};
}
function roleBlock(row,f){
 const hits=[...row.text.matchAll(markers)];
 if(hits.some(m=>f.start<m.index+m[0].length&&f.end>m.index))throw Error('片段不得跨越劇情標記');
 const last=hits.filter(m=>m.index+m[0].length<=f.start).at(-1);
 return last?(last[1]==='我'?'gal-player-input':'gal-ai-output'):'prefix';
}
function binding(target){
 check(obj(target)&&['worldKey','cycleId','cycleTitle'].every(k=>str(target[k])),'缺少完整輪迴綁定');
 return [target.worldKey,target.cycleId,target.cycleTitle];
}
function reviewKey(target,manager,section,ref,f,context){
 return key(...binding(target),manager,section,ref.sha256,ref.chatId,ref.sourceId,ref.sourceIndex,f.start,f.end,f.kind,context);
}
// review is supplied by the trusted offline operator, not inside the candidate.
// This module cannot establish that a reviewer actually understood the text.
function preview({originals,review,candidate}){
 check(obj(candidate)&&candidate.format===FORMAT&&candidate.version===VERSION&&str(candidate.manager)&&Array.isArray(candidate.targets),'考古預覽格式不符');
 check(obj(review)&&Array.isArray(review.sources)&&Array.isArray(review.fragments)&&Array.isArray(review.targets),'缺少獨立審查清冊');
 check(Array.isArray(originals),'缺少原始位元組');
 const data=new Map();
 for(const a of originals){check(obj(a)&&!data.has(a.sha256),'原件重複');data.set(a.sha256,readOriginal(a.bytes,a.sha256))}
 const approved=new Map(),views=new Map(),chats=new Set();
 for(const a of review.sources){
  check(obj(a)&&HEX.test(a.sha256)&&str(a.chatId)&&str(a.runId)&&str(a.reviewId)&&!approved.has(a.sha256),'來源核定清冊異常');
  const raw=data.get(a.sha256);check(raw&&raw.chatId===a.chatId&&raw.runId===a.runId&&raw.status===a.status,'來源核定身分不符');
  const view=sourceView(raw,data);
  check(view.rows.length===a.count&&!chats.has(raw.chatId),'核定筆數或重複聊天身分不符');
  approved.set(a.sha256,a);chats.add(raw.chatId);views.set(a.sha256,{...view,raw,map:new Map(view.rows.map(r=>[r.id,r]))});
 }
 check(approved.size>0,'未核定任何來源');
 const sourceOrder=new Map(review.sources.map((a,i)=>[a.sha256,i]));
 const targets=new Set(review.targets.map(t=>key(...binding(t))));
 check(targets.size===review.targets.length,'輪迴核定重複');
 const reviews=new Map();
 for(const a of review.fragments){
  check(obj(a)&&str(a.key)&&str(a.reviewId)&&str(a.reason)&&!reviews.has(a.key),'片段審查清冊異常');reviews.set(a.key,a);
 }
 function locate(ref){
  check(obj(ref)&&approved.has(ref.sha256),'片段未引用核定原件');
  const v=views.get(ref.sha256),r=v.map.get(ref.sourceId);
  check(v.raw.chatId===ref.chatId&&r&&r.index===ref.sourceIndex&&!unresolved(r),'來源 ID、索引或隔離身分不符');
  return {v,r};
 }
 const seenTargets=new Set(),out=[];
 for(const t of candidate.targets){
  const tk=key(...binding(t.target));check(targets.has(tk)&&!seenTargets.has(tk),'未核定或重複輪迴');seenTargets.add(tk);
  check(SECTIONS.every(s=>Array.isArray(t[s])),'必須提供六分頁');
  const result={target:t.target};
  for(const section of SECTIONS){
   let lastOrder=-1,lastIndex=-1;const seen=new Set();
   result[section]=t[section].map(entry=>{
    check(obj(entry)&&Array.isArray(entry.fragments)&&entry.fragments.length>0,'缺少獨立原文片段');
    const {v,r}=locate(entry),order=sourceOrder.get(entry.sha256),identity=key(entry.chatId,entry.sourceId);
    check(!seen.has(identity)&&(order>lastOrder||(order===lastOrder&&r.index>lastIndex)),'同分頁重複來源或來源順序錯誤');
    seen.add(identity);lastOrder=order;lastIndex=r.index;
    let end=-1;
    const fragments=entry.fragments.map(f=>{
     const span=exactSpan(r,f);
     check(span.start>=end,'片段重疊或逆序');end=span.end;
     check(['commentary','player-correction','player-annotation','quotation','event-evidence','quiz-evidence','casino-evidence','real-chat','egg-evidence'].includes(f.kind),'不允許的片段類型');
     let context='source';
     if(section==='pilotMessages'&&r.role==='user'){
      const block=roleBlock(r,f);
      check(['commentary','player-correction','player-annotation'].includes(f.kind),'玩家劇情不得匯入副駕駛');
      if(f.kind==='player-correction'||f.kind==='player-annotation'){
       check(block!=='gal-ai-output','Gal AI 輸出不可冒充玩家修正');context=block;
      }else context=block==='prefix'?'prefix':'reviewed-outside-story';
     }else if(f.kind==='player-correction'||f.kind==='player-annotation')check(r.role==='user','非玩家來源不能標為玩家修正');
     if(section==='pilotMessages'&&r.role==='user'&&(context!=='prefix'||f.kind!=='commentary')){
      const a=reviews.get(reviewKey(t.target,candidate.manager,section,entry,f,context));
      check(a,'需要獨立逐片段語義核定');
     }
     return {...span,kind:f.kind,context};
    });
    let decision;
    if(section==='rejectedEvents'){
     const d=entry.decision,{r:dr}=locate(d);check(dr.role==='user','拒絕決定不是玩家原文');
     const ds=exactSpan(dr,d),f={...d,kind:'event-evidence'};
     check(reviews.has(reviewKey(t.target,candidate.manager,section,d,f,'declined:'+identity)),'缺少獨立拒絕關聯核定');
     decision={sha256:d.sha256,chatId:d.chatId,sourceId:d.sourceId,sourceIndex:d.sourceIndex,...ds};
    }
    if(section==='easterEggs')check(str(entry.title)&&['confirmed','uncertain'].includes(entry.status),'彩蛋缺少確認狀態');
    return {id:'predecessor:'+section+':'+entry.chatId+':'+r.id,role:r.role,source:{sha256:entry.sha256,chatId:entry.chatId,sourceId:r.id,sourceIndex:r.index,status:v.raw.status,basis:v.basis,canonical:false},fragments,...(decision?{decision}:{}),...(section==='easterEggs'?{title:entry.title,status:entry.status}:{})};
   });
  }
  out.push(result);
 }
 return {format:'gal-predecessor-archaeology-preview-result',version:VERSION,status:'preview-only',canonical:false,importable:false,manager:candidate.manager,targets:out,sourceEvidence:[...views].map(([sha256,v])=>({sha256,chatId:v.raw.chatId,runId:v.raw.runId,status:v.raw.status,basis:v.basis,count:v.rows.length,isolated:v.rows.filter(unresolved).length,warnings:v.warnings,...(v.baseSha256?{baseSha256:v.baseSha256}:{})})),counts:{sources:[...views.values()].reduce((n,v)=>n+v.rows.length,0),entries:out.reduce((n,t)=>n+SECTIONS.reduce((s,k)=>s+t[k].length,0),0),fragments:out.reduce((n,t)=>n+SECTIONS.reduce((s,k)=>s+t[k].reduce((m,e)=>m+e.fragments.length,0),0),0)}};
}
module.exports={FORMAT,VERSION,SECTIONS,reviewKey,preview};
