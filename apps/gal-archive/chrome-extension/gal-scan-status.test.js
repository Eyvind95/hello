'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {installGalScanStatus}=require('./gal-scan-status.js');
const id='gal-archive-extension-test';
const A='https://www.whif.io/chat/34677088-588c-48e7-a1be-44c405c82e70';
const B='https://www.whif.io/chat/5f7cca07-d00f-4c04-b1bf-6ba1567d5bf8';
const CYCLE_A='a20b0ddc-2a88-41a5-a980-b81c4f988816';
const CYCLE_B='4bcc0766-bd33-4ff2-aa46-74f14fd90f16';
const RUN1='11111111-1111-4111-8111-111111111111';
const RUN2='22222222-2222-4222-8222-222222222222';
const RUN3='33333333-3333-4333-8333-333333333333';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function harness(){
 const store={galProfilesByPage:{[A]:{cycleId:CYCLE_A,cycleTitle:'第5輪迴'},
  [B]:{cycleId:CYCLE_B,cycleTitle:'第9周目'}}};
 const items=[],shown=[],events={};
 let seq=1,listen,interrupt,alarm,updated,removed,changed;
 const api={
  runtime:{
   id,getURL:s=>'chrome-extension://'+id+'/'+s,getManifest:()=>({version:'0.8.38'}),
   getContexts:async()=>[{}],sendMessage:async v=>
    v.type==='gal-run-blob-create'?'blob:chrome-extension://'+id+'/'+items.length:true,
   onMessage:{addListener:f=>listen=f},onStartup:{addListener:f=>interrupt=f},
   onInstalled:{addListener:f=>events.installed=f}
  },
  storage:{local:{
   get:async key=>typeof key==='string'?{[key]:structuredClone(store[key])}:structuredClone(store),
   set:async x=>Object.assign(store,structuredClone(x))
  }},
  alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:f=>alarm=f}},
  offscreen:{createDocument:async()=>{}},
  tabs:{
   sendMessage:async()=>null,
   onUpdated:{addListener:f=>updated=f},onRemoved:{addListener:f=>removed=f}
  },
  downloads:{
   download:async o=>{
    const filename='C:/Users/Temp/Downloads/'+o.filename;
    const previous=items.filter(x=>x.filename===filename&&o.conflictAction==='overwrite');
    const item={id:seq++,state:'complete',filename,url:o.url,
     byExtensionId:id,options:o,replaces:previous.length};
    items.push(item);return item.id;
   },
   search:async ({id})=>items.filter(x=>x.id===id),
   show:async n=>{shown.push(n)},
   cancel:async()=>{},
   onChanged:{addListener:f=>changed=f}
  }
 };
 const helpers=installGalScanStatus(api);
 const sender=(src=A,tab=17)=>({id,frameId:0,documentId:'document-'+tab,tab:{id:tab},url:src});
 async function dispatch(message,from=sender()){
  return new Promise(resolve=>{
   assert.equal(listen(message,from,resolve),true,'listener must accept scan message');
  });
 }
 const start=(runId=RUN1,scope='full',from=sender())=>dispatch({
  type:'gal-run-start',scanRunId:runId,cycleId:from.url===B?CYCLE_B:CYCLE_A,
  scope,scannerVersion:'0.8.38'},from);
 const diag=(runId=RUN1,from=sender())=>JSON.stringify({
  scanRunId:runId,cycleId:from.url===B?CYCLE_B:CYCLE_A,
  error:'第 230 則 native-text-mismatch',errorContexts:[{scanIndex:229}]
 });
 const unverified=(runId=RUN1,from=sender(),length=3)=>JSON.stringify({
  format:'gal-ai-unverified-scan',importable:false,validated:false,
  scanRunId:runId,target:{cycleId:from.url===B?CYCLE_B:CYCLE_A},
  collectedCount:length,rows:Array.from({length},(_,i)=>({
   scanIndex:i,role:i%2?'me':'ai',domText:'無損原文 '+i,nativeText:'原生文字 '+i
  }))
 });
 const result=(runId=RUN1,from=sender(),scope='full',count=4)=>JSON.stringify({
  scanRunId:runId,target:{cycleId:from.url===B?CYCLE_B:CYCLE_A},
  source:{url:from.url},
  scope:scope==='preview'?'opening-first-pair-preview':'entire-opening-to-bottom',
  validation:{ok:true,pairs:1,autoContinues:0},
  rawRows:count,messages:[{role:'me'},{role:'ai'}],events:[]
 });
 const finish=(state='completed',runId=RUN1,from=sender(),scope='full',count=4)=>dispatch({
  type:'gal-run-finish',scanRunId:runId,cycleId:from.url===B?CYCLE_B:CYCLE_A,
  state,scanned:count,result:state==='completed'?result(runId,from,scope,count):undefined,
  unverified:state==='completed'?undefined:unverified(runId,from,count),
  diagnostic:diag(runId,from),reason:state==='completed'?undefined:'validation failed'
 },from);
 const statuses=()=>items.filter(x=>x.filename.endsWith('/掃描狀態.json'));
 return {store,items,shown,start,finish,dispatch,sender,diag,unverified,result,statuses,helpers,
  install:async()=>{events.installed();for(let i=0;i<6;i++)await new Promise(ok=>setImmediate(ok))},
  alarm:async name=>{alarm({name});for(let i=0;i<6;i++)await new Promise(ok=>setImmediate(ok))},
  liveStatus(runId=RUN1){return store.galScanRuns[runId]}};
}
test('Taiwan batch paths are unique, frozen, sanitized and support special cycle names',()=>{
 const h=harness();
 const batch=h.helpers.batchPath;
 const a=batch('第9周目',CYCLE_B,'full','2026-11-24T08:31:29.000Z',RUN1);
 assert.equal(a,'GalArchive/第09輪迴/完整掃描/2026-11-24_16-31-29_'+RUN1);
 assert.equal(batch('第9周目',CYCLE_B,'full','2026-11-24T08:31:29.000Z',RUN2)
  .split('/').slice(-1)[0].endsWith(RUN2),true);
 assert.match(batch('支線／洛恩',CYCLE_A,'event-three','2026-11-24T08:31:29.000Z',RUN1),
  /GalArchive\/自訂_支線_洛恩_a20b0ddc\/事件三則測試\//);
 assert.equal(batch('第3輪迴',CYCLE_A,'preview','2026-11-24T08:31:29.000Z',RUN1)
  .split('/')[2],'三則測試');
 assert.equal(batch('第3輪迴',CYCLE_A,'position-seven','2026-11-24T08:31:29.000Z',RUN1)
  .split('/')[2],'指定位置測試');
 assert.equal(batch('第3輪迴',CYCLE_A,'missing','2026-11-24T08:31:29.000Z',RUN1)
  .split('/')[2],'缺漏診斷');
});
test('three same-day full scans get distinct batch folders and one status filename each',async()=>{
 const h=harness();
 for(const runId of [RUN1,RUN2,RUN3]){
  assert.equal((await h.start(runId)).ok,true);
  assert.equal((await h.finish('completed',runId)).ok,true);
 }
 const paths=[RUN1,RUN2,RUN3].map(x=>h.liveStatus(x).batchFolder);
 assert.equal(new Set(paths).size,3);
 assert.ok(paths.every(x=>x.includes('第05輪迴/完整掃描/')));
 assert.equal(new Set(h.statuses().map(x=>x.filename)).size,3);
 assert.equal(h.statuses().length,6);
 assert.equal(h.items.filter(x=>x.filename.endsWith('原生正史.json')).length,3);
 assert.ok(h.items.every(x=>!/\(\d+\)\.json$/.test(x.filename)));
});
test('independent cycles cannot cross-pollute source, ID, folder or status',async()=>{
 const h=harness(),b=h.sender(B,29);
 await h.start(RUN1);await h.start(RUN2,'full',b);
 await h.finish('failed',RUN2,b,'full',3);await h.finish('completed',RUN1);
 assert.match(h.liveStatus(RUN2).batchFolder,/第09輪迴\/完整掃描/);
 assert.match(h.liveStatus(RUN1).batchFolder,/第05輪迴\/完整掃描/);
 assert.equal(h.liveStatus(RUN1).state,'completed');
 assert.equal(h.liveStatus(RUN2).state,'failed');
 assert.equal(h.liveStatus(RUN2).files.unverified.path.endsWith('未驗證掃描資料.json'),true);
});
test('same cycle different tools separate folders and kinds',async()=>{
 const h=harness();
 for(const [run,scope] of [[RUN1,'preview'],[RUN2,'event-three'],[RUN3,'position-seven']]){
  await h.start(run,scope);
  if(scope==='preview')await h.finish('completed',run,h.sender(),scope);
  else{
   const r=JSON.stringify({scanRunId:run,target:{cycleId:CYCLE_A},source:{url:A},
    format:scope==='event-three'?'gal-ai-event-three-row-test':'gal-ai-position-seven-test',
    rows:[{role:'ai'}],importable:false});
   const res=await h.dispatch({type:'gal-run-finish',scanRunId:run,cycleId:CYCLE_A,
    state:'completed',scanned:1,result:r,diagnostic:h.diag(run)});
   assert.equal(res.ok,true,JSON.stringify(res));
  }
 }
 assert.match(h.liveStatus(RUN1).batchFolder,/三則測試/);
 assert.match(h.liveStatus(RUN2).batchFolder,/事件三則測試/);
 assert.match(h.liveStatus(RUN3).batchFolder,/指定位置測試/);
 assert.ok(h.items.some(i=>i.filename.endsWith('事件三則測試.json')));
 assert.ok(h.items.some(i=>i.filename.endsWith('指定位置測試.json')));
});
test('a scan crossing Taiwan midnight still uses its original batch path',async()=>{
 const h=harness();await h.start();
 const path=h.liveStatus().batchFolder;
 assert.equal((await h.dispatch({type:'gal-run-progress',scanRunId:RUN1,
  cycleId:CYCLE_A,scanned:123})).ok,true);
 await h.finish('failed',RUN1,h.sender(),'full',123);
 assert.equal(h.liveStatus().batchFolder,path);
 assert.ok(h.items.every(x=>!x.filename.includes('failed_')));
 assert.equal(h.liveStatus().scanned,123);
});
test('validation failure downloads exact raw 382 rows and diagnostic, but never formal result',async()=>{
 const h=harness();await h.start();
 const end=await h.finish('failed',RUN1,h.sender(),'full',382);
 assert.equal(end.ok,true,JSON.stringify(end));
 assert.equal(end.status.state,'failed');
 assert.equal(end.status.scanned,382);
 assert.equal(end.status.files.unverified.endsWith('未驗證掃描資料.json'),true);
 assert.equal(end.status.files.diagnostic.endsWith('掃描診斷.json'),true);
 assert.ok(!end.status.files.result);
 assert.equal(h.items.filter(x=>x.filename.endsWith('原生正史.json')).length,0);
 assert.equal(end.status.statusPath.endsWith('掃描狀態.json'),true);
});
test('manual evidence saving during scan does not stop work or lose final evidence',async()=>{
 const h=harness();await h.start();
 const saved=await h.dispatch({type:'gal-run-manual-save',scanRunId:RUN1,
  cycleId:CYCLE_A,unverified:h.unverified()});
 assert.equal(saved.ok,true,JSON.stringify(saved));
 assert.equal(saved.status.state,'running');
 assert.equal(saved.status.scanned,3);
 assert.ok(saved.status.files.unverified);
 const final=await h.finish('failed',RUN1,h.sender(),'full',3);
 assert.equal(final.status.state,'failed');
 assert.ok(final.status.files.unverified);
 assert.equal(h.statuses().length,3);
});
test('same frozen scan status has monotonic progress and only one final filename',async()=>{
 const h=harness();await h.start();
 assert.equal((await h.dispatch({type:'gal-run-progress',scanRunId:RUN1,
  cycleId:CYCLE_A,scanned:250})).ok,true);
 assert.equal((await h.dispatch({type:'gal-run-progress',scanRunId:RUN1,
  cycleId:CYCLE_A,scanned:180})).ok,false);
 const ok=await h.finish('failed',RUN1,h.sender(),'full',382);
 assert.equal(ok.status.scanned,382);
 assert.equal(h.statuses().length,3);
 assert.equal(new Set(h.statuses().map(x=>x.filename)).size,1);
 const terminal=JSON.parse(decodeURIComponent(h.statuses().at(-1).url.split(',')[1]));
 assert.equal(terminal.state,'failed');assert.equal(terminal.scanned,382);
 assert.equal(terminal.files.unverified.endsWith('未驗證掃描資料.json'),true);
});
test('interruption on reload retains frozen batch and records terminal failure',async()=>{
 const h=harness();await h.start();const path=h.liveStatus().batchFolder;
 await h.install();
 assert.equal(h.liveStatus().state,'failed');
 assert.equal(h.liveStatus().batchFolder,path);
 assert.ok(h.statuses().at(-1).filename.includes(path));
});
test('unverified file cannot be represented as a completed authoritative scan',async()=>{
 const h=harness();await h.start();
 const request={type:'gal-run-finish',scanRunId:RUN1,cycleId:CYCLE_A,
  state:'completed',scanned:3,diagnostic:h.diag(),
  result:h.unverified()};
 const out=await h.dispatch(request);
 assert.equal(out.ok,false);
 assert.equal(h.liveStatus().state,'running');
 const web=fs.readFileSync(require.resolve('../index.html'),'utf8');
 assert.match(web,/format!=='gal-ai-authoritative-scan'/);
 assert.match(web,/scope!=='entire-opening-to-bottom'/);
});
test('scan script includes original text, native text, 3+3 context, and source-anchored seven rows',()=>{
 const s=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
 for(const q of ['gal-ai-unverified-scan','importable:false','nativeText:',
  'nativeUnavailableReason:','nativeParsedTime:','cascadePossible:',
  'errorContexts=failureContexts(','scanIndex+4','positionSevenProbe(',
  'selectedSourceId:sourceId','matches.length!==1','gal-run-manual-save',
  'gal-scan-emergency-snapshot'])assert.ok(s.includes(q),q);
});
