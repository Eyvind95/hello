// Run: node apps/gal-archive/predecessor-import-v2.test.js
'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const api=require('./archive-pilot-import.js');
const exporter=require('./archive-reading-export.js');
const source={format:'gal-predecessor-chat',version:1,status:'completed',chatId:'test',count:3,rows:[
 {id:'u0',index:0,role:'user',text:'事件：雷暴',attachments:[]},
 {id:'u1',index:1,role:'user',text:'我拒絕這個事件',attachments:[{name:'decision evidence'}]},
 {id:'a2',index:2,role:'assistant',text:'猜猜分+10；今天吃飯',attachments:[]}]};
const sourceText='\uFEFF'+JSON.stringify(source,null,2)+'\n',sha=createHash('sha256').update(sourceText,'utf8').digest('hex');
const r={world:'sentinel',id:'first',title:'第14輪迴',hero:'洛恩',messages:[{id:'canon',role:'me',text:'keep'}],events:[{id:'accepted',status:'accepted',text:'keep',storyPlacement:{beforeId:null}}],pilotMessages:[{id:'legacy',text:'keep'}],quizLogs:[],easterEggs:'old'};
const pack={format:api.FORMAT,version:2,target:api.binding(r),chatId:'test',sourceSha256:sha,manager:'test',pilotMessages:[],quizLogs:[],easterEggs:[],casinoLogs:[{sourceId:'a2',text:'猜猜分+10'}],realChatLogs:[{sourceId:'a2',text:'今天吃飯'}],rejectedEvents:[{sourceId:'u0',title:'雷暴',text:'事件：雷暴',decisionSourceId:'u1',decisionText:'我拒絕這個事件'}]};
const bundle=api.unpack(JSON.parse(JSON.stringify({format:api.BUNDLE,version:1,sourceText,pack})));
assert.equal(bundle.sourceText,sourceText);assert.equal(createHash('sha256').update(bundle.sourceText).digest('hex'),sha);
assert.equal(api.resolveTarget([{...r,id:'other',world:'adventure'},r],bundle.pack),r);
assert.throws(()=>api.resolveTarget([r,r],pack));
assert.throws(()=>api.resolveTarget([r],{...pack,target:{...pack.target,worldKey:'adventure'}}));
assert.throws(()=>api.resolveTarget([r],{...pack,target:{...pack.target,cycleTitle:'第15輪迴'}}));
const result=api.plan(r,bundle.source,bundle.pack,sha),u=result.updated;
assert.ok(api.sameUnchanged(r,u));assert.equal(u.events.length,1);assert.deepEqual(u.messages,r.messages);
assert.equal(u.casinoLogs.length,1);assert.equal(u.realChatLogs.length,1);assert.equal(u.rejectedEvents[0].rejectedEvidence.canonical,false);assert.equal(result.attachments,1);
assert.deepEqual(api.plan(u,source,pack,sha).updated,u);
assert.throws(()=>api.plan(r,source,{...pack,sourceSha256:'0'.repeat(64)},sha));
assert.throws(()=>api.plan(r,source,{...pack,casinoLogs:[{sourceId:'a2',text:'fake'}]},sha));
assert.throws(()=>api.plan(r,source,{...pack,rejectedEvents:[{...pack.rejectedEvents[0],decisionSourceId:'a2'}]},sha));
assert.throws(()=>api.plan(r,source,{...pack,rejectedEvents:[{...pack.rejectedEvents[0],decisionText:'fake'}]},sha));
assert.throws(()=>api.plan(u,source,{...pack,rejectedEvents:[{...pack.rejectedEvents[0],decisionText:'拒絕'}]},sha));
const legacy={...pack,version:1,pilotMessages:[{sourceId:'a2',text:'今天吃飯'}]};for(const k of ['casinoLogs','realChatLogs','rejectedEvents'])delete legacy[k];
const old=api.plan(u,source,legacy,sha).updated;for(const k of ['casinoLogs','realChatLogs','rejectedEvents'])assert.deepEqual(old[k],u[k]);
const files=exporter.plan([u],[{id:r.world,name:'哨嚮'}]);const names=[...files.keys()];
assert.ok(['08a・賭場','08b・現實聊天','08c・我拒絕的事件'].every(k=>names.some(n=>n.includes(k))));assert.ok(!names.some(n=>n.includes('undefined')));
console.log('predecessor-import-v2 regression passed');
