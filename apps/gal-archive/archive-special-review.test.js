'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const start=html.indexOf('function archiveSpecialKey('),end=html.indexOf('async function archiveSpecialReadDiagnostic(');
assert.ok(start>=0&&end>start);
const context=vm.createContext({});
vm.runInContext(html.slice(start,end)+'\nthis.api={archiveSpecialKey,archiveSpecialMerge,archiveSpecialNext,archiveSpecialState,archiveSpecialIssues,archiveSpecialDiagnosticPlan}',context);
const {archiveSpecialKey:key,archiveSpecialMerge:merge,archiveSpecialNext:next,archiveSpecialState:state,archiveSpecialIssues:issues,archiveSpecialDiagnosticPlan:plan}=context.api;
const t1='2026-11-24T01:00:00.000Z',t2='2026-11-24T02:00:00.000Z',t3='2026-11-24T03:00:00.000Z';
const event={type:'event',entry:{id:'local-event',sourceEventId:'galnative-generated',nativeSourceMessageId:'immutable-native-event',chatKey:'chat',status:'accepted',scanIndex:67,text:'合成事件正文'}};
const reply={type:'message',entry:{id:'local-ai',role:'ai',text:'合成回覆'}};
const player={type:'message',entry:{id:'local-me',role:'me',text:'合成玩家'}};
const k=key(event),pending=next(null,'mark','合成格式異常',t1),resolved=next(pending,'resolve','',t2);
const record=marks=>({id:'cycle-test',specialReviews:marks});
const diagnostic={cycleId:'cycle-test',scanRunId:'synthetic-batch',nativeFormatAudit:{schemaVersion:1,failures:[{scanIndex:67,role:'ai',eventType:'event',sourceMessageId:'immutable-native-event',sourceMarkerCount:1,originalDomText:event.entry.text,reason:'synthetic-format-failure'}]}};
test('all inline website scripts compile',()=>{
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(x=>!/\bsrc\s*=/.test(x[1])&&x[2].trim());
 assert.ok(scripts.length>0);
 for(const [i,m] of scripts.entries())assert.doesNotThrow(()=>new vm.Script(m[2],{filename:'index-inline-'+i+'.js'}));
});
test('immutable identity follows changed scan index and record ID',()=>{
 assert.equal(key({...event,entry:{...event.entry,id:'new',scanIndex:999}}),k);
 assert.equal(key(player),null);
 assert.notEqual(key(reply),k);
 assert.equal(key({...event,entry:{...event.entry,nativeSourceMessageId:null}}),JSON.stringify(['event','record','local-event']));
});
test('pending, resolved, reopened; older evidence does not resurrect',()=>{
 assert.equal(issues(record({[k]:pending}),[reply,event])[0].index,1);
 assert.equal(issues(record({[k]:resolved}),[event]).length,0);
 assert.equal(merge({[k]:resolved},{[k]:pending})[k].status,'resolved');
 assert.equal(merge({[k]:pending},{[k]:resolved})[k].status,'resolved');
 assert.equal(merge({[k]:resolved},{[k]:next(resolved,'mark','',t3)})[k].status,'pending');
 assert.ok(resolved.evidence.includes('合成格式異常'));
});
test('legacy ID cannot mark different text after rescan; explicit edit stays marked',()=>{
 const legacy={type:'event',entry:{id:'fallback',sourceEventId:'galnative-ordinal',text:'原文'}};
 const id=key(legacy),review={...pending,anchorText:'原文',editedText:'人工修正'};
 assert.equal(state(record({[id]:review}),legacy).status,'pending');
 assert.equal(state(record({[id]:review}),{...legacy,entry:{...legacy.entry,text:'另一則'}}),null);
 assert.equal(state(record({[id]:review}),{...legacy,entry:{...legacy.entry,text:'人工修正'}}).status,'pending');
});
test('diagnostic plans only metadata, rejects wrong cycle or ambiguous/missing proof',()=>{
 const r=record({});
 const p=plan(r,[reply,event],diagnostic,t1);
 assert.equal(Object.keys(p.updates).length,1);
 assert.equal(p.updates[k].status,'pending');
 assert.deepEqual(r.specialReviews,{});
 assert.equal(event.entry.text,'合成事件正文');
 assert.throws(()=>plan({id:'wrong'},[event],diagnostic,t1));
 assert.equal(plan(r,[event,event],diagnostic,t1).unmatched.length,1);
 const invalid=JSON.parse(JSON.stringify(diagnostic));invalid.nativeFormatAudit.failures[0].sourceMarkerCount=2;
 assert.equal(plan(r,[event],invalid,t1).unmatched.length,1);
 assert.equal(Object.keys(plan(record({[k]:resolved}),[event],diagnostic,t3).updates).length,0);
});
test('blue and yellow are separate controls; canonical format gate remains mandatory',()=>{
 assert.match(html,/acceptedEvents\.map\(issue=>\(\{issue,kind:'event'\}\)\)/);
 assert.match(html,/specialIssues\|\|\[\]\)\)\.map\(issue=>\(\{issue,kind:'special'\}\)\)/);
 assert.match(html,/archive-audit-special-mark\{left:84%/);
 assert.match(html,/nativeFormatComplete!==true/);
 assert.match(html,/nativeFormatAudit\?\.failed!==0/);
 assert.match(html,/pilot\?\[\]:\(a\.specialIssues/);
});
