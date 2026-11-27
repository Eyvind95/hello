'use strict';
// Independent heritage archive. Pure offline planning only, no storage, network or cycle writes.
const crypto=require('node:crypto');
const native=require('./chrome-extension/predecessor-chat-core.js');
const FORMAT='gal-predecessor-unbound-review-candidate',STORE='gal-predecessor-heritage-store';
const SECTIONS=['pilotMessages','quizLogs','easterEggs','casinoLogs','realChatLogs','rejectedEvents'];
const check=(v,m)=>{if(!v)throw Error(m)};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.trim().length>0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=(...x)=>JSON.stringify(x);
const rowId=(chatId,sourceId)=>'heritage:'+key(chatId,sourceId);
const quizId=(chatId,sourceIds)=>'heritage-assessment:'+key(chatId,...sourceIds);
function original(bytes,sha){
 check(Buffer.isBuffer(bytes)&&hex(sha)&&digest(bytes)===sha,'原件 SHA-256 或位元組不符');
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 return {text,data:JSON.parse(text.replace(/^\uFEFF/,''))};
}
function emptyStore(){return {format:STORE,version:1,rows:[],assessments:[]}}
function plan({sourceBytes,candidateBytes,approval,existing=emptyStore()}){
 check(obj(approval)&&str(approval.reviewId)&&str(approval.manager)&&str(approval.chatId)&&Number.isSafeInteger(approval.count)&&approval.count>0&&approval.accepted===true,'缺少獨立驗收核定');
 const {text,data:s}=original(sourceBytes,approval.sourceSha256);
 const {data:c}=original(candidateBytes,approval.candidateSha256);
 check(s.format==='gal-predecessor-chat'&&s.version===1&&s.status==='completed'&&s.canonical===false&&s.error===null&&s.fidelity==='rendered-dom','原始聊天不是可核對完成檔');
 check(s.evidence?.topReached===true&&s.evidence?.bottomReached===true&&s.evidence?.continuity===true,'原始聊天上下端或連續性不符');
 check(str(s.runId)&&s.chatId===approval.chatId&&s.count===approval.count&&Array.isArray(s.rows)&&s.rows.length===s.count,'來源身分或筆數不符');
 native.validateRows(s.rows);
 check(s.rows.every((r,i)=>r.index===i&&r.identityBasis!=='unresolved-native-composite'&&!r.id.startsWith('assistant|composite:')&&str(r.text)),'來源順序或隔離身分不符');
 check(c.format===FORMAT&&c.version===1&&c.importable===false&&c.status==='pending-independent-review'&&c.target===null,'候選必須為未綁定、未匯入原件');
 check(c.manager===approval.manager&&c.chatId===s.chatId&&c.sourceSha256===approval.sourceSha256&&c.sourceSizeBytes===sourceBytes.length&&c.sourceCount===s.count&&c.sourceText===text,'候選來源、身分或完整原文不符');
 check(obj(c.sections)&&Object.keys(c.sections).length===SECTIONS.length&&SECTIONS.every(k=>Array.isArray(c.sections[k])),'候選六分頁格式錯誤');
 check(SECTIONS.filter(k=>k!=='realChatLogs').every(k=>c.sections[k].length===0),'非傳承交流資料需另行驗收，不可轉移');
 check(Array.isArray(c.coverage)&&c.coverage.length===s.count&&c.sections.realChatLogs.length===s.count,'未完整覆蓋來源');
 const rows=s.rows.map((r,i)=>{
  const x=c.sections.realChatLogs[i],v=c.coverage[i];
  check(obj(x)&&x.sourceId===r.id&&x.text===r.text,'現實聊天正文、順序或 ID 不符');
  check(obj(v)&&v.index===i&&v.sourceId===r.id&&v.role===r.role&&v.reviewed===true&&v.cycleBinding===null&&same(v.sections,['realChatLogs']),'逐來源語義清冊不符');
  check(v.utf16Count===r.text.length&&v.codePointCount===[...r.text].length&&same(v.rangeUtf16,[0,r.text.length])&&same(v.rangeCodePoint,[0,[...r.text].length])&&v.textSha256===digest(Buffer.from(r.text,'utf8')),'逐來源原文雜湊或範圍不符');
  check(v.sourceCreatedAt===r.sourceCreatedAt,'來源時間不符');
  return {id:rowId(s.chatId,r.id),manager:c.manager,chatId:s.chatId,runId:s.runId,sourceSha256:approval.sourceSha256,sourceId:r.id,sourceIndex:i,role:r.role,sourceCreatedAt:r.sourceCreatedAt,text:r.text,structure:r.structure,cycleBinding:null,kind:'heritage-exchange',canonical:false};
 });
 const byId=new Map(rows.map(r=>[r.sourceId,r])),assessments=[];
 if(c.crossCycleQuiz!==null&&c.crossCycleQuiz!==undefined){
  const q=c.crossCycleQuiz;
  check(obj(q)&&q.referenceOnly===true&&str(q.classification)&&q.classification===approval.assessmentClassification&&q.score===null&&Array.isArray(q.referencedCycles)&&q.referencedCycles.length>0&&q.referencedCycles.every(str)&&new Set(q.referencedCycles).size===q.referencedCycles.length,'跨輪迴考核核定或參照不符');
  const ids=[q.questionSourceId,q.answerSourceId,q.responseSourceId],refs=ids.map(id=>byId.get(id));
  check(refs.every(Boolean)&&same(refs.map(r=>r.role),['user','assistant','user'])&&refs[0].sourceIndex<refs[1].sourceIndex&&refs[1].sourceIndex<refs[2].sourceIndex,'考核題目、回答、回應來源或順序不符');
  check(obj(approval.assessment)&&same(approval.assessment.sourceIds,ids)&&same(approval.assessment.referencedCycles,q.referencedCycles),'缺少獨立跨輪迴關聯核定');
  assessments.push({id:quizId(s.chatId,ids),manager:c.manager,chatId:s.chatId,kind:'heritage-assessment',classification:q.classification,questionId:refs[0].id,answerId:refs[1].id,responseId:refs[2].id,score:null,referencedCycleLabels:q.referencedCycles.slice(),referenceOnly:true,cycleBinding:null,canonical:false});
 }else check(approval.assessment===undefined||approval.assessment===null,'遺漏已核定跨輪迴考核');
 check(obj(existing)&&existing.format===STORE&&existing.version===1&&Array.isArray(existing.rows)&&Array.isArray(existing.assessments),'傳承資料庫格式錯誤');
 function merge(old,incoming){
  const map=new Map();for(const e of old){check(obj(e)&&str(e.id)&&!map.has(e.id),'既有傳承資料 ID 重複');map.set(e.id,e)}
  let added=0,unchanged=0;
  for(const e of incoming){if(map.has(e.id)){check(same(map.get(e.id),e),'同一傳承來源已存在不同內容，停止合併');unchanged++}else{map.set(e.id,e);added++}}
  return {items:[...map.values()],added,unchanged};
 }
 const m=merge(existing.rows,rows),a=merge(existing.assessments,assessments);
 const merged={...existing,rows:m.items,assessments:a.items};
 return {status:'preview-only',importable:false,canonical:false,reviewId:approval.reviewId,sourceCount:s.count,sourceSha256:approval.sourceSha256,candidateSha256:approval.candidateSha256,counts:{rowsAdded:m.added,rowsUnchanged:m.unchanged,assessmentsAdded:a.added,assessmentsUnchanged:a.unchanged},snapshot:JSON.stringify(existing),proposedStore:merged};
}
module.exports={FORMAT,STORE,emptyStore,plan};
