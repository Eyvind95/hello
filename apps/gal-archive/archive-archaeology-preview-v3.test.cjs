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
 input.review.fragments.push({key:api.entryReviewKey(target,manager,'rejectedEvents',e),reviewId:'independent-fixture',reason:'事件與拒絕已核定'});
 assert.equal(api.preview(input).targets[0].rejectedEvents[0].decision.text,'前置😀');
});
test('six sections required and source ID/index binding strict',()=>{
 const {a,t,input,entry,frag}=fixture();const e=entry(a,[frag(a,'前段。')]);t.pilotMessages=[e];e.sourceIndex=99;
 assert.throws(()=>api.preview(input),/索引/);e.sourceIndex=1;delete t.quizLogs;assert.throws(()=>api.preview(input),/六分頁/);
});

const approvalKey=k=>({key:k,reviewId:'independent-fixture',reason:'獨立合成核定'});
test('FLARE-FINAL-002 001: event body, title and decision changes invalidate approval',()=>{
 const {a,u,t,input,entry,frag}=fixture(),e=entry(a,[frag(a,'前段。','event-evidence')]);
 e.decision={...entry(u,[]),...frag(u,'前置😀','event-evidence')};delete e.decision.fragments;
 t.rejectedEvents=[e];input.review.fragments.push(approvalKey(api.entryReviewKey(target,manager,'rejectedEvents',e)));
 assert.equal(api.preview(input).counts.fragments,1);
 const previous=e.fragments;e.fragments=[frag(a,'末段。','event-evidence')];
 assert.throws(()=>api.preview(input),/拒絕關聯核定/);
 e.fragments=previous;e.fragments.push(frag(a,'末段。','event-evidence'));
 assert.throws(()=>api.preview(input),/拒絕關聯核定/);
 e.fragments.pop();e.title='前段。';assert.throws(()=>api.preview(input),/拒絕關聯核定/);
 delete e.title;e.decision={...e.decision,...frag(u,'玩家劇情','event-evidence')};
 assert.throws(()=>api.preview(input),/拒絕關聯核定/);
});
test('FLARE-FINAL-002 002: an uncertain egg cannot be upgraded or have title/evidence replaced',()=>{
 const {a,t,input,entry,frag}=fixture(),e={...entry(a,[frag(a,'前段。','egg-evidence')]),title:'合成彩蛋',status:'uncertain'};
 t.easterEggs=[e];assert.throws(()=>api.preview(input),/彩蛋.*核定/);
 input.review.fragments.push(approvalKey(api.entryReviewKey(target,manager,'easterEggs',e)));
 assert.equal(api.preview(input).targets[0].easterEggs[0].status,'uncertain');
 e.status='confirmed';assert.throws(()=>api.preview(input),/彩蛋.*核定/);
 e.status='uncertain';e.title='另一彩蛋';assert.throws(()=>api.preview(input),/彩蛋.*核定/);
 e.title='合成彩蛋';e.fragments=[frag(a,'末段。','egg-evidence')];assert.throws(()=>api.preview(input),/彩蛋.*核定/);
 e.status='confirmed';input.review.fragments.push(approvalKey(api.entryReviewKey(target,manager,'easterEggs',e)));
 assert.equal(api.preview(input).targets[0].easterEggs[0].status,'confirmed');
});
test('FLARE-FINAL-002 003: same or overlapping fragment across cycles and tabs needs exact independent approval',()=>{
 const {a,t,input,entry,frag}=fixture(),other={...target,cycleId:'other-cycle',cycleTitle:'另一輪迴'};
 const f=frag(a,'前段。'),e=entry(a,[f]);t.pilotMessages=[e];
 const e2=structuredClone(e),t2={target:other,...Object.fromEntries(api.SECTIONS.map(k=>[k,[]]))};t2.realChatLogs=[e2];
 input.review.targets.push(other);input.candidate.targets.push(t2);
 assert.throws(()=>api.preview(input),/跨輪迴片段歸屬衝突/);
 const k1=api.coverageKey(target,manager,'pilotMessages',e,f,'source'),k2=api.coverageKey(other,manager,'realChatLogs',e2,e2.fragments[0],'source');
 input.review.crossCycle=[approvalKey(api.crossCycleKey(manager,k1,k2))];
 assert.equal(api.preview(input).counts.entries,2);
 e2.fragments=[frag(a,'前段')];assert.throws(()=>api.preview(input),/跨輪迴片段歸屬衝突/);
 e2.fragments=[frag(a,'末段。')];assert.equal(api.preview(input).counts.fragments,2);
});
test('same fragment in different tabs of the same cycle remains allowed',()=>{
 const {a,t,input,entry,frag}=fixture(),e=entry(a,[frag(a,'前段。')]);
 t.pilotMessages=[e];t.realChatLogs=[structuredClone(e)];assert.equal(api.preview(input).counts.entries,2);
});
function fullFixture(){
 const {u,a,t,input,entry,frag,approve}=fixture();
 const p=frag(u,'前置😀'),c=frag(u,'！BUG 設定修正','player-correction');
 const ue=entry(u,[p,c]),af=frag(a,'前段。'),ae=entry(a,[af]);
 t.pilotMessages=[ue,ae];approve('pilotMessages',ue,c,'gal-player-input');
 const cov=(e,keys,disposition='selected')=>({sha256:e.sha256,chatId:e.chatId,sourceId:e.sourceId,sourceIndex:e.sourceIndex,keys,disposition,reviewId:'independent-fixture',reason:'逐來源核定'});
 const ck=(e,f,context)=>api.coverageKey(target,manager,'pilotMessages',e,f,context);
 input.review.coverage=[cov(ue,[ck(ue,p,'prefix'),ck(ue,c,'gal-player-input')]),cov(ae,[ck(ae,af,'source')])];
 input.requireFullCoverage=true;
 return {u,a,t,input,entry,frag,ue,ae};
}
test('FLARE-FINAL-002 004: complete coverage checks independent selected/excluded row and exact fragment manifest',()=>{
 const {input,t,ue,ae,a,frag}=fullFixture();
 const p=api.preview(input);assert.equal(p.coverage.status,'complete-against-independent-ledger');assert.equal(p.importable,false);
 t.pilotMessages=[ue];let c=api.preview(input).coverage;assert.equal(c.status,'incomplete');assert.equal(c.missingSources.length,1);assert.equal(c.missingFragments.length,1);
 t.pilotMessages=[ue,ae];ue.fragments.pop();c=api.preview(input).coverage;assert.equal(c.missingFragments.length,1);assert.equal(c.unusedReviews.length,1);
 ae.fragments.push(frag(a,'末段。'));c=api.preview(input).coverage;assert.equal(c.unexpectedFragments.length,1);
 input.review.coverage.pop();c=api.preview(input).coverage;assert.equal(c.missingSources.length,1);
 input.requireFullCoverage=false;assert.equal(api.preview(input).coverage.status,'not-requested');
});
test('full coverage flags omitted approved target, unknown/duplicate ledger and exclusions',()=>{
 const {input,t,ue}=fullFixture();
 input.review.targets.push({...target,cycleId:'missing'});assert.equal(api.preview(input).coverage.missingTargets.length,1);input.review.targets.pop();
 const original=input.review.coverage[1];input.review.coverage[1]={...original,sourceIndex:99};assert.throws(()=>api.preview(input),/覆蓋清冊來源/);
 input.review.coverage[1]=original;input.review.coverage.push(original);assert.throws(()=>api.preview(input),/覆蓋清冊來源/);input.review.coverage.pop();
 t.pilotMessages=[ue];input.review.coverage[1]={...original,disposition:'excluded',keys:[]};
 assert.equal(api.preview(input).coverage.status,'complete-against-independent-ledger');
 input.review.coverage[1]={...original,disposition:'excluded'};assert.throws(()=>api.preview(input),/選取狀態/);
});
test('full coverage requires independent ledger, cannot infer from the candidate',()=>{
 const {input}=fullFixture();delete input.review.coverage;assert.throws(()=>api.preview(input),/獨立逐來源清冊/);
});

test('FLARE-FINAL-003 005: cycle identity is worldKey plus cycleId, title is independently checked',()=>{
 const {input,t}=fixture(),alias={...target,cycleTitle:'另一標題'};
 input.review.targets.push(alias);assert.throws(()=>api.preview(input),/輪迴核定重複或標題衝突/);
 input.review.targets.pop();input.review.targets.push({...target});assert.throws(()=>api.preview(input),/輪迴核定重複/);
 input.review.targets.pop();t.target=alias;assert.throws(()=>api.preview(input),/輪迴標題/);
 t.target=target;input.candidate.targets.push({...t,target:alias});assert.throws(()=>api.preview(input),/重複輪迴/);
 input.candidate.targets.pop();const other={...target,worldKey:'different-world'};
 input.review.targets.push(other);input.candidate.targets.push({...t,target:other});
 assert.equal(api.preview(input).targets.length,2);
});
function placeSemantic(section,kind,which,context,approved){
 const {u,a,t,input,entry,frag,approve}=fixture();
 const r=which==='assistant'?a:u;
 const phrase=which==='assistant'?'前段。':which==='ai'?'AI劇情':which==='prefix'?'前置😀':which==='cross'?'玩家劇情\n他：\nAI劇情':'！BUG 設定修正';
 const f=frag(r,phrase,kind),e=entry(r,[f]);t[section]=[e];
 if(section==='rejectedEvents'){e.decision={...entry(u,[]),...frag(u,'前置😀','event-evidence')};delete e.decision.fragments;}
 if(section==='easterEggs'){e.title='測試彩蛋';e.status='uncertain';}
 if(['rejectedEvents','easterEggs'].includes(section))input.review.fragments.push(approvalKey(api.entryReviewKey(target,manager,section,e)));
 if(approved)approve(section,e,f,context);
 return {input,t,e,f};
}
for(const section of api.SECTIONS){
 test('FLARE-FINAL-003 006: '+section+' enforces both player semantic kinds independently of tab',()=>{
  for(const kind of ['player-correction','player-annotation']){
   for(const [which,context,pattern] of [['ai','gal-ai-output',/Gal AI/],['assistant','source',/非玩家來源/],['cross','gal-player-input',/跨越劇情標記/]]){
    const {input}=placeSemantic(section,kind,which,context,true);assert.throws(()=>api.preview(input),pattern);
   }
   for(const [which,context] of [['player','gal-player-input'],['prefix','prefix']]){
    const {input,e,f}=placeSemantic(section,kind,which,context,false);
    assert.throws(()=>api.preview(input),/逐片段語義核定/);
    input.review.fragments.push(approvalKey(api.reviewKey(target,manager,section,e,f,context)));
    assert.equal(api.preview(input).targets[0][section][0].fragments[0].context,context);
   }
  }
 });
 test('FLARE-FINAL-003 006: '+section+' post-marker player commentary requires scoped review',()=>{
  const {input,e,f}=placeSemantic(section,'commentary','player','reviewed-outside-story',false);
  assert.throws(()=>api.preview(input),/逐片段語義核定/);
  input.review.fragments.push(approvalKey(api.reviewKey(target,manager,section,e,f,'reviewed-outside-story')));
  assert.equal(api.preview(input).targets[0][section][0].fragments[0].context,'reviewed-outside-story');
 });
}
test('player semantic approval cannot transfer between tabs, and raw quotation remains distinct',()=>{
 const {input,t,e,f}=placeSemantic('realChatLogs','player-correction','player','gal-player-input',true);
 assert.equal(api.preview(input).counts.fragments,1);
 t.realChatLogs=[];t.quizLogs=[e];assert.throws(()=>api.preview(input),/逐片段語義核定/);
 const q=placeSemantic('realChatLogs','quotation','ai','source',false);
 assert.equal(api.preview(q.input).targets[0].realChatLogs[0].fragments[0].kind,'quotation');
});
test('embedded Gal AI text cannot masquerade as player rejection decision',()=>{
 const {u,a,t,input,entry,frag}=fixture(),e=entry(a,[frag(a,'前段。','event-evidence')]);
 e.decision={...entry(u,[]),...frag(u,'AI劇情','event-evidence')};delete e.decision.fragments;t.rejectedEvents=[e];
 input.review.fragments.push(approvalKey(api.entryReviewKey(target,manager,'rejectedEvents',e)));
 assert.throws(()=>api.preview(input),/Gal AI.*拒絕決定/);
});


function legacyFixture(){
 const b=raw('legacy-chat','base',[row('user','u4','old u',0),row('assistant','a4','old a',1),row('user','u5','end',2)],'failed'),bo=original(b);
 const prefix=[row('user','u1','one',0),row('assistant','a1','two',1),row('user','u2','',2),row('assistant','a2','four',3)];
 prefix[2].nonTextOmitted=true;
 const base={runId:b.runId,count:b.count,sha256:bo.sha256,firstId:b.rows[0].id};
 const prior={format:'gal-predecessor-prefix-supplement-evidence',version:1,scannerVersion:'0.10.83',canonical:false,importable:false,continuity:false,status:'failed',chatId:b.chatId,runId:'prior',count:2,rows:prefix.slice(0,2),base,candidateRows:null,evidence:{observedTopVerified:true,observedFirstId:prefix[0].id}};
 const po=original(prior),candidateRows=[...prefix,...b.rows.map((r,i)=>({...r,index:i+4}))],tailIds=prior.rows.map(r=>r.id);
 const d={format:prior.format,version:1,scannerVersion:'0.10.83',canonical:false,importable:false,continuity:false,fidelity:'rendered-dom',status:'joined-observed-prefix',chatId:b.chatId,runId:'joined',count:6,rows:candidateRows.slice(0,6),candidateRows,base,error:null,evidence:{observedTopVerified:true,openingVerified:false,openingBasis:'observed-top-only',observedFirstId:prefix[0].id,originalCheckpointUnchanged:true,lastConflict:{reason:'空白回合未能確認內容／附件',evidence:null},added:4,matched:2,joinedCandidateCount:7,windows:50,recoveryTrace:[],conflictDom:[],prefixResume:{runId:prior.runId,sha256:po.sha256,count:2,tailIds,openingProof:'inherited-observed-only'},resumeNavigation:[{kind:'current-window',target:null,verified:true,tailIds}]}};
 const make=(approve=true)=>{const o=original(d),a=approval(d,o,7);if(approve)a.legacyReadRecovery={disposition:'historical-read-error-window-recovered',reviewId:'synthetic-independent',reason:'legacy current-window recovery independently checked',sha256:o.sha256,baseSha256:bo.sha256,prefixSha256:po.sha256,chatId:d.chatId,runId:d.runId,causalSourceId:null};
 return {originals:[o,bo,po],review:{sources:[a],targets:[target],fragments:[]},candidate:{format:api.FORMAT,version:3,manager,targets:[{target,...Object.fromEntries(api.SECTIONS.map(k=>[k,[]]))}]}}};
 return {d,prior,make};
}
test('legacy read error is not cleared or inferred to identify a blank row; exact prior and external approval needed for preview',()=>{
 const {d,make}=legacyFixture();
 assert.throws(()=>api.preview(make(false)),/接合證據不足/);
 const i=make(),before=JSON.stringify(d),out=api.preview(i);
 assert.equal(out.importable,false);assert.equal(out.counts.sources,7);
 assert.equal(out.sourceEvidence[0].legacyReadRecovery.causalSourceId,null);
 assert.equal(out.sourceEvidence[0].legacyReadRecovery.rowContentVerified,false);
 assert.deepEqual(out.sourceEvidence[0].legacyReadRecovery.originalLastConflict,d.evidence.lastConflict);
 assert.ok(out.sourceEvidence[0].warnings.includes('causal-row-unidentified'));assert.equal(JSON.stringify(d),before);
 assert.throws(()=>normal.plan({world:target.worldKey,id:target.cycleId,title:target.cycleTitle},d,{format:normal.FORMAT,version:2,target,manager,chatId:d.chatId,sourceSha256:i.originals[0].sha256},i.originals[0].sha256),/頂端補掃/);
});
test('legacy recovery rejects unrelated errors, synthetic clearance, absent evidence, changed prefix, and unbound approval',()=>{
 for(const mode of ['wrong-version','wrong-conflict','merge-conflict','missing-prior','wrong-prefix','wrong-tail','unverified-resume','wrong-review-hash','causal-guess','candidate-tamper','unexpected-exception']){
  const {d,make}=legacyFixture();
  if(mode==='wrong-version')d.scannerVersion='0.10.84';
  if(mode==='wrong-conflict')d.evidence.lastConflict.reason='其他衝突';
  if(mode==='merge-conflict')d.evidence.recoveryTrace=[{event:'forward-conflict'}];
  if(mode==='wrong-prefix'){d.rows[0]={...d.rows[0],text:'changed'};d.candidateRows[0]=d.rows[0]}
  if(mode==='wrong-tail')d.evidence.resumeNavigation[0].tailIds=['wrong','tail'];
  if(mode==='unverified-resume')d.evidence.resumeNavigation[0].verified=false;
  if(mode==='candidate-tamper')d.candidateRows[6]={...d.candidateRows[6],text:'changed'};
  if(mode==='unexpected-exception')d.evidence.lastConflict=null;
  const i=make();
  if(mode==='missing-prior')i.originals.pop();
  if(mode==='wrong-review-hash')i.review.sources[0].legacyReadRecovery.sha256='f'.repeat(64);
  if(mode==='causal-guess')i.review.sources[0].legacyReadRecovery.causalSourceId=d.rows[2].id;
  assert.throws(()=>api.preview(i),/接合證據不足|候選|例外/);
 }
});
