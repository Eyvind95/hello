'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
const start=source.indexOf('function proveMergedPlayerSources(');
const end=source.indexOf('function summarizeEventAudit(',start);
assert.ok(start>0&&end>start);
const scope=new Function('hash',source.slice(start,end)+'; return {verifyAutoContinueAudit,analyzePlayerSourceDifference,proveMergedPlayerSources};')(
 value=>'source-'+String(value).length);
const verify=scope.verifyAutoContinueAudit;
const analyze=scope.analyzePlayerSourceDifference;
const prove=scope.proveMergedPlayerSources;
function fixture(){
 const rows=Array.from({length:22},(_,i)=>({role:'me',text:'玩家'+i}));
 const history=new Map(),senders=new Map();
 function ai(index,id,opts={}){
  rows[index]={role:'ai',text:'AI '+index,autoContinue:!!opts.continued,
   eventType:opts.event?'event':null,formatSource:{nativeReply:{
    messageId:id,eventEvidence:{sender:opts.event?'deg_event':'character',
    kind:opts.event?'event-message':'ordinary-message'}},
    ...(opts.gap?{playerGap:opts.gap}:{})}};
  history.set(id,opts.event?'event-message':'ordinary-message');
  senders.set(id,opts.event?'deg_event':'character');
 }
 ai(0,'opening');
 ai(3,'event-3',{event:true});
 ai(5,'ai-5');ai(6,'ai-6',{continued:true,gap:{previousId:'ai-5',currentId:'ai-6',
  previous:'character',current:'character',markers:[],loading:false}});
 ai(9,'ai-9');ai(10,'ai-10',{continued:true,gap:{previousId:'ai-9',currentId:'ai-10',
  previous:'character',current:'character',markers:[],loading:false}});
 ai(14,'ai-14');ai(15,'ai-15',{continued:true,gap:{previousId:'ai-14',currentId:'ai-15',
  previous:'character',current:'character',markers:[],loading:false}});
 const candidates=[{scanIndex:6,previousId:'ai-5',currentId:'ai-6'},
  {scanIndex:10,previousId:'ai-9',currentId:'ai-10'},
  {scanIndex:15,previousId:'ai-14',currentId:'ai-15'}];
 return {rows,history,senders,candidates};
}
function audit(x){return verify(x.rows,x.candidates,x.history,x.senders)}
test('global history count different from rows count does NOT defeat three independently proven auto continuations',()=>{
 const x=fixture();
 const result=audit(x);
 assert.equal(result.ok,true,JSON.stringify(result.problems));
 assert.equal(result.markerCountDifference,x.history.size-x.rows.length);
 assert.notEqual(result.markerCountDifference,0);
 assert.deepEqual(Array.from(result.candidateIndices),[6,10,15]);
 assert.equal(result.gaps.every(g=>g.ok),true);
});
test('local gap remains a strict fail if source markers exist or loading is still true',()=>{
 const x=fixture();
 x.rows[10].formatSource.playerGap.markers=[{sourceRef:'user-midway'}];
 const r=audit(x);
 assert.equal(r.ok,false);
 assert.ok(r.problems.some(p=>p.scanIndex===10&&p.errors.includes('player-or-other-source-marker-in-gap')));
 x.rows[10].formatSource.playerGap.markers=[];
 x.rows[6].formatSource.playerGap.loading=true;
 assert.equal(audit(x).ok,false);
});
test('duplicate, missing, misattributed or mis-sender native AI source IDs fail closed',()=>{
 let x=fixture();
 x.rows[6].formatSource.nativeReply.messageId='ai-5';
 assert.equal(audit(x).ok,false);
 x=fixture();x.history.delete('ai-5');
 assert.equal(audit(x).ok,false);
 x=fixture();x.senders.set('ai-15','user');
 assert.equal(audit(x).ok,false);
 x=fixture();x.rows[15].formatSource.playerGap.previousId='other';
 assert.equal(audit(x).ok,false);
 x=fixture();x.rows[10].autoContinue=false;
 assert.equal(audit(x).ok,false);
});
test('observed character/event IDs not included in scan cannot be silently ignored',()=>{
 const x=fixture();
 x.history.set('missing-character','ordinary-message');
 x.senders.set('missing-character','character');
 assert.equal(audit(x).ok,false);
 assert.equal(audit(x).unaccountedAIOrEvents.length,1);
 x.history.delete('missing-character');x.senders.delete('missing-character');
 x.history.set('missing-event','event-message');x.senders.set('missing-event','deg_event');
 assert.equal(audit(x).ok,false);
 assert.equal(audit(x).unaccountedAIOrEvents[0].sender,'deg_event');
});
test('unknown observed markers or too many independently identified user source IDs fail closed',()=>{
 const x=fixture();
 x.history.set('unknown-source','unreadable');
 assert.equal(audit(x).ok,false);
 x.history.delete('unknown-source');
 const userRows=x.rows.filter(r=>r.role==='me').length;
 for(let i=0;i<=userRows;i++){x.history.set('u-'+i,'ordinary-message');x.senders.set('u-'+i,'user')}
 const result=audit(x);
 assert.equal(result.ok,false);
 assert.ok(result.problems.some(p=>p.scope==='history'&&p.errors.includes('more-observed-user-messages-than-player-rows')));
});

test('player gap with two distinct native user source IDs is explicitly localized, not declared missing',()=>{
 const x=fixture(),links=new Map([
  ['u1',new Set([1])],['u2',new Set([1])],['u3',new Set([2])]
 ]);
 for(const id of ['u1','u2','u3']){x.history.set(id,'ordinary-message');x.senders.set(id,'user')}
 const report=analyze(x.rows,x.history,x.senders,links,new Map());
 assert.equal(report.originalUserMarkers,3);
 assert.equal(report.rowsWithMultipleNativeUserSources,1);
 assert.deepEqual(report.multipleNativeSourceDetails[0].scanIndex,1);
 assert.equal(report.unmappedNativeUserMarkers,0);
 assert.equal(report.countDifference,3-x.rows.filter(r=>r.role==='me').length);
});
test('unmapped user markers report stable source hashes and nearby scan positions',()=>{
 const x=fixture(),links=new Map([['u1',new Set([1])]]);
 x.history.set('u1','ordinary-message');x.senders.set('u1','user');
 x.history.set('u-extra','ordinary-message');x.senders.set('u-extra','user');
 const near=new Map([['u-extra',{first:{afterScanIndex:30,beforeScanIndex:31},
  last:{afterScanIndex:30,beforeScanIndex:31},sightings:5,hasText:true,hasMedia:false}]]);
 const report=analyze(x.rows,x.history,x.senders,links,near);
 assert.equal(report.unmappedNativeUserMarkers,1);
 assert.equal(report.unmappedNativeUserDetails[0].nearFirst.afterScanIndex,30);
 assert.equal(report.unmappedNativeUserDetails[0].sightings,5);
 assert.equal(report.unmappedNativeUserDetails[0].hasText,true);
 assert.ok(!JSON.stringify(report).includes('u-extra'));
});
test('same native user source assigned to two player rows is not silently accepted',()=>{
 const x=fixture();
 const links=new Map([['u1',new Set([1,2])]]);
 x.history.set('u1','ordinary-message');x.senders.set('u1','user');
 const result=verify(x.rows,x.candidates,x.history,x.senders,links,new Map());
 assert.equal(result.ok,false);
 assert.ok(result.problems.some(p=>p.errors.includes('same-user-source-mapped-to-multiple-player-rows')));
 assert.equal(result.playerSourceAudit.sourceInMultiplePlayerRows.length,1);
});
test('two extra native user markers preserve refusal and reveal detailed explanations',()=>{
 const x=fixture();
 const playerCount=x.rows.filter(r=>r.role==='me').length;
 const links=new Map(),near=new Map();
 for(let i=0;i<playerCount+2;i++){
  const id='user-'+i;
  x.history.set(id,'ordinary-message');x.senders.set(id,'user');
  if(i<playerCount)links.set(id,new Set([x.rows.findIndex((r,j)=>
   r.role==='me'&&x.rows.slice(0,j+1).filter(v=>v.role==='me').length===i+1)]));
  else near.set(id,{first:{afterScanIndex:i,beforeScanIndex:i+1},
   last:{afterScanIndex:i,beforeScanIndex:i+1},sightings:1});
 }
 const result=verify(x.rows,x.candidates,x.history,x.senders,links,near);
 assert.equal(result.ok,false);
 assert.equal(result.playerSourceAudit.countDifference,2);
 assert.equal(result.playerSourceAudit.unmappedNativeUserMarkers,2);
 assert.equal(result.playerSourceAudit.unmappedNativeUserDetails.length,2);
 assert.equal(result.playerSourceAudit.rowsWithMultipleNativeUserSources,0);
 assert.equal(result.gaps.every(g=>g.ok),true);
});


function userNative(id,text){return {id,sender:'user',kind:'ordinary-message',
 nativeReason:'available',nativeText:text,nativeMessageId:id,nativeSender:'user',
 hasText:true,hasMedia:false};}
function twoNativeSourcesFixture(){
 const x=fixture(),links=new Map(),indices=x.rows.flatMap((row,index)=>row.role==='me'?[index]:[]);
 for(let j=0;j<indices.length;j++){
  const index=indices[j],id='u-'+j;
  x.rows[index].formatSource={playerSources:[userNative(id,'內容'+j)],
   playerGapHasMedia:false};
  x.rows[index].text='內容'+j;
  x.history.set(id,'ordinary-message');x.senders.set(id,'user');
  links.set(id,new Set([index]));
 }
 const extraId='u-extra';
 const special=indices[3],firstId='u-3';
 x.rows[special].formatSource.playerSources=[userNative(firstId,'第一份「玩家」'),
  userNative(extraId,'第二份玩家')];
 x.rows[special].text='第一份「玩家」\n\n第二份玩家';
 x.history.set(extraId,'ordinary-message');x.senders.set(extraId,'user');
 links.set(extraId,new Set([special]));
 return {x,links,special,extraId};
}
test('two native user messages inside one player turn are accepted ONLY with exact ordered source contents',()=>{
 const {x,links,special}=twoNativeSourcesFixture();
 const result=verify(x.rows,x.candidates,x.history,x.senders,links,new Map());
 assert.equal(result.ok,true,JSON.stringify(result.problems));
 assert.equal(result.playerSourceAudit.safeSourceMerge,true);
 assert.equal(result.playerSourceAudit.explainedExtraNativeIds,1);
 const detail=result.playerSourceAudit.multipleNativeSourceDetails.find(r=>r.scanIndex===special);
 assert.equal(detail.contentProof.ok,true);
 assert.equal(detail.contentProof.sourceCount,2);
 assert.equal(detail.contentProof.originalNonWhitespaceChars,detail.contentProof.renderedNonWhitespaceChars);
 assert.equal(result.gaps.every(g=>g.ok),true);
});
test('missing source text, swapped order, hidden text, mismatched IDs, media or unexpected HTML all fail closed',()=>{
 const cases=[
  x=>{x.rows[x.special].formatSource.playerSources[1].nativeText=null;},
  x=>{x.rows[x.special].formatSource.playerSources.reverse();},
  x=>{x.rows[x.special].text+='遺漏的尾文';},
  x=>{x.rows[x.special].formatSource.playerSources[0].nativeMessageId='bad-id';},
  x=>{x.rows[x.special].formatSource.playerSources[1].sender='character';},
  x=>{x.rows[x.special].formatSource.playerSources[0].nativeReason='unavailable';},
  x=>{x.rows[x.special].formatSource.playerSources[0].hasMedia=true;},
  x=>{x.rows[x.special].formatSource.playerGapHasMedia=true;},
  x=>{x.rows[x.special].formatSource.playerSources[0].nativeText+='{{img:secret}}';}
 ];
 for(const sabotage of cases){
  const {x,links,special}=twoNativeSourcesFixture();
  const entry={...x,links,special};
  sabotage(entry);
  const result=verify(x.rows,x.candidates,x.history,x.senders,links,new Map());
  assert.equal(result.ok,false,sabotage.toString());
  const detail=result.playerSourceAudit.multipleNativeSourceDetails.find(r=>r.scanIndex===special);
  assert.equal(detail.contentProof.ok,false,sabotage.toString());
  assert.equal(result.playerSourceAudit.safeSourceMerge,false);
 }
});
test('two separate double-source player turns explain exactly two surplus WHIF user markers',()=>{
 const {x,links,special}=twoNativeSourcesFixture();
 const another=x.rows.findIndex((row,index)=>row.role==='me'&&index>special);
 const secondId='u-second-extra',firstId=[...links].find(([,indices])=>indices.has(another))[0];
 x.rows[another].formatSource.playerSources=[userNative(firstId,'甲'),userNative(secondId,'乙')];
 x.rows[another].text='甲乙';
 x.history.set(secondId,'ordinary-message');x.senders.set(secondId,'user');
 links.set(secondId,new Set([another]));
 const result=verify(x.rows,x.candidates,x.history,x.senders,links,new Map());
 assert.equal(result.ok,true,JSON.stringify(result.problems));
 assert.equal(result.playerSourceAudit.countDifference,2);
 assert.equal(result.playerSourceAudit.rowsWithMultipleNativeUserSources,2);
 assert.equal(result.playerSourceAudit.safeSourceMerge,true);
});
test('the native-source proof captures originals but exports diagnostic hashes, not source message text',()=>{
 const {x,links,special}=twoNativeSourcesFixture();
 const detail=analyze(x.rows,x.history,x.senders,links,new Map())
  .multipleNativeSourceDetails.find(r=>r.scanIndex===special);
 assert.equal(detail.contentProof.ok,true);
 assert.equal(JSON.stringify(detail).includes('第一份「玩家」'),false);
 assert.equal(JSON.stringify(detail).includes('第二份玩家'),false);
 assert.match(source.toString(),/original\.text/);
 assert.match(source.toString(),/sources\.map\(s=>s\.nativeText\)/);
});

test('test helper validates the exact continuation audit implementation, not a copied approximation',()=>{
 assert.match(source,/autoContinueAudit=!preview&&eventAudit\.history\.size/);
 assert.match(source,/\?verifyAutoContinueAudit\(collected,continuedPositions,/);
 assert.match(source,/safeSourceMerge/);
 assert.match(source,/nativeUserSegments/);
 assert.match(source,/playerGapHasMedia/);
 assert.match(source,/eventAudit.history,eventAudit.senders/);
 assert.match(source,/eventAudit.playerSourceRows,eventAudit.userNearby/);
 assert.match(source,/nativePlayerSourcesBetween/);
 assert.match(source,/playerSourceAudit/);
 assert.doesNotMatch(source,/eventAudit\.history\.size!==collected\.length/);
});

test('player-anchor bridge preserves a genuinely empty user source and does not widen ordinary reader',()=>{
 const vm=require('node:vm');
 const code=fs.readFileSync(require.resolve('./gal-native-source.js'),'utf8');
 let listener,response;
 class Element{constructor(id,message){this.id=id;this.__reactFiber$test={memoizedProps:{message}}}getAttribute(k){return k==='data-message-id'?this.id:null}dispatchEvent(e){response=JSON.parse(e.detail)}}
 class CustomEvent{constructor(type,opts){this.type=type;this.detail=opts.detail}}
 const ctx=vm.createContext({document:{addEventListener:(n,f)=>{listener=f}},Element,CustomEvent});
 vm.runInContext(code,ctx);
 const run=(node,detail)=>{response=null;listener({target:node,detail});return response};
 const node=new Element('u1',{id:'u1',sender_type:'user',content:'',metadata:{testFlag:true,unrelated:{hidden:'nested'}}});
 const result=run(node,'player-anchor-evidence');
 assert.equal(result.reason,'player-anchor-evidence');assert.equal(result.text,'');assert.equal(result.eventEvidence.sender,'user');
 assert.equal(result.metadataScalars.testFlag,true);assert.equal(result.metadataScalars.unrelated,undefined);
 assert.equal(run(node,'history-source-evidence').nativeLength,0);
 assert.equal(run(node,null),null);
 for(const message of [{id:'other',sender_type:'user',content:''},{id:'u1',sender_type:'character',content:''}]){
  assert.equal(run(new Element('u1',message),'player-anchor-evidence').reason,'message-content-unavailable');
 }
 const text=run(new Element('u1',{id:'u1',sender_type:'user',content:'real player text'}),'player-anchor-evidence');
 assert.equal(text.text,'real player text');
});
test('new player probe never changes existing strict continuation acceptance',()=>{
 assert.match(source,/function playerAnchorSample\(root,id,neighbors\)/);
 assert.match(source,/neighbor-order-not-proven/);
 assert.match(source,/foreign-or-duplicate-player-marker/);
 assert.match(source,/stableKey\(first\)!==stableKey\(second\)/);
 const x=fixture();x.rows[10].formatSource.playerGap.markers=[{sourceRef:'empty-user',sender:'user',hasText:false,hasMedia:false}];
 assert.equal(audit(x).ok,false);
});

test('hidden road player is preserved only with unique stable native template and matching adjacent marker',()=>{
 const start=source.indexOf('function proveHiddenRoadPlayer('),end=source.indexOf('function boundaryRead(',start);
 const hash=x=>'hash-'+x;
 const prove=new Function('hash',source.slice(start,end)+';return proveHiddenRoadPlayer;')(hash);
 const id='hidden-player',p='previous-ai',n='next-ai';
 const player={id,sender:'user',kind:'ordinary-message',nativeReason:'available',nativeSender:'user',nativeMessageId:id,
  hiddenNativeStable:true,hasText:false,hasMedia:false,nativeText:'{{測試設定}}\n{{測試條件}}'};
 const gap={loading:false,markers:[{sourceRef:hash(id),sender:'user',hasText:false,hasMedia:false}]};
 const result=prove([player],gap,p,n);
 assert.equal(result.sourceMessageId,id);assert.equal(result.templateCount,2);
 for(const bad of [{...player,hiddenNativeStable:false},{...player,nativeText:''},{...player,nativeText:'{{測試設定}}額外正文'},{...player,nativeText:'{{img::test}}'},{...player,hasMedia:true},{...player,nativeMessageId:'other'}])assert.equal(prove([bad],gap,p,n),null);
 assert.equal(prove([player,player],gap,p,n),null);
 assert.equal(prove([player],{...gap,loading:true},p,n),null);
 assert.equal(prove([player],{...gap,markers:[]},p,n),null);
 assert.equal(prove([player],gap,id,n),null);
});
