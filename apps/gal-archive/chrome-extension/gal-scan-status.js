'use strict';
/* WHIF batch downloads. All paths are frozen at registration; never
 * use the current date to determine a later file's destination. */

const GAL_BATCH_WORLDS=[
 {worldKey:'sentinel',worldName:'《全員精神穩定，感情除外》',worldFolder:'全員精神穩定，感情除外'},
 {worldKey:'adventure',worldName:'《身為冒險者就可以這樣那樣》',worldFolder:'身為冒險者就可以這樣那樣'},
 {worldKey:'road',worldName:'🔞公路求生－我是求生者！🔞',worldFolder:'公路求生－我是求生者！'}
];
const galWorldNorm=x=>String(x||'').normalize('NFKC').replace(/[《》〈〉「」『』\s，,。．·・！!－—–-]|🔞/gu,'');
function galCycleNumber(title){
 const value=String(title||'').normalize('NFKC').trim();
 const m=value.match(/^第\s*(\d{1,4}|[零〇一二兩三四五六七八九十百千]+)\s*(?:周目|週目|輪迴|輪目|周|週)/u);
 if(!m)return null;
 if(/^\d+$/.test(m[1]))return +m[1]>0?+m[1]:null;
 const digits={'零':0,'〇':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9},units={'十':10,'百':100,'千':1000};
 let n=0,pending=0;
 for(const ch of m[1]){if(Object.hasOwn(digits,ch))pending=digits[ch];else{n+=(pending||1)*units[ch];pending=0}}
 return n+pending>0?n+pending:null;
}
function galBatchIdentity(profile){
 const worldName=String(profile?.worldName||'').trim(),cycleTitle=String(profile?.cycleTitle||'').trim(),cycleId=String(profile?.cycleId||'');
 const world=GAL_BATCH_WORLDS.find(w=>galWorldNorm(w.worldName)===galWorldNorm(worldName));
 const cycleNumber=galCycleNumber(cycleTitle);
 if(profile?.cycleNumber!=null&&(!Number.isInteger(profile.cycleNumber)||profile.cycleNumber!==cycleNumber))throw Error('輪迴編號與綁定名稱不一致，請重新核對檔案館');
 return {worldName,worldKey:world?.worldKey||null,worldFolder:world?.worldFolder||'世界觀待確認',
  cycleId,cycleTitle,cycleNumber,archiveKey:world&&cycleId?world.worldKey+'::'+cycleId:null};
}


const GAL_WIRE_CHARS=256*1024, GAL_WIRE_MAX=256*1024*1024;
async function galWireHash(text){
 const bytes=new TextEncoder().encode(text);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
async function galWireRetry(action){
 let last;
 for(let i=0;i<3;i++)try{return await action()}catch(error){last=error}
 throw last;
}
async function galReadWire(value,pull){
 if(value==null||typeof value==='string')return value;
 if(value.galWire!==1||typeof value.token!=='string'||!/^[a-f0-9-]{36}$/i.test(value.token)||
    !Number.isInteger(value.length)||value.length<=0||value.length>GAL_WIRE_MAX||
    value.count!==Math.ceil(value.length/GAL_WIRE_CHARS)||!/^[a-f0-9]{64}$/.test(value.sha256))
  throw Error('大型掃描資料描述不合法');
 const pieces=[];
 for(let index=0;index<value.count;index++){
  const piece=await galWireRetry(async()=>{
   const reply=await pull(value.token,index);
   if(!reply?.ok||reply.token!==value.token||reply.index!==index||typeof reply.text!=='string'||
      reply.text.length!==Math.min(GAL_WIRE_CHARS,value.length-index*GAL_WIRE_CHARS))
    throw Error('大型掃描資料缺段或序號不符：'+index);
   return reply.text;
  });
  pieces.push(piece);
 }
 const text=pieces.join('');
 if(await galWireHash(text)!==value.sha256)throw Error('大型掃描資料SHA-256不符');
 return text;
}

function installGalScanStatus(api){
 const KEY='galScanRuns',ALARM='gal-scan-deadline:';
 const DEADLINE={full:240,preview:45,'event-three':45,'position-seven':45,missing:45,'history-source':240};
 const EXPORT_DEADLINE=15;
 const terminal=new Set(['completed','failed','paused','cancelled']);
 const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{5,160}$/.test(x);
 const uuidOk=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
 const now=()=>new Date().toISOString();
 const timestamp=iso=>new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,19).replace('T','_').replace(/:/g,'-');
 const clean=x=>String(x||'').trim().replace(/[\\/／＼:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').replace(/[. ]+$/g,'').slice(0,75);
 function cycleFolder(title,cycleId){
  const n=galCycleNumber(title);
  return n!==null?'第'+String(n).padStart(2,'0')+'輪迴':
   '自訂_'+(clean(title)||'未命名輪迴')+'_'+String(cycleId).slice(0,8);
 }
 const typeFolder={full:'完整掃描',preview:'三則測試','event-three':'事件三則測試',
  'position-seven':'指定位置測試',missing:'缺漏診斷','history-source':'歷史來源補證'};
 function batchPath(title,cycleId,scope,startedAt,scanRunId,worldName){
  if(!idOk(cycleId)||!uuidOk(scanRunId)||!typeFolder[scope])throw Error('批次綁定無效');
  return 'GalArchive/'+galBatchIdentity({worldName,cycleTitle:title,cycleId}).worldFolder+'/'+cycleFolder(title,cycleId)+'/'+typeFolder[scope]+'/'+timestamp(startedAt)+'_'+scanRunId;
 }
 const filenames={status:'掃描狀態.json',diagnostic:'掃描診斷.json',result:'原生正史.json',
  unverified:'未驗證掃描資料.json',eventResult:'事件三則測試.json',
  positionResult:'指定位置測試.json',missingResult:'缺漏診斷.json',historyResult:'歷史來源補證.json'};
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
   worldName:run.worldName??null,worldKey:run.worldKey??null,cycleNumber:run.cycleNumber??null,archiveKey:run.archiveKey??null,
   scannerVersion:run.scannerVersion||null,state:run.state,startedAt:run.startedAt,
   endedAt:run.endedAt||null,at:run.at,scope:run.scope,scanned:run.scanned,
   source:run.source,deadlineMinutes:run.deadlineMinutes,
   lateCompletionRecovered:run.lateCompletionRecovered||false,
   reason:run.reason||null,summary:run.summary||null,
   batchFolder:run.batchFolder,
   progressMode:'live-extension-storage',statusFilePolicy:'start-terminal-manual-save',
   statusPath:run.statusPath||run.batchFolder+'/'+filenames.status,
   files:Object.fromEntries(Object.entries(run.files||{}).filter(([,f])=>f.path)
    .map(([k,f])=>[k,f.path])),
   unverifiedCount:run.unverifiedCount??null,
   exportPending:run.exportPending===true,
   scanOutcome:run.finishState||null,exportFailure:run.exportFailure===true,
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
 function attachIdentity(run,text){
  const data=JSON.parse(text);
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('掃描 JSON 非物件');
  if(!run.worldKey)return text; // existing legacy in-flight runs retain their original path
  for(const source of [data,data.target].filter(Boolean)){
   if(source.cycleId!=null&&source.cycleId!==run.cycleId)throw Error('輸出輪迴 ID 與批次不一致');
   if(source.worldName!=null&&galWorldNorm(source.worldName)!==galWorldNorm(run.worldName))throw Error('輸出世界觀與批次不一致');
   if(source.worldKey!=null&&source.worldKey!==run.worldKey)throw Error('輸出世界觀識別碼與批次不一致');
   if(source.cycleTitle!=null&&galCycleNumber(source.cycleTitle)!==run.cycleNumber)throw Error('輸出輪迴名稱與批次不一致');
   if(source.cycleNumber!=null&&source.cycleNumber!==run.cycleNumber)throw Error('輸出輪迴編號與批次不一致');
  }
  const meta={worldName:run.worldName,worldKey:run.worldKey,cycleId:run.cycleId,
   cycleTitle:run.cycleTitle,cycleNumber:run.cycleNumber,archiveKey:run.archiveKey};
  return JSON.stringify({...data,...meta,...(data.target?{target:{...data.target,...meta}}:{})},null,2);
 }
 async function hydrateWire(message,sender,fields){
  const result={...message};
  for(const field of fields)if(result[field]!=null&&typeof result[field]!=='string'){
   result[field]=await galReadWire(result[field],(token,index)=>api.tabs.sendMessage(sender.tab.id,
    {type:'gal-run-wire-pull',token,index,field,scanRunId:message.scanRunId,cycleId:message.cycleId},
    {documentId:sender.documentId}));
  }
  return result;
 }
 async function makeFile(run,kind,text){
  if(!filenames[kind]||kind==='status'||typeof text!=='string'||!text||
     text.length>GAL_WIRE_MAX)
   throw Error('輸出檔格式或大小不安全');
  text=attachIdentity(run,text);
  if(text.length>GAL_WIRE_MAX)throw Error('輸出檔超過256Mi UTF-16 units安全上限');
  if(!(await api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[offscreenUrl]})).length)
   await api.offscreen.createDocument({url:'gal-scan-files.html',reasons:['BLOBS'],justification:'Save raw Gal AI scan evidence'});
  let url;
  if(text.length<=128*1024)url=await api.runtime.sendMessage({type:'gal-run-blob-create',text});
  else{
   const token=crypto.randomUUID(),count=Math.ceil(text.length/GAL_WIRE_CHARS),sha256=await galWireHash(text);
   const send=async message=>{
    const r=await api.runtime.sendMessage(message);
    if(!r?.ok)throw Error(r?.error||'offscreen分段傳輸未確認');
    return r;
   };
   try{
    await galWireRetry(()=>send({type:'gal-run-blob-begin',token,count,length:text.length,sha256}));
    for(let index=0;index<count;index++)
     await galWireRetry(()=>send({type:'gal-run-blob-chunk',token,index,text:text.slice(index*GAL_WIRE_CHARS,(index+1)*GAL_WIRE_CHARS)}));
    const result=await galWireRetry(()=>send({type:'gal-run-blob-end',token}));
    url=result.url;
   }finally{await api.runtime.sendMessage({type:'gal-run-blob-abort',token}).catch(()=>{});}
  }
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
   next.state='failed';next.exportFailure=true;next.reason='掃描狀態檔下載未完成：'+String(error.message||error);
   await save(runs);
  }
  await api.tabs.sendMessage(next.tabId,{type:'gal-run-page-status',status:publicStatus(next)},
   {documentId:next.documentId}).catch(()=>{});
  return next;
 }
 const missingExpected=run=>Array.isArray(run.expectedFiles)&&run.expectedFiles.some(kind=>!run.files?.[kind]?.id);
 async function reconcile(runs,run){
  if(!run.exportPending||run.state!=='running'||missingExpected(run))return;
  try{
   if(!(await pendingFiles(runs,run)))return;
   await finish(runs,run,run.finishState,run.reason);
  }catch(error){run.exportFailure=true;await finish(runs,run,'failed',String(error.message||error))}
 }
 const isOwner=(run,sender)=>Boolean(run&&run.tabId===sender.tab?.id&&
  run.documentId===sender.documentId&&run.source===safeUrl(sender.tab?.url||sender.url));
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
  // Chrome sender.url can lag behind a same-document WHIF route change.
  // A start must also independently declare the actual page source.
  const src=safeUrl(sender.tab?.url||sender.url);
  const documentSource=safeUrl(sender.url);
  if(message.type==='gal-run-start'&&((message.pageSource!=null&&safeUrl(message.pageSource)!==src)||(documentSource!==src&&safeUrl(message.pageSource)!==src)))throw Error('WHIF 分頁網址與掃描面板目前網址不一致，請重新整理頁面');
  if(message.type==='gal-run-download-extra'){
   if(!src||sender.frameId!==0||!sender.tab||!uuidOk(message.scanRunId))throw Error('手動下載來源無效');
   const binding=((await api.storage.local.get('galProfilesByPage')).galProfilesByPage||{})[src];
   if(!binding||binding.cycleId!==message.cycleId)throw Error('手動下載輪迴綁定不一致');
   const identity=galBatchIdentity(binding);
   if(!identity.worldKey||identity.cycleNumber===null)throw Error('世界觀或輪迴編號待確認，禁止分類下載');
   const kind=message.kind;
   if(!['diagnostic','unverified'].includes(kind))throw Error('手動證據類型無效');
   if(runs[message.scanRunId])throw Error('批次 ID 重複');
   const startedAt=now();
   const run={...identity,scanRunId:message.scanRunId,source:src,scope:'missing',scannerVersion:api.runtime.getManifest().version,startedAt,at:startedAt,deadlineMinutes:45,scanned:0,state:'running',files:{},batchFolder:batchPath(identity.cycleTitle,identity.cycleId,'missing',startedAt,message.scanRunId,identity.worldName)};
   message=await hydrateWire(message,sender,['text']);
   const data=JSON.parse(message.text);
   if(kind==='unverified'&&(data.format!=='gal-ai-unverified-scan'||data.importable!==false))throw Error('手動保全不得為正式正史');
   const payload={...data,originalScanRunId:data.scanRunId||null,scanRunId:run.scanRunId,source:src,importable:false};
   const file=await makeFile(run,kind,JSON.stringify(payload));
   const filePath=await confirmedDownload(file.id,80);file.path=filePath;run.files[kind]=file;
   run.scanned=Number.isInteger(data.collectedCount)?data.collectedCount:0;run.state='completed';run.endedAt=now();run.at=run.endedAt;
   run.statusPath=await signal(run);runs[run.scanRunId]=run;await save(runs);
   await api.runtime.sendMessage({type:'gal-run-blob-release',url:file.url}).catch(()=>{});
   return {batchFolder:run.batchFolder,filePath};
  }
  if(!src||!Number.isInteger(sender.tab?.id)||sender.frameId!==0||!sender.documentId||
     !idOk(message.cycleId)||!uuidOk(message.scanRunId))
   throw Error('掃描來源或工作識別碼無效');
  if(message.type==='gal-run-start'){

   if(runs[message.scanRunId]||Object.values(runs).some(r=>r.state==='running'&&
    (r.tabId===sender.tab.id||r.source===src)))
    throw Error('同一來源已有掃描工作執行');
   if(!Object.hasOwn(DEADLINE,message.scope))throw Error('掃描類型不支援');
   const binding=((await api.storage.local.get('galProfilesByPage')).galProfilesByPage||{})[src];
   if(!binding)throw Error('WHIF 目前網址沒有已儲存輪迴綁定：'+src);
   if(binding.cycleId!==message.cycleId)throw Error('WHIF 來源輪迴 ID 不一致：已儲存 '+binding.cycleId+'／掃描面板 '+message.cycleId);
   const identity=galBatchIdentity(binding);
   if(identity.cycleNumber===null)throw Error('輪迴名稱沒有可確認的編號，請核對檔案館後再掃描');
   if(!identity.worldKey)throw Error('世界觀無法辨識：請確認綁定名稱，不得預設歸入其他世界觀');
   if(message.worldName&&galWorldNorm(message.worldName)!==galWorldNorm(identity.worldName)||
      message.cycleTitle&&galCycleNumber(message.cycleTitle)!==identity.cycleNumber||
      message.cycleNumber!=null&&message.cycleNumber!==identity.cycleNumber)throw Error('掃描面板世界觀／輪迴編號與已儲存綁定不一致');
   const startedAt=now();
   const run=record(runs,{scanRunId:message.scanRunId,...identity,
    scannerVersion:String(message.scannerVersion||api.runtime.getManifest?.().version||''),
    tabId:sender.tab.id,documentId:sender.documentId,source:src,scope:message.scope,
    startedAt,endedAt:null,scanned:0,
    deadlineMinutes:DEADLINE[message.scope],batchFolder:batchPath(binding.cycleTitle,message.cycleId,
     message.scope,startedAt,message.scanRunId,identity.worldName),files:{}},{state:'running'});
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
   // Live progress stays in extension storage; only lifecycle and explicit evidence saves write the status file.
   return publicStatus(run);
  }
  if(message.type==='gal-run-export-failed'){
   if(run.state==='running'&&(!run.exportPending||missingExpected(run))){
    run.scanned=Math.max(run.scanned,Number.isInteger(message.scanned)&&message.scanned<=20000?message.scanned:0);
    run.exportFailure=true;
    if(terminal.has(message.scanOutcome))run.finishState=message.scanOutcome;
    await finish(runs,run,'failed','掃描輸出傳輸未確認：'+String(message.transportError||'未知').slice(0,500));
   }
   return publicStatus(runs[run.scanRunId]);
  }
  if(message.type==='gal-run-manual-save'){
   if(run.exportPending)throw Error('正在整理終態下載，請等下載完成再操作');
   message=await hydrateWire(message,sender,['unverified']);
   const data=JSON.parse(attachIdentity(run,message.unverified));
   if(data.format!=='gal-ai-unverified-scan'||data.importable!==false||
      data.scanRunId!==run.scanRunId||data.target?.cycleId!==run.cycleId||
      !Array.isArray(data.rows)||data.rows.length!==data.collectedCount)
    throw Error('手動已讀保全來源驗證失敗');
   if(run.files?.unverified?.path&&(terminal.has(run.state)||data.collectedCount<=(run.unverifiedCount??0)))return publicStatus(run);
   const previousFile=run.files?.unverified;
   const file=await makeFile(run,'unverified',message.unverified);
   file.path=await confirmedDownload(file.id,80);
   run.files={...(run.files||{}),unverified:file};
   run.unverifiedCount=data.collectedCount;
   run.scanned=Math.max(run.scanned||0,data.collectedCount);
   await save(runs);
   if(previousFile?.url)await api.runtime.sendMessage({type:'gal-run-blob-release',url:previousFile.url}).catch(()=>{});
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
  const late=run.state==='failed'&&(run.reason==='掃描或下載逾時'||run.exportFailure===true)&&message.state==='completed'&&
   !Object.values(runs).some(r=>r.scanRunId!==run.scanRunId&&r.state==='running'&&r.source===run.source);
  if(terminal.has(run.state)&&!late)return publicStatus(run);
  // A worker may have stopped after writing only the first file. The original
  // page may resubmit the complete verified envelope, but cannot change outcome
  // or row count while that export is incomplete.
  if(run.exportPending){
   if(!missingExpected(run))return publicStatus(run);
   if(run.finishState!==message.state||run.scanned!==message.scanned)throw Error('中斷的輸出只能以原驗收結果與筆數重新提交');
  }
  if(!terminal.has(message.state)||!Number.isInteger(message.scanned)||
     message.scanned<0||message.scanned>20000||message.scanned<run.scanned)
    throw Error('終態掃描數不得小於已確認進度');
  message=await hydrateWire(message,sender,['diagnostic','unverified','result']);
  const diagnostic=JSON.parse(attachIdentity(run,message.diagnostic));
  if(diagnostic.scanRunId!==run.scanRunId||diagnostic.cycleId!==run.cycleId)throw Error('診斷來源不一致');
  let completedResult=null;
  if(message.state==='completed'){
   completedResult=JSON.parse(attachIdentity(run,message.result));
   if(completedResult.scanRunId!==run.scanRunId||
      completedResult.target?.cycleId!==run.cycleId||
      safeUrl(completedResult.source?.url)!==run.source)
    throw Error('測試／正史輸出與工作來源不符');
   if(run.scope==='history-source'&&(completedResult.format!=='gal-ai-history-source-proof'||completedResult.complete!==true||completedResult.importable!==false||completedResult.entries?.length!==message.scanned))throw Error('歷史來源補證格式不符');
   if(['full','preview'].includes(run.scope)){
    if(completedResult.validation?.ok!==true||
      completedResult.scope!==(run.scope==='full'?'entire-opening-to-bottom':'opening-first-pair-preview')||
      completedResult.rawRows!==message.scanned)
     throw Error('正式正史格式或完整性驗證不通過');
    if(run.scope==='full'){
     if(completedResult.validation?.nativeFormatComplete!==true||completedResult.nativeFormatAudit?.complete!==true)
      throw Error('原生格式驗收尚未全部通過，禁止正式正史下載');
     const previous=Object.values(runs).filter(r=>r.scanRunId!==run.scanRunId&&
       r.state==='completed'&&r.scope==='full'&&r.cycleId===run.cycleId&&r.source===run.source)
      .sort((a,b)=>b.scanned-a.scanned)[0];
     if(previous&&message.scanned<previous.scanned)
      throw Error('完整掃描 '+message.scanned+' 筆少於歷史已完成的 '+previous.scanned+' 筆');
    }
   }
  }
  const resultKind=run.scope==='event-three'?'eventResult':
     run.scope==='position-seven'?'positionResult':run.scope==='missing'?'missingResult':run.scope==='history-source'?'historyResult':'result';
  const expectedFiles=['diagnostic',...(message.state==='completed'?[resultKind]:message.unverified?['unverified']:[])];
  if(run.exportPending){
   for(const [kind,file] of Object.entries(run.files||{}))if(expectedFiles.includes(kind)){
    if(!file.path&&file.id)await api.downloads.cancel(file.id).catch(()=>{});
    if(file.url)await api.runtime.sendMessage({type:'gal-run-blob-release',url:file.url}).catch(()=>{});
   }
  }
  const next=record(runs,run,{state:'running',lateCompletionRecovered:late,expectedFiles,
   finishState:message.state,exportFailure:false,scanned:message.scanned,
   reason:message.state==='completed'?null:String(message.reason||'掃描中斷').slice(0,500),
   exportPending:true,files:Object.fromEntries(Object.entries(run.files||{}).filter(([kind,file])=>file.path&&!expectedFiles.includes(kind)))});
  await save(runs);
  await api.alarms.create(ALARM+run.scanRunId,{delayInMinutes:EXPORT_DEADLINE});
  try{
   if(message.state==='completed'){
    next.summary={messages:completedResult.messages?.length||completedResult.rows?.length||0,
     pairs:completedResult.validation?.pairs||0,events:completedResult.events?.length||0,
     autoContinues:completedResult.validation?.autoContinues||0};
    next.files[resultKind]=await makeFile(run,resultKind,message.result);await save(runs);
   }else if(message.unverified){
    const data=JSON.parse(attachIdentity(run,message.unverified));
    if(data.format!=='gal-ai-unverified-scan'||data.importable!==false||
       data.scanRunId!==run.scanRunId||data.target?.cycleId!==run.cycleId||
       !Array.isArray(data.rows)||data.rows.length!==message.scanned)
     throw Error('未驗證原生資料格式／工作 ID／數量不符');
    next.files.unverified=await makeFile(run,'unverified',message.unverified);next.unverifiedCount=data.collectedCount;await save(runs);
   }
   next.files.diagnostic=await makeFile(run,'diagnostic',message.diagnostic);await save(runs);
   await reconcile(runs,next);
  }catch(error){next.exportFailure=true;await finish(runs,next,'failed','儲存掃描證據失敗：'+String(error.message||error));throw error}
  return publicStatus(runs[run.scanRunId]);
 }
 api.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['gal-run-query','gal-run-start','gal-run-finish','gal-run-open-folder','gal-run-manual-save','gal-run-progress','gal-run-download-extra','gal-run-export-failed'].includes(message?.type))return false;
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
    let snapshot=await api.tabs.sendMessage(run.tabId,
     {type:'gal-scan-emergency-snapshot',reason},
     {documentId:run.documentId}).catch(()=>null);
    if(snapshot?.scanRunId===run.scanRunId){
     try{snapshot=await hydrateWire({...snapshot,cycleId:run.cycleId},
      {tab:{id:run.tabId},documentId:run.documentId},['diagnostic','unverified'])}
     catch(error){run.reason='緊急保全傳輸失敗：'+String(error.message||error);snapshot=null}
    }
    if(snapshot?.scanRunId===run.scanRunId&&
       Number.isInteger(snapshot.scanned)&&snapshot.scanned>=0&&snapshot.scanned<=20000&&
       typeof snapshot.diagnostic==='string'){
     try{
      const diag=JSON.parse(snapshot.diagnostic);
      if(diag.scanRunId===run.scanRunId&&diag.cycleId===run.cycleId){
       run.scanned=Math.max(run.scanned,snapshot.scanned);run.files={...(run.files||{})};
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
    await finish(runs,run,'failed',run.reason?.startsWith('緊急保全')?reason+'；'+run.reason:reason);
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
 return {batchPath,cycleFolder,publicStatus,attachIdentity};
}
if(typeof module!=='undefined'&&module.exports)module.exports={installGalScanStatus,galBatchIdentity,galCycleNumber,galReadWire,galWireHash};
