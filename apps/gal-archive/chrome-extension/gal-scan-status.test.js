'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const code=fs.readFileSync(require.resolve('./gal-scan-status.js'),'utf8');

function harness(){
 const id='gal-archive-extension-test';
 const source='https://www.whif.io/chat/34677088-588c-48e7-a1be-44c405c82e70';
 const cycleId='a20b0ddc-2a88-41a5-a980-b81c4f988816';
 const sender={id,tab:{id:17},frameId:0,documentId:'whif-document-1',url:source};
 const store={galProfilesByPage:{[source]:{cycleId,cycleTitle:'第5輪迴'}}};
 const alarms=[],downloads=[];
 let messageListener=null,alarmListener=null;
 let downloadId=1;
 const api={
  runtime:{
   id,getURL:value=>'chrome-extension://'+id+'/'+value,
   getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
   sendMessage:async req=>{
    if(req.type==='gal-run-blob-create')return 'blob:chrome-extension://'+id+'/'+downloads.length;
    if(req.type==='gal-run-blob-release')return true;
    return null;
   },
   onMessage:{addListener:fn=>messageListener=fn},
   onStartup:{addListener:()=>{}},
   onInstalled:{addListener:()=>{}}
  },
  storage:{local:{
   get:async key=>typeof key==='string'?{[key]:structuredClone(store[key])}:structuredClone(store),
   set:async value=>Object.assign(store,structuredClone(value))
  }},
  alarms:{
   create:async (name,details)=>{alarms.push({name,details})},
   clear:async()=>true,
   onAlarm:{addListener:fn=>alarmListener=fn}
  },
  offscreen:{createDocument:async()=>{}},
  downloads:{
   download:async options=>{
    const item={id:downloadId++,state:'complete',url:options.url,
     byExtensionId:id,filename:'C:/Downloads/GalArchive/'+options.filename.split('/').at(-1)};
    downloads.push(item);return item.id;
   },
   search:async ({id})=>downloads.filter(d=>d.id===id),
   cancel:async()=>{},
   onChanged:{addListener:()=>{}}
  },
  tabs:{
   sendMessage:async()=>({scanRunId:'',busy:true}),
   onUpdated:{addListener:()=>{}},
   onRemoved:{addListener:()=>{}}
  }
 };
 const box=vm.createContext({URL,TextEncoder,Date,console});
 vm.runInContext(code+'\nthis.installer=installGalScanStatus',box);
 box.installer(api);
 async function dispatch(payload){
  assert.equal(typeof messageListener,'function');
  return new Promise(resolve=>{
   const accepted=messageListener(payload,sender,reply=>resolve(reply));
   assert.equal(accepted,true);
  });
 }
 const runId='11111111-1111-4111-8111-111111111111';
 const nextId='22222222-2222-4222-8222-222222222222';
 const complete=(id=runId)=>({
  type:'gal-run-finish',scanRunId:id,cycleId,state:'completed',scanned:4,
  result:JSON.stringify({scanRunId:id,target:{cycleId},source:{url:source},
   scope:'entire-opening-to-bottom',validation:{ok:true,pairs:1},
   rawRows:4,messages:[{role:'me'},{role:'ai'}],events:[]}),
  diagnostic:JSON.stringify({scanRunId:id,cycleId})
 });
 const start=(id=runId,scope='full')=>dispatch({type:'gal-run-start',scanRunId:id,cycleId,scope});
 const expire=async(id=runId)=>{
  alarmListener({name:'gal-scan-deadline:'+id});
  for(let k=0;k<5;k++)await new Promise(resolve=>setImmediate(resolve));
 };
 return {start,expire,dispatch,complete,runId,nextId,alarms,downloads,store,sender,source,cycleId};
}

test('full scan uses a four-hour background allowance but three-row preview retains 45 minutes',async()=>{
 const h=harness();
 const full=await h.start();
 assert.equal(full.ok,true);
 assert.equal(full.status.state,'running');
 assert.equal(full.status.deadlineMinutes,240);
 assert.equal(h.alarms[0].details.delayInMinutes,240);
 const p=harness();
 const prev=await p.start(p.runId,'preview');
 assert.equal(prev.ok,true);
 assert.equal(prev.status.deadlineMinutes,45);
 assert.equal(p.alarms[0].details.delayInMinutes,45);
});

test('same WHIF document can safely complete after deadline with full source-bound result and diagnostic',async()=>{
 const h=harness();
 await h.start();
 await h.expire();
 assert.equal(h.store.galScanRuns[h.runId].state,'failed');
 assert.equal(h.store.galScanRuns[h.runId].reason,'掃描或下載逾時');
 const recovered=await h.dispatch(h.complete());
 assert.equal(recovered.ok,true,JSON.stringify(recovered));
 assert.equal(recovered.status.state,'completed');
 assert.equal(recovered.status.lateCompletionRecovered,true);
 assert.equal(h.store.galScanRuns[h.runId].state,'completed');
 assert.ok(h.store.galScanRuns[h.runId].files.result.path);
 assert.ok(h.store.galScanRuns[h.runId].files.diagnostic.path);
 assert.equal(h.alarms.at(-1).details.delayInMinutes,15);
 assert.equal(h.downloads.filter(d=>d.filename.includes('原生正史_')).length,1);
});

test('cannot revive an old timed-out run after a newer scan has started on the same chat',async()=>{
 const h=harness();
 await h.start();
 await h.expire();
 const next=await h.start(h.nextId);
 assert.equal(next.ok,true);
 const old=await h.dispatch(h.complete());
 assert.equal(old.ok,true);
 assert.equal(old.status.state,'failed');
 assert.equal(h.store.galScanRuns[h.runId].state,'failed');
 assert.equal(h.store.galScanRuns[h.nextId].state,'running');
});

test('late recovery rejects forged cycle, source, run ID, and invalid source validation',async()=>{
 const changes=[
  value=>{value.scanRunId='33333333-3333-4333-8333-333333333333'},
  value=>{value.target.cycleId='wrong-cycle'},
  value=>{value.source.url='https://www.whif.io/chat/other'},
  value=>{value.validation.ok=false},
  value=>{value.rawRows=3}
 ];
 for(const modify of changes){
  const h=harness();await h.start();await h.expire();
  const request=h.complete();
  const result=JSON.parse(request.result);modify(result);request.result=JSON.stringify(result);
  const failed=await h.dispatch(request);
  assert.equal(failed.ok,false,modify.toString());
  assert.equal(h.store.galScanRuns[h.runId].state,'failed');
 }
});

test('in-page recovery button exports an explicitly non-importable checkpoint independently of worker',()=>{
 const scanner=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
 assert.match(scanner,/id="gal-scan-save-progress"/);
 assert.match(scanner,/function saveProgressSnapshot\(\)/);
 assert.match(scanner,/format:'gal-ai-incomplete-scan-checkpoint'/);
 assert.match(scanner,/scope:'unverified-partial-progress',importable:false/);
 assert.match(scanner,/complete:false,validated:false/);
 assert.match(scanner,/activeScanRows=collected/);
 assert.match(scanner,/sourceMessageId:row\.formatSource\?\.nativeReply\?\.messageId/);
 assert.match(scanner,/if\(lastResult\?\.validation\?\.ok\)exportButton\.disabled=false/);
 assert.match(scanner,/if\(!lastResult\|\|!lastResult\.validation\?\.ok\)return/);
});
