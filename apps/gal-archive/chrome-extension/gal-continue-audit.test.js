'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
const start=source.indexOf('function verifyAutoContinueAudit(');
const end=source.indexOf('function summarizeEventAudit(',start);
assert.ok(start>0&&end>start);
const verify=new Function('hash',source.slice(start,end)+'; return verifyAutoContinueAudit;')(
 value=>'source-'+String(value).length);
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
test('test helper validates the exact continuation audit implementation, not a copied approximation',()=>{
 assert.match(source,/autoContinueAudit=continuedPositions\.length/);
 assert.match(source,/\?verifyAutoContinueAudit\(collected,continuedPositions,/);
 assert.match(source,/eventAudit.history,eventAudit.senders/);
 assert.doesNotMatch(source,/eventAudit\.history\.size!==collected\.length/);
});
