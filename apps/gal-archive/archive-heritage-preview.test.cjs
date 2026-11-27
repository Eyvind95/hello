'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const api=require('./archive-heritage-preview.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=x=>Buffer.from(JSON.stringify(x),'utf8');
function fixture(){
 const rows=['第一課😀','研讀回應','綜合問題','答卷','玩家回應','晚安'].map((text,index)=>({id:(index%2?'assistant|message:':'user|turn:')+'fixture-'+index,role:index%2?'assistant':'user',text,index,identityBasis:index%2?'native-dom-id':'turn-key',sourceCreatedAt:null,structure:[],attachments:[]}));
 const s={format:'gal-predecessor-chat',version:1,canonical:false,fidelity:'rendered-dom',status:'completed',error:null,chatId:'fixture-chat',runId:'fixture-run',count:6,rows,evidence:{topReached:true,bottomReached:true,continuity:true}};
 const sourceBytes=bytes(s),sourceSha256=hash(sourceBytes);
 const c={format:api.FORMAT,version:1,importable:false,status:'pending-independent-review',manager:'合成後輩',chatId:s.chatId,target:null,sourceText:sourceBytes.toString(),sourceSizeBytes:sourceBytes.length,sourceSha256,sourceCount:6,sections:{pilotMessages:[],quizLogs:[],easterEggs:[],casinoLogs:[],rejectedEvents:[],realChatLogs:rows.map(r=>({sourceId:r.id,text:r.text}))},coverage:rows.map(r=>({index:r.index,sourceId:r.id,role:r.role,sourceCreatedAt:r.sourceCreatedAt,reviewed:true,cycleBinding:null,sections:['realChatLogs'],utf16Count:r.text.length,codePointCount:[...r.text].length,rangeUtf16:[0,r.text.length],rangeCodePoint:[0,[...r.text].length],textSha256:hash(Buffer.from(r.text))})),crossCycleQuiz:{questionSourceId:rows[2].id,answerSourceId:rows[3].id,responseSourceId:rows[4].id,classification:'合成傳承考核',score:null,referenceOnly:true,referencedCycles:['甲','乙']}};
 const approval={reviewId:'fixture-independent',accepted:true,manager:c.manager,chatId:s.chatId,count:6,sourceSha256,candidateSha256:hash(bytes(c)),assessmentClassification:c.crossCycleQuiz.classification,assessment:{sourceIds:rows.slice(2,5).map(r=>r.id),referencedCycles:['甲','乙']}};
 const input=()=>({sourceBytes,candidateBytes:bytes(c),approval});
 const rehash=()=>{approval.candidateSha256=hash(bytes(c))};
 return {s,c,approval,input,rehash};
}
test('six unbound rows and one reference-only assessment; no invented cycle id or score',()=>{
 const f=fixture(),p=api.plan(f.input());assert.equal(p.status,'preview-only');assert.equal(p.importable,false);assert.equal(p.counts.rowsAdded,6);assert.equal(p.counts.assessmentsAdded,1);assert.equal(p.proposedStore.rows.every(r=>r.cycleBinding===null&&r.canonical===false&&!('cycleId'in r)),true);
 const q=p.proposedStore.assessments[0];assert.equal(q.score,null);assert.equal(q.referenceOnly,true);assert.equal(q.questionId,p.proposedStore.rows[2].id);
});
test('append-only and idempotent; unrelated existing records preserved; conflicts stop',()=>{
 const f=fixture(),existing=api.emptyStore();existing.rows.push({id:'other',text:'existing'});
 let p=api.plan({...f.input(),existing});assert.equal(p.proposedStore.rows[0].text,'existing');assert.equal(existing.rows.length,1);
 let q=api.plan({...f.input(),existing:p.proposedStore});assert.equal(q.counts.rowsAdded,0);assert.equal(q.counts.rowsUnchanged,6);assert.equal(q.counts.assessmentsUnchanged,1);
 p.proposedStore.rows[1].text='different';assert.throws(()=>api.plan({...f.input(),existing:p.proposedStore}),/不同內容/);
});
test('candidate cannot self-authorize, mutate digest or acquire fake cycle',()=>{
 const f=fixture();f.approval.accepted=false;assert.throws(()=>api.plan(f.input()),/獨立驗收/);
 f.approval.accepted=true;f.c.target={cycleId:'fake'};assert.throws(()=>api.plan(f.input()),/SHA-256/);f.rehash();assert.throws(()=>api.plan(f.input()),/未綁定/);
});
test('omission, reordered source, altered original text and nonempty cycle sections refused',()=>{
 for(const mode of ['omit','reorder','edit','other','coverage','offset','bind']){
  const f=fixture();if(mode==='omit')f.c.sections.realChatLogs.pop();if(mode==='reorder')f.c.sections.realChatLogs.reverse();if(mode==='edit')f.c.sections.realChatLogs[0].text+='extra';if(mode==='other')f.c.sections.quizLogs.push({});if(mode==='coverage')f.c.coverage.pop();if(mode==='offset')f.c.coverage[0].rangeUtf16[1]--;if(mode==='bind')f.c.coverage[0].cycleBinding='fake';
  f.rehash();assert.throws(()=>api.plan(f.input()),/覆蓋|正文|傳承交流|清冊|範圍/);
 }
});
test('assessment cannot be converted to scored or canonical cycle quiz or silently omitted',()=>{
 for(const mode of ['score','label','omit','role','reference']){
  const f=fixture();if(mode==='score')f.c.crossCycleQuiz.score=100;if(mode==='label')f.c.crossCycleQuiz.referencedCycles=['甲','丙'];if(mode==='omit')f.c.crossCycleQuiz=null;if(mode==='role')f.c.crossCycleQuiz.answerSourceId=f.s.rows[4].id;if(mode==='reference')f.c.crossCycleQuiz.referenceOnly=false;
  f.rehash();assert.throws(()=>api.plan(f.input()),/考核|關聯/);
 }
});
