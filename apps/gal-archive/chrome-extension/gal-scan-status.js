'use strict';
/* WHIF batch downloads. All paths are frozen at registration; never
 * use the current date to determine a later file's destination. */
function installGalScanStatus(api){
 const KEY='galScanRuns',ALARM='gal-scan-deadline:';
 const DEADLINE={full:240,preview:45,'event-three':45,'position-seven':45,missing:45};
 const EXPORT_DEADLINE=15;
 const terminal=new Set(['completed','failed','paused','cancelled']);
 const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{5,160}$/.test(x);
 const uuidOk=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
 const now=()=>new Date().toISOString();
 const timestamp=iso=>new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,19).replace('T','_').replace(/:/g,'-');
 const clean=x=>String(x||'').trim().replace(/[\\/／＼:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').replace(/[. ]+$/g,'').slice(0,75);
 function cycleFolder(title,cycleId){
  const n=String(title||'').match(/^第\s*(\d{1,4})\s*(?:周目|週目|輪迴)/u);
  return n?'第'+String(+n[1]).padStart(2,'0')+'輪迴':
   '自訂_'+(clean(title)||'未命名輪迴')+'_'+String(cycleId).slice(0,8);
 }
 const typeFolder={full:'完整掃描',preview:'三則測試','event-three':'事件三則測試',
  'position-seven':'指定位置測試',missing:'缺漏診斷'};
 function batchPath(title,cycleId,scope,startedAt,scanRunId){
  if(!idOk(cycleId)||!uuidOk(scanRunId)||!typeFolder[scope])throw Error('批次綁定無效');
  return 'GalArchive/'+cycleFolder(title,cycleId)+'/'+typeFolder[scope]+'/'+timestamp(startedAt)+'_'+scanRunId;
 }
 const filenames={status:'掃描狀態.json',diagnostic:'掃描診斷.json',result:'原生正史.json',
  unverified:'未驗證掃描資料.json',eventResult:'事件三則測試.json',
  positionResult:'指定位置測試.json',missingResult:'缺漏診斷.json'};
 const offscreenUrl=api.runtime.getURL('gal-scan-files.html');
 let queue=Promise.resolve();
 function serial(fn){const p=queue.then(fn);queue=p.catch(error=>console.warn('Gal batch:',error.message));return p}
 const read=async()=>((await api.storage.local.get(KEY))[KEY]||{});
 const save=runs=>api.storage.local.set({[KEY]:runs});
 const safeUrl=href=>{
  try{const u=new URL(href);
   if(u.protocol==='https:'&&['whif.io','www.whif.io'].includes(u.hostname)&&
      /^\/chat\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return u.origin+u.pathname.replace(/\/$/,'');
  }catch{}return null;
 };
 function publicStatus(run){
  return {format:'gal-archive-scan-status',version:2,
   scanRunId:run.scanRunId,cycleId:run.cycleId,cycleTitle:run.cycleTitle,
   scannerVersion:run.scannerVersion||null,state:run.state,startedAt:run.startedAt,
   endedAt:run.endedAt||null,at:run.at,scope:run.scope,scanned:run.scanned,
   source:run.source,deadlineMinutes:run.deadlineMinutes,
   lateCompletionRecovered:run.lateCompletionRecovered||false,
   reason:run.reason||null,summary:run.summary||null,
   batchFolder:run.batchFolder,
   statusPath:run.statusPath||run.batchFolder+'/'+filenames.status,
   files:Object.fromEntries(Object.entries(run.files||{}).filter(([,f])=>f.path)
    .map(([k,f])=>[k,f.path])),
   pendingFiles:Object.entries(run.files||{}).filter(([,f])=>!f.path).map(([kind])=>kind)
  };
 }
 function record(runs,run,change){
  const r={...run,...change,at:now()};runs[run.scanRunId]=r;return r;
 }
 const snooze=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function confirmedDownload(id,limit=30){
  for(let i=0;i<limit;i++){
   const [item]=await api.downloads.search({id});
   if(item?.state==='complete'&&item.filename)return item.filename;
   if(!item||item.state==='interrupted')throw Error('Chrome 下載失敗：'+id);
   await snooze(250);
  }
  throw Error('Chrome 尚未確認下載完成：'+id);
 }
 async function signal(run){
  const filename=run.batchFolder+'/'+filenames.status;
  const payload=JSON.stringify(publicStatus(run),null,2);
  const id=await api.downloads.download({
   url:'data:application/json;charset=utf-8,'+encodeURIComponent(payload),
   filename,saveAs:false,conflictAction:'overwrite'
  });
  // Only this run's fixed status path is overwritten, never a historical batch.
  run.statusId=id;
  return confirmedDownload(id);
 }
 async function makeFile(run,kind,text){
  if(!filenames[kind]||kind==='status'||typeof text!=='string'||!text||
     new TextEncoder().encode(text).length>40*1024*1024)
   throw Error('輸出檔格式或大小不安全');
  if(!(await api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[offscreenUrl]})).length)
   await api.offscreen.createDocument({url:'gal-scan-files.html',reasons:['BLOBS'],justification:'Save raw Gal AI scan evidence'});
  const url=await api.runtime.sendMessage({type:'gal-run-blob-create',text});
  if(typeof url!=='string'||!url.startsWith('blob:'+api.runtime.getURL('')))throw Error('無法建立下載來源');
  try{
   const id=await api.downloads.download({url,filename:run.batchFolder+'/'+filenames[kind],
    saveAs:false,conflictAction:'overwrite'});
   return {id,url};
  }catch(error){
   await api.runtime.sendMessage({type:'gal-run-blob-release',url}).catch(()=>{});
   throw error;
  }
 }
 async function pendingFiles(runs,run){
  const files=run.files||{};
  for(const file of Object.values(files)){
   if(file.path)continue;
   const [item]=await api.downloads.search({id:file.id});
   if(!item||item.url!==file.url||item.byExtensionId!==api.runtime.id||item.state==='interrupted')
    throw Error('Chrome 下載來源無法核對或下載中斷');
   if(item.state==='complete')file.path=item.filename;
  }
  await save(runs);
  return Object.values(files).every(f=>f.path);
 }
 async function finish(runs,run,state,reason){
  if(terminal.has(run.state))return run;
  const next=record(runs,run,{state,reason:reason||null,
   endedAt:now(),exportPending:false});
  await save(runs);
  await api.alarms.clear(ALARM+run.scanRunId);
  for(const file of Object.values(next.files||{})){
   if(!file.path&&file.id)await api.downloads.cancel(file.id).catch(()=>{});
   if(file.url)await api.runtime.sendMessage({type:'gal-run-blob-release',url:file.url}).catch(()=>{});
  }
  try{
   const path=await signal(next);
   next.statusPath=path;await save(runs);
  }catch(error){
   // Actual download failure must not be reported as success.
   next.state='failed';next.reason='掃描狀態檔下載未完成：'+String(error.message||error);
   await save(runs);
  }
  await api.tabs.sendMessage(next.tabId,{type:'gal-run-page-status',status:publicStatus(next)},
   {documentId:next.documentId}).catch(()=>{});
  return next;
 }
 async function reconcile(runs,run){
  if(!run.exportPending||run.state!=='running')return;
  try{
   if(!(await pendingFiles(runs,run)))return;
   await finish(runs,run,run.finishState,run.reason);
  }catch(error){await finish(runs,run,'failed',String(error.message||error))}
 }
 const isOwner=(run,sender)=>Boolean(run&&run.tabId===sender.tab?.id&&
  run.documentId===sender.documentId&&run.source===safeUrl(sender.url));
 async function handle(message,sender){
  if(sender.id!==api.runtime.id)throw Error('未核對的擴充功能來源');
  const runs=await read();
  if(message.type==='gal-run-query'){
   if(sender.tab||sender.url!==api.runtime.getURL('gal-popup.html'))throw Error('只有擴充功能面板可查詢');
   const match=runs[message.scanRunId]||Object.values(runs).filter(r=>
    r.source===safeUrl(message.source)&&r.cycleId===message.cycleId)
    .sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
   if(match?.state==='running'&&!match.exportPending){
    const page=await api.tabs.sendMessage(match.tabId,{type:'gal-scan-ping'},
     {documentId:match.documentId}).catch(()=>null);
    if(!page?.busy||page.scanRunId!==match.scanRunId)
     await finish(runs,match,'failed','掃描分頁或擴充功能已中斷');
   }
   return match?publicStatus(runs[match.scanRunId]):{state:'idle',scanRunId:null,cycleId:message.cycleId,scanned:0};
  }
  const src=safeUrl(sender.url);
  if(!src||!Number.isInteger(sender.tab?.id)||sender.frameId!==0||!sender.documentId||
     !idOk(message.cycleId)||!uuidOk(message.scanRunId))
   throw Error('掃描來源或工作識別碼無效');
  if(message.type==='gal-run-start'){
   if(runs[message.scanRunId]||Object.values(runs).some(r=>r.state==='running'&&
    (r.tabId===sender.tab.id||r.source===src)))
    throw Error('同一來源已有掃描工作執行');
   if(!Object.hasOwn(DEADLINE,message.scope))throw Error('掃描類型不支援');
   const binding=((await api.storage.local.get('galProfilesByPage')).galProfilesByPage||{})[src];
   if(!binding||binding.cycleId!==message.cycleId)throw Error('WHIF 來源綁定不一致');
   const startedAt=now();
   const run=record(runs,{scanRunId:message.scanRunId,cycleId:message.cycleId,
    cycleTitle:String(binding.cycleTitle||'輪迴').slice(0,160),
    scannerVersion:String(message.scannerVersion||api.runtime.getManifest?.().version||''),
    tabId:sender.tab.id,documentId:sender.documentId,source:src,scope:message.scope,
    startedAt,endedAt:null,scanned:0,
    deadlineMinutes:DEADLINE[message.scope],batchFolder:batchPath(binding.cycleTitle,message.cycleId,
     message.scope,startedAt,message.scanRunId),files:{}},{state:'running'});
   const old=Object.values(runs).filter(r=>terminal.has(r.state))
    .sort((a,b)=>b.at.localeCompare(a.at)).slice(79);
   for(const entry of old)delete runs[entry.scanRunId];
   await save(runs);
   await api.alarms.create(ALARM+run.scanRunId,{delayInMinutes:run.deadlineMinutes});
   try{run.statusPath=await signal(run);await save(runs)}
   catch(error){await finish(runs,run,'failed','無法下載初始掃描狀態：'+String(error.message||error));
    throw error}
   return publicStatus(run);
  }
  const run=runs[message.scanRunId];
  if(!isOwner(run,sender)||run.cycleId!==message.cycleId)
   throw Error('工作不屬於這個 WHIF 分頁');
  if(message.type==='gal-run-progress'){
   if(run.state!=='running'||run.exportPending)return publicStatus(run);
   if(!Number.isInteger(message.scanned)||message.scanned<run.scanned||
      message.scanned>20000)throw Error('掃描進度不可倒退');
   run.scanned=message.scanned;
   run.at=now();await save(runs);
   run.statusPath=await signal(run);await save(runs);
   return publicStatus(run);
  }
  if(message.type==='gal-run-manual-save'){
   if(run.exportPending)throw Error('正在整理終態下載，請等下載完成再操作');
   const data=JSON.parse(message.unverified);
   if(data.format!=='gal-ai-unverified-scan'||data.importable!==false||
      data.scanRunId!==run.scanRunId||data.target?.cycleId!==run.cycleId||
      !Array.isArray(data.rows)||data.rows.length!==data.collectedCount)
    throw Error('手動已讀保全來源驗證失敗');
   if(run.files?.unverified?.path)return publicStatus(run);
   const file=await makeFile(run,'unverified',message.unverified);
   file.path=await confirmedDownload(file.id,80);
   run.files={...(run.files||{}),unverified:file};
   run.scanned=Math.max(run.scanned||0,data.collectedCount);
   await save(runs);
   // Status stays in this run's one fixed location.
   run.statusPath=await signal(run);await save(runs);
   return publicStatus(run);
  }
  if(message.type==='gal-run-open-folder'){
   const filename=run.files?.diagnostic?.path||run.files?.result?.path||
    run.files?.unverified?.path||run.statusPath;
   if(!filename)throw Error('此批次尚無已確認下載的檔案');
   await api.downloads.show(run.files?.diagnostic?.id||run.files?.result?.id||
    run.files?.unverified?.id||run.statusId);
   return publicStatus(run);
  }
  if(message.type!=='gal-run-finish')throw Error('未知掃描指令');
  const late=run.state==='failed'&&run.reason==='掃描或下載逾時'&&message.state==='completed'&&
   !Object.values(runs).some(r=>r.scanRunId!==run.scanRunId&&r.state==='running'&&r.source===run.source);
  if((terminal.has(run.state)&&!late)||run.exportPending)return publicStatus(run);
  if(!terminal.has(message.state)||!Number.isInteger(message.scanned)||
     message.scanned<0||message.scanned>20000||message.scanned<run.scanned)
    throw Error('終態掃描數不得小於已確認進度');
  const diagnostic=JSON.parse(message.diagnostic);
  if(diagnostic.scanRunId!==run.scanRunId||diagnostic.cycleId!==run.cycleId)throw Error('診斷來源不一致');
  let completedResult=null;
  if(message.state==='completed'){
   completedResult=JSON.parse(message.result);
   if(completedResult.scanRunId!==run.scanRunId||
      completedResult.target?.cycleId!==run.cycleId||
      safeUrl(completedResult.source?.url)!==run.source)
    throw Error('測試／正史輸出與工作來源不符');
   if(['full','preview'].includes(run.scope)){
    if(completedResult.validation?.ok!==true||
      completedResult.scope!==(run.scope==='full'?'entire-opening-to-bottom':'opening-first-pair-preview')||
      completedResult.rawRows!==message.scanned)
     throw Error('正式正史格式或完整性驗證不通過');
    if(run.scope==='full'){
     const previous=Object.values(runs).filter(r=>r.scanRunId!==run.scanRunId&&
       r.state==='completed'&&r.scope==='full'&&r.cycleId===run.cycleId&&r.source===run.source)
      .sort((a,b)=>b.scanned-a.scanned)[0];
     if(previous&&message.scanned<previous.scanned)
      throw Error('完整掃描 '+message.scanned+' 筆少於歷史已完成的 '+previous.scanned+' 筆');
    }
   }
  }
  const next=record(runs,run,{state:'running',lateCompletionRecovered:late,
   finishState:message.state,scanned:message.scanned,
   reason:message.state==='completed'?null:String(message.reason||'掃描中斷').slice(0,500),
   exportPending:true,files:{...(run.files||{})}});
  await save(runs);
  await api.alarms.create(ALARM+run.scanRunId,{delayInMinutes:EXPORT_DEADLINE});
  try{
   if(message.state==='completed'){
    next.summary={messages:completedResult.messages?.length||completedResult.rows?.length||0,
     pairs:completedResult.validation?.pairs||0,events:completedResult.events?.length||0,
     autoContinues:completedResult.validation?.autoContinues||0};
    const kind=run.scope==='event-three'?'eventResult':
     run.scope==='position-seven'?'positionResult':run.scope==='missing'?'missingResult':'result';
    next.files[kind]=await makeFile(run,kind,message.result);await save(runs);
   }else if(message.unverified){
    const data=JSON.parse(message.unverified);
    if(data.format!=='gal-ai-unverified-scan'||data.importable!==false||
       data.scanRunId!==run.scanRunId||data.target?.cycleId!==run.cycleId||
       !Array.isArray(data.rows)||data.rows.length!==message.scanned)
     throw Error('未驗證原生資料格式／工作 ID／數量不符');
    next.files.unverified=await makeFile(run,'unverified',message.unverified);await save(runs);
   }
   next.files.diagnostic=await makeFile(run,'diagnostic',message.diagnostic);await save(runs);
   await reconcile(runs,next);
  }catch(error){await finish(runs,next,'failed','儲存掃描證據失敗：'+String(error.message||error));throw error}
  return publicStatus(runs[run.scanRunId]);
 }
 api.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['gal-run-query','gal-run-start','gal-run-finish','gal-run-open-folder','gal-run-manual-save','gal-run-progress'].includes(message?.type))return false;
  serial(()=>handle(message,sender)).then(s=>reply({ok:true,status:s}),
   error=>reply({ok:false,error:String(error.message||error)}));
  return true;
 });
 api.downloads.onChanged.addListener(delta=>{
  if(!delta.state)return;
  serial(async()=>{
   const runs=await read();
   const run=Object.values(runs).find(r=>r.exportPending&&Object.values(r.files||{})
    .some(f=>f.id===delta.id));
   if(run)await reconcile(runs,run);
  });
 });
 function interrupt(predicate,reason){
  serial(async()=>{
   const runs=await read();
   for(const run of Object.values(runs).filter(r=>r.state==='running'&&predicate(r))){
    // If a page remains available, ask it to download its last snapshot
    // before Chrome terminates the run.
    const snapshot=await api.tabs.sendMessage(run.tabId,
     {type:'gal-scan-emergency-snapshot',reason},
     {documentId:run.documentId}).catch(()=>null);
    if(snapshot?.scanRunId===run.scanRunId&&
       Number.isInteger(snapshot.scanned)&&snapshot.scanned>=0&&snapshot.scanned<=20000&&
       typeof snapshot.diagnostic==='string'){
     try{
      const diag=JSON.parse(snapshot.diagnostic);
      if(diag.scanRunId===run.scanRunId&&diag.cycleId===run.cycleId){
       run.scanned=snapshot.scanned;run.files={};
       if(snapshot.unverified){
        const data=JSON.parse(snapshot.unverified);
        if(data.format==='gal-ai-unverified-scan'&&data.importable===false&&
         data.scanRunId===run.scanRunId&&data.rows?.length===run.scanned)
         run.files.unverified=await makeFile(run,'unverified',snapshot.unverified);
       }
       run.files.diagnostic=await makeFile(run,'diagnostic',snapshot.diagnostic);
       // Allow Chrome to confirm actual downloaded filenames.
       for(const file of Object.values(run.files)){
        file.path=await confirmedDownload(file.id,80);
       }
      }
     }catch(error){run.reason='緊急保全失敗：'+String(error.message||error)}
    }
    await finish(runs,run,'failed',reason);
   }
  });
 }
 api.tabs.onUpdated.addListener((id,change)=>{
  if(change.status==='loading'||change.url)
   interrupt(r=>r.tabId===id&&!r.exportPending,'掃描頁面已重新載入或離開');
 });
 api.tabs.onRemoved.addListener(id=>interrupt(r=>r.tabId===id&&!r.exportPending,'掃描分頁已關閉'));
 api.runtime.onStartup.addListener(()=>interrupt(()=>true,'Chrome 已重新啟動，前次掃描中斷'));
 api.runtime.onInstalled.addListener(()=>interrupt(()=>true,'擴充功能已重新載入，前次掃描中斷'));
 api.alarms.onAlarm.addListener(a=>interrupt(r=>a.name===ALARM+r.scanRunId,'掃描或下載逾時'));
 return {batchPath,cycleFolder,publicStatus};
}
if(typeof module!=='undefined'&&module.exports)module.exports={installGalScanStatus};
