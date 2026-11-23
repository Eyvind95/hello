'use strict';
function installGalScanStatus(api){
 const storageKey='galScanRuns',alarmPrefix='gal-scan-deadline:';
 const terminal=new Set(['completed','paused','failed','cancelled']);
 const folder='GalArchive';
 const offscreenUrl=api.runtime.getURL('gal-scan-files.html');
 const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{5,160}$/.test(value);
 const validRunId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
 const time=()=>new Date().toISOString();
 let queue=Promise.resolve();
 const enqueued=operation=>{
  const result=queue.then(operation);
  queue=result.catch(error=>console.warn('Gal scan status:',error.message));
  return result;
 };
 const read=async()=>(await api.storage.local.get(storageKey))[storageKey]||{};
 const save=runs=>api.storage.local.set({[storageKey]:runs});
 function source(url){
  try{
   const parsed=new URL(url);
   if(parsed.protocol==='https:'&&['whif.io','www.whif.io'].includes(parsed.hostname)&&
      /^\/chat\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname))
    return parsed.origin+parsed.pathname.replace(/\/$/,'');
  }catch{ /* A missing tab or URL has no WHIF source. */ }
  return null;
 }
 function record(runs,run,change){
  const next={...run,...change,at:time()};
  runs[run.scanRunId]=next;
  return next;
 }
 const publicStatus=run=>({
  format:'gal-archive-scan-status',version:1,scanRunId:run.scanRunId,cycleId:run.cycleId,
  state:run.state,at:run.at,startedAt:run.startedAt,scope:run.scope,scanned:run.scanned,source:run.source,
  reason:run.reason,summary:run.summary,
  files:Object.fromEntries(Object.entries(run.files||{}).filter(([,file])=>file.path).map(([kind,file])=>[kind,file.path]))
 });
 async function signal(run){
  const text=JSON.stringify(publicStatus(run));
  await api.downloads.download({
   url:'data:application/json;charset=utf-8,'+encodeURIComponent(text),
   filename:folder+'/status-'+run.scanRunId+'-'+run.state+'.json',saveAs:false,conflictAction:'overwrite'
  });
 }
 async function stop(runs,run,state,reason){
  if(terminal.has(run.state))return;
  const next=record(runs,run,{state,reason,exportPending:false});
  await save(runs);
  await api.alarms.clear(alarmPrefix+run.scanRunId);
  for(const file of Object.values(run.files||{})){
   if(!file.path)await api.downloads.cancel(file.id).catch(()=>{});
   await api.runtime.sendMessage({type:'gal-run-blob-release',url:file.url}).catch(()=>{});
  }
  await signal(next);
  await api.tabs.sendMessage(next.tabId,{type:'gal-run-page-status',status:publicStatus(next)},
   {documentId:next.documentId}).catch(()=>{});
 }
 async function startFile(run,kind,text){
  if(typeof text!=='string'||!text||new TextEncoder().encode(text).length>40*1024*1024)
   throw Error('掃描檔不存在或大於 40 MiB');
  if(!(await api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[offscreenUrl]})).length)
   await api.offscreen.createDocument({url:'gal-scan-files.html',reasons:['BLOBS'],justification:'Write Gal AI scan JSON locally via Chrome Downloads'});
  const url=await api.runtime.sendMessage({type:'gal-run-blob-create',text});
  if(typeof url!=='string'||!url.startsWith('blob:'+api.runtime.getURL('')))throw Error('無法建立擴充功能下載檔案');
  try{
   const id=await api.downloads.download({url,filename:folder+'/'+kind+'-'+run.scanRunId+'.json',
    saveAs:false,conflictAction:'uniquify'});
   return {id,url};
  }catch(error){
   await api.runtime.sendMessage({type:'gal-run-blob-release',url}).catch(()=>{});
   throw error;
  }
 }
 async function reconcile(runs,run){
  if(run.state!=='running'||!run.exportPending)return;
  const files=run.files;
  for(const file of Object.values(files)){
   if(file.path)continue;
   const [item]=await api.downloads.search({id:file.id});
   if(!item||item.url!==file.url||item.byExtensionId!==api.runtime.id||item.state==='interrupted'){
    await stop(runs,run,'failed','Chrome 下載中斷或無法核對下載來源');
    return;
   }
   if(item.state==='complete')file.path=item.filename;
  }
  if(!Object.values(files).every(file=>file.path)){await save(runs);return}
  await stop(runs,run,run.finishState,run.reason);
 }
 function isOwner(run,sender){
  return run&&run.tabId===sender.tab?.id&&run.documentId===sender.documentId&&run.source===source(sender.url);
 }
 async function handle(message,sender){
  if(sender.id!==api.runtime.id)throw Error('未核對的擴充功能來源');
  const runs=await read(),run=runs[message.scanRunId];
  if(message.type==='gal-run-query'){
   if(sender.tab||sender.url!==api.runtime.getURL('gal-popup.html'))throw Error('無法查詢掃描');
   const match=run||(!message.scanRunId&&Object.values(runs).filter(candidate=>
    candidate.source===source(message.source)&&candidate.cycleId===message.cycleId).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0]);
   if(match?.state==='running'&&!match.exportPending){
    const page=await api.tabs.sendMessage(match.tabId,{type:'gal-scan-ping'},{documentId:match.documentId})
     .catch(()=>null);
    if(page?.scanRunId!==match.scanRunId||!page.busy)
     await stop(runs,match,'failed','掃描所在的分頁或擴充功能已中斷');
   }
   return match?publicStatus(runs[match.scanRunId]):{state:'idle',scanRunId:null,cycleId:message.cycleId,at:time(),scanned:0};
  }
  const tabSource=source(sender.url);
  if(!tabSource||!Number.isInteger(sender.tab?.id)||sender.frameId!==0||!sender.documentId||
     !validId(message.cycleId)||!validRunId(message.scanRunId))
   throw Error('掃描來源、輪迴或工作 ID 無效');
  if(message.type==='gal-run-start'){
   if(run||Object.values(runs).some(candidate=>candidate.state==='running'&&
      (candidate.tabId===sender.tab.id||candidate.source===tabSource)))
    throw Error('已有掃描工作正在執行');
   const bindings=(await api.storage.local.get('galProfilesByPage')).galProfilesByPage||{};
   if(bindings[tabSource]?.cycleId!==message.cycleId)throw Error('掃描輪迴與頁面綁定不一致');
   if(!['full','preview'].includes(message.scope))throw Error('掃描範圍無效');
   const next=record(runs,{scanRunId:message.scanRunId,cycleId:message.cycleId,tabId:sender.tab.id,
    documentId:sender.documentId,source:tabSource,scope:message.scope,startedAt:time(),scanned:0},{state:'running'});
   const old=Object.values(runs).filter(candidate=>terminal.has(candidate.state))
    .sort((a,b)=>b.at.localeCompare(a.at)).slice(79);
   for(const candidate of old)delete runs[candidate.scanRunId];
   await save(runs);
   await api.alarms.create(alarmPrefix+next.scanRunId,{delayInMinutes:45});
   try{await signal(next)}catch(error){await stop(runs,next,'failed','無法啟動掃描狀態檔下載');throw error}
   return publicStatus(next);
  }
  if(!isOwner(run,sender)||run.cycleId!==message.cycleId)throw Error('掃描工作 ID 不屬於目前分頁');
  if(message.type!=='gal-run-finish')throw Error('未知掃描訊號');
  if(terminal.has(run.state)||run.exportPending)return publicStatus(run);
  if(!terminal.has(message.state)||!Number.isInteger(message.scanned)||message.scanned<0||message.scanned>20000)
   throw Error('掃描狀態無效');
  const next=record(runs,run,{finishState:message.state,scanned:message.scanned,
   reason:message.state==='completed'?undefined:String(message.reason||'掃描中斷').slice(0,350),
   exportPending:true,files:{}});
  await save(runs);
  try{
   const diagnostic=JSON.parse(message.diagnostic);
   if(diagnostic.scanRunId!==run.scanRunId||diagnostic.cycleId!==run.cycleId)throw Error('診斷與掃描工作不符');
   if(message.state==='completed'){
    const result=JSON.parse(message.result);
    if(result.scanRunId!==run.scanRunId||result.target?.cycleId!==run.cycleId||
       source(result.source?.url)!==run.source||result.validation?.ok!==true||
       result.scope!==(run.scope==='full'?'entire-opening-to-bottom':'opening-first-pair-preview')||
       result.rawRows!==message.scanned)
     throw Error('掃描結果未通過工作 ID、來源或完整性核對');
    next.summary={messages:result.messages.length,pairs:result.validation.pairs,events:result.events.length,
     autoContinues:result.validation.autoContinues||0};
    next.files.result=await startFile(run,'result',message.result);
    await save(runs);
   }
   next.files.diagnostic=await startFile(run,'diagnostic',message.diagnostic);
   await save(runs);
   await reconcile(runs,next);
  }catch(error){await stop(runs,next,'failed',error.message);throw error}
  return publicStatus(runs[run.scanRunId]);
 }
 api.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['gal-run-query','gal-run-start','gal-run-finish'].includes(message?.type))return false;
  enqueued(()=>handle(message,sender)).then(status=>reply({ok:true,status}),error=>reply({ok:false,error:error.message}));
  return true;
 });
 api.downloads.onChanged.addListener(delta=>{
  if(!delta.state)return;
  enqueued(async()=>{
   const runs=await read();
   const run=Object.values(runs).find(candidate=>candidate.exportPending&&Object.values(candidate.files)
    .some(file=>file.id===delta.id));
   if(run)await reconcile(runs,run);
  });
 });
 function interrupt(predicate,reason){
  enqueued(async()=>{
   const runs=await read();
   for(const run of Object.values(runs).filter(candidate=>candidate.state==='running'&&predicate(candidate)))
    await stop(runs,run,'failed',reason);
  });
 }
 api.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.status==='loading'||change.url)interrupt(run=>run.tabId===tabId&&!run.exportPending,'掃描頁面已重新載入或離開');
 });
 api.tabs.onRemoved.addListener(tabId=>interrupt(run=>run.tabId===tabId&&!run.exportPending,'掃描分頁已關閉'));
 api.runtime.onStartup.addListener(()=>interrupt(()=>true,'Chrome 已重新啟動，前次掃描中斷'));
 api.runtime.onInstalled.addListener(()=>interrupt(()=>true,'擴充功能已重新載入，前次掃描中斷'));
 api.alarms.onAlarm.addListener(alarm=>interrupt(run=>alarm.name===alarmPrefix+run.scanRunId,'掃描或下載逾時'));
}