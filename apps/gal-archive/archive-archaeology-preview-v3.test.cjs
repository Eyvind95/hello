'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const api=require('./archive-archaeology-preview-v3.cjs'),normal=require('./archive-pilot-import.js');
const target={worldKey:'fiction',cycleId:'cycle-test',cycleTitle:'測試輪迴'};
const manager='測試前輩';
const row=(role,id,text,index)=>({id:role+'|'+(role==='user'?'turn':'message')+':'+id,role,text,index,identityBasis:role==='user'?'turn-key':'native-dom-id',sourceCreatedAt:null,structure:[],attachments:[]});
const raw=(chatId,runId,rows,status='completed')=>({format:'gal-predecessor-chat',version:1,chatId,runId,status,count:rows.length,rows,evidence:{topReached:true,bottomReached:true,continuity:true}});
const original=d=>{const bytes=Buffer.from(JSON.stringify(d));return {bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
const approval=(d,o,count=d.count)=>({sha256:o.sha256,chatId:d.chatId,runId:d.runId,status:d.status,count,reviewId:'independent-fixture'});
function fixture(){
 const u=row('user','u1','前置😀\n我：\n！BUG 設定修正\n玩家劇情\n他：\nAI劇情\n後置評論',0),a=row('assistant','a1','前段。跳過。末段。',1);
 const d=raw('chat-a','run-a',[u,a]),o=original(d);
 const review={sources:[approval(d,o)],fragments:[],targets:[target]};
 const t={target,...Object.fromEntries(api.SECTIONS.map(k=>[k,[]]))};
 const candidate={format:api.FORMAT,version:3,manager,targets:[t]};
 const entry=(r,fragments)=>({sha256:o.sha256,chatId:d.chatId,sourceId:r.id,sourceIndex:r.index,fragments});
 const frag=(r,text,kind='commentary')=>({start:r.text.indexOf(text),end:r.text.indexOf(text)+text.length,text,kind});
 const approve=(section,e,f,context)=>review.fragments.push({key:api.reviewKey(target,manager,section,e,f,context),reviewId:'independent-fixture',reason:'合成語義核定'});
 const input={originals:[o],review,candidate};
 return {u,a,d,o,t,review,input,entry,frag,approve};
}
test('one source multiple disjoint fragments, no invented concatenation or source count',()=>{
 const {a,t,input,entry,frag}=fixture();t.pilotMessages=[entry(a,[frag(a,'前段。'),frag(a,'末段。')])];
 const p=api.preview(input);assert.equal(p.status,'preview-only');assert.equal(p.importable,false);
 assert.equal(p.counts.entries,1);assert.equal(p.counts.fragments,2);
 assert.deepEqual(p.targets[0].pilotMessages[0].fragments.map(f=>f.text),['前段。','末段。']);
 assert.equal('text' in p.targets[0].pilotMessages[0],false);
 assert.equal(api.preview(input).targets[0].pilotMessages[0].id,p.targets[0].pilotMessages[0].id);
});
test('reject offsets, manufactured joined text, duplicate and overlapping or reversed fragments',()=>{
 for(const mode of ['fake','wrong-offset','overlap','reverse','duplicate-source','surrogate']){
  const {u,a,t,input,entry,frag}=fixture();const p=frag(a,'前段。'),q=frag(a,'末段。');
  const e=entry(a,[p,q]);t.pilotMessages=[e];
  if(mode==='fake')p.text='前段。末段。';
  if(mode==='wrong-offset')p.start++;
  if(mode==='overlap')e.fragments=[p,p];
  if(mode==='reverse')e.fragments.reverse();
  if(mode==='duplicate-source')t.pilotMessages.push(e);
  if(mode==='surrogate')t.pilotMessages=[entry(u,[{start:2,end:3,text:u.text.slice(2,3),kind:'commentary'}])];
  assert.throws(()=>api.preview(input),/片段|來源/);
 }
});
test('ordinary prefix passes; player correction and postscript need external scoped review',()=>{
 const {u,t,input,entry,frag,approve}=fixture();
 const prefix=frag(u,'前置😀'),correction=frag(u,'！BUG 設定修正','player-correction'),post=frag(u,'後置評論');
 const e=entry(u,[prefix,correction,post]);t.pilotMessages=[e];
 assert.throws(()=>api.preview(input),/語義核定/);
 approve('pilotMessages',e,correction,'gal-player-input');
 assert.throws(()=>api.preview(input),/語義核定/);
 approve('pilotMessages',e,post,'reviewed-outside-story');
 assert.equal(api.preview(input).counts.fragments,3);
 e.fragments=[prefix,frag(u,'AI劇情','player-correction')];
 assert.throws(()=>api.preview(input),/Gal AI/);
});
test('review cannot transfer to different section, target, manager, or source range',()=>{
 const {u,t,input,entry,frag,approve}=fixture();
 const f=frag(u,'！BUG 設定修正','player-correction'),e=entry(u,[f]);t.pilotMessages=[e];approve('pilotMessages',e,f,'gal-player-input');
 assert.equal(api.preview(input).counts.fragments,1);
 input.candidate.manager='另一前輩';assert.throws(()=>api.preview(input),/語義核定/);
 input.candidate.manager=manager;f.start++;f.text=f.text.slice(1);assert.throws(()=>api.preview(input),/語義核定/);
});
function joinedFixture(){
 const b=raw('chat-join','base',[row('user','u2','舊玩家',0),row('assistant','a2','舊助手',1),row('user','u3','後段',2)],'failed');
 const bo=original(b);
 const prefix=[row('user','u1','前置',0),row('assistant','a1','前輩',1)];
 const c=[...prefix,...b.rows.map((r,i)=>({...r,index:i+2}))];
 const d={format:'gal-predecessor-prefix-supplement-evidence',version:1,status:'joined-observed-prefix',chatId:b.chatId,runId:'joined',canonical:false,importable:false,continuity:false,fidelity:'rendered-dom',error:null,rows:c.slice(0,4),count:4,candidateRows:c,base:{runId:b.runId,count:b.count,sha256:bo.sha256,firstId:b.rows[0].id},evidence:{observedTopVerified:true,openingVerified:false,openingBasis:'observed-top-only',observedFirstId:prefix[0].id,originalCheckpointUnchanged:true,lastConflict:null,added:2,matched:2,joinedCandidateCount:5}};
 const tail=raw('chat-b','tail',[row('user','u1','另一聊天',0)]);
 const to=original(tail);
 function input(){const o=original(d);return {originals:[o,bo,to],review:{sources:[approval(d,o,5),approval(tail,to)],fragments:[],targets:[target]},candidate:{format:api.FORMAT,version:3,manager,targets:[{target,...Object.fromEntries(api.SECTIONS.map(k=>[k,[]]))}]}}}
 return {d,b,input};
}
test('observed-prefix plus separate chat retains warnings and actual base; ordinary importer still rejects',()=>{
 const {d,input}=joinedFixture(),i=input(),p=api.preview(i);
 assert.equal(p.counts.sources,6);assert.equal(p.sourceEvidence[0].status,'joined-observed-prefix');assert.ok(p.sourceEvidence[0].warnings.includes('true-opening-unverified'));assert.equal(p.sourceEvidence[1].chatId,'chat-b');
 const pack={format:normal.FORMAT,version:2,target,manager,chatId:d.chatId,sourceSha256:i.originals[0].sha256};
 assert.throws(()=>normal.plan({world:target.worldKey,id:target.cycleId,title:target.cycleTitle},d,pack,pack.sourceSha256),/頂端補掃/);
});
test('reject missing base, fake opening, changed candidates, overlap and digest',()=>{
 for(const mode of ['base','opening','candidate','overlap','digest','relabel']){
  const {d,input}=joinedFixture();
  if(mode==='opening')d.evidence.openingVerified=true;
  if(mode==='candidate')d.candidateRows[4]={...d.candidateRows[4],text:'改寫'};
  if(mode==='overlap')d.rows[2]={...d.rows[2],text:'不一致'};
  if(mode==='relabel')d.status='joined-evidence';
  const i=input();
  if(mode==='base')i.originals.splice(1,1);
  if(mode==='digest')i.originals[0].bytes=Buffer.from('{}');
  assert.throws(()=>api.preview(i),/原件|基準|開頭|候選|重疊/);
 }
});
test('candidate must not self-authorize source, cycle, or ordinary offline wrapper',()=>{
 const {d,input}=joinedFixture();let i=input();i.review.sources=[];assert.throws(()=>api.preview(i),/未核定/);
 i=input();i.candidate.targets[0].target={...target,cycleId:'foreign'};assert.throws(()=>api.preview(i),/輪迴/);
 d.format='gal-predecessor-offline-reconciliation-candidate';i=input();assert.throws(()=>api.preview(i),/來源證據/);
});
test('rejected event decision uses exact separate player span and independent relation review',()=>{
 const {a,u,t,input,entry,frag,approve}=fixture(),e=entry(a,[frag(a,'前段。','event-evidence')]);
 const d={...entry(u,[]),...frag(u,'前置😀','event-evidence')};delete d.fragments;e.decision=d;t.rejectedEvents=[e];
 assert.throws(()=>api.preview(input),/拒絕關聯/);
 approve('rejectedEvents',d,d,'declined:'+JSON.stringify([e.chatId,e.sourceId]));
 assert.equal(api.preview(input).targets[0].rejectedEvents[0].decision.text,'前置😀');
});
test('six sections required and source ID/index binding strict',()=>{
 const {a,t,input,entry,frag}=fixture();const e=entry(a,[frag(a,'前段。')]);t.pilotMessages=[e];e.sourceIndex=99;
 assert.throws(()=>api.preview(input),/索引/);e.sourceIndex=1;delete t.quizLogs;assert.throws(()=>api.preview(input),/六分頁/);
});
