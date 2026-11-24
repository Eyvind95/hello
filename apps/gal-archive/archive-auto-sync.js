/* Archive automatic private sync: local-first, revision-aware, fail closed. */
(()=>{
'use strict';
const planner=globalThis.ArchiveAutoSyncCore;
const app=globalThis.ArchiveAutoSyncBridge;
if(!planner||!app)return;
const KEY='gal-archive-auto-sync-v1';
const knownKey=uid=>KEY+':known:'+uid;
const onKey=uid=>KEY+':enabled:'+uid;
let uid=null,localReady=false,inProgress=false,queued=false,timer=null,
 lastAttempt=0,enabled=true,blocked=false,lastStatus='',runningUid=null;
const $=id=>document.getElementById(id);
function status(message,kind='idle'){
 lastStatus=message;
 const node=$('archiveAutoSyncStatus');
 if(node){node.textContent=message;node.dataset.state=kind;
  node.title='資料以本機與雲端各筆更新時間核對；有衝突會停止，不會硬覆蓋。';}
 const detail=$('archiveAutoSyncDetail');
 if(detail){detail.textContent=message;detail.dataset.state=kind;}
}
function readJSON(key,otherwise){
 try{const val=localStorage.getItem(key);return val?JSON.parse(val):otherwise}
 catch{return otherwise}
}
function currentEnabled(){
 return uid?readJSON(onKey(uid),true)!==false:true;
}
function setEnabled(value){
 enabled=Boolean(value);
 if(uid)try{localStorage.setItem(onKey(uid),JSON.stringify(enabled))}catch(_){}
 const checkbox=$('archiveAutoSyncToggle');
 if(checkbox)checkbox.checked=enabled;
 if(!enabled){clearTimeout(timer);timer=null;status('☁ 自動同步已關閉；本機資料仍安全','idle')}
 else request('enable',300);
}
function knownIds(){
 return uid?readJSON(knownKey(uid),{cycles:[],worlds:[]}):{cycles:[],worlds:[]};
}
function saveKnownIds(){
 if(!uid)return;
 const value={cycles:app.localCycles().map(x=>x.id),
  worlds:app.localWorlds().map(x=>x.id)};
 try{localStorage.setItem(knownKey(uid),JSON.stringify(value))}catch(e){console.warn('雲端已同步，但無法保留跨裝置索引：',e)}
}
function checksAfterPlan(plan){
 const remembered=knownIds();
 const cycleSet=new Set(remembered.cycles||[]);
 const worldSet=new Set(remembered.worlds||[]);
 const unsafe=plan.changes.filter(x=>x.choice==='remote-only'&&
  (x.kind==='cycle'?cycleSet:worldSet).has(x.id));
 if(unsafe.length)throw Error('本機曾有 '+unsafe.length+' 筆輪迴／世界觀，現在不在本機但雲端仍存在。可能是刻意刪除，已停止自動同步，避免把已刪輪迴復活。請先人工核對。');
 if(!plan.ok)throw Error(''+plan.problems.length+' 個來源版本無法安全比對（'+
  plan.problems.slice(0,3).join('、')+'）。已保留本機與雲端，請先人工核對。');
}
function request(reason,delay=2500){
 if(!uid||!localReady||!enabled||blocked)return;
 if(inProgress){queued=true;return}
 clearTimeout(timer);
 timer=setTimeout(()=>{timer=null;run(reason).catch(e=>{
  console.error('[檔案館自動同步]',e);
  blocked=true;
  status('⚠ 同步暫停：'+String(e.message||e).slice(0,160),'error');
 })},delay);
}
async function underExclusiveLock(work){
 if(navigator.locks?.request){
  const result=await navigator.locks.request('gal-archive-safe-auto-sync-'+uid,
   {mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)return {busyOtherTab:true};
    return work();
   });
  return result;
 }
 // Fail closed rather than racing huge canonical writes in two browser tabs.
 throw Error('此瀏覽器不支援跨分頁同步鎖；請改用支援 Web Locks 的 Chrome，或使用手動雲端同步。');
}
async function syncOnce(){
 const currentUid=uid;
 if(!currentUid||!enabled||!app.isSignedIn(currentUid))return;
 if(app.isManualBusy())return {manual:true};
 if(navigator.onLine===false){status('☁ 離線：保留本機，恢復網路後再同步','idle');return {offline:true}}
 status('☁ 正在核對電腦／手機與 Firebase 的正史版本…','working');
 await app.ensureRoot();
 // Server source required. Cache metadata cannot authorize overwrites.
 const remote=await app.remoteMetadata();
 if(!app.isSignedIn(currentUid))return;
 const plan=planner.plan(app.localCycles(),remote.cycles,app.localWorlds(),remote.worlds);
 checksAfterPlan(plan);
 // Keep a version of every existing cycle that could be replaced by newer cloud data.
 for(const c of plan.snapshots){
  if(!c.id)throw Error('無法為待更新輪迴建立安全備份（缺少輪迴 ID）');
  if(!globalThis.ArchiveTimeMachine?.captureBeforeNative)
   throw Error('正史版本時光機尚未載入，禁止自動覆蓋本機輪迴');
  await globalThis.ArchiveTimeMachine.captureBeforeNative(c,{
   source:{url:'private Firebase auto-sync; previous local version'}
  });
 }
 // Cloud operations may save to local IndexedDB. Ignore these writes for
 // local-dirty triggers; queue only changes from the user's interactions.
 app.setApplyingCloud(true);
 try{
  if(plan.needsPull){
   status('☁ 雲端有較新的項目，已保全舊版，正在安全合併…','working');
   await app.pullCanonical();
  }
  if(!app.isSignedIn(currentUid))throw Error('同步期間切換了 Google 帳號，請重新登入');
  if(plan.needsPush||plan.needsPull){
   status('☁ 正在將本機較新的輪迴同步到私人 Firebase…','working');
   await app.pushCanonical();
  }
  if(!globalThis.ArchiveHandoverCloud?.pull||!globalThis.ArchiveHandoverCloud?.push)
   throw Error('交接稿雲端同步模組尚未載入，已暫停完整自動同步');
  const user=app.user();
  // Server-side delete markers cannot automatically destroy local handover data.
  status('☁ 正在核對交接稿、評語與附件版本…','working');
  const handoverPull=await globalThis.ArchiveHandoverCloud.pull({
   db:app.firestore(),user,safeAuto:true,progress:s=>status('☁ '+s,'working')
  });
  const handoverPush=await globalThis.ArchiveHandoverCloud.push({
   db:app.firestore(),user,progress:s=>status('☁ '+s,'working')
  });
  saveKnownIds();
  blocked=false;
  status('✅ 雲端同步完成：正史 '+(plan.needsPush?'已更新':'已核對')+
   '，合併 '+plan.count.pull+'、上傳 '+plan.count.push+
   ' 項；交接稿／附件 '+(handoverPull.threads+handoverPull.text+handoverPull.files)+
   ' 項下載、'+(handoverPush.threads+handoverPush.text+handoverPush.files)+' 項上傳。','success');
  lastAttempt=Date.now();
  return {ok:true};
 }finally{app.setApplyingCloud(false)}
}
async function run(reason){
 if(inProgress){queued=true;return}
 if(!uid||!localReady||!enabled||!app.isSignedIn(uid))return;
 inProgress=true;runningUid=uid;
 try{
  const result=await underExclusiveLock(syncOnce);
  if(result?.busyOtherTab){
   status('☁ 其他檔案館分頁正在同步；本頁暫不重複寫入','idle');
  }
 }catch(e){
  blocked=true;
  status('⚠ 自動同步暫停：'+String(e.message||e).slice(0,190),'error');
  console.error('[檔案館自動同步]',reason,e);
 }finally{
  inProgress=false;runningUid=null;
  if(queued&&!blocked){queued=false;request('queued',1800)}
  else queued=false;
 }
}
function manualRetry(){
 blocked=false;request('manual-retry',100);
}
function onAuth(event){
 const next=event.detail?.uid||null;
 if(uid===next&&next!==null)return;
 uid=next;
 enabled=currentEnabled();
 blocked=false;
 clearTimeout(timer);timer=null;
 const checkbox=$('archiveAutoSyncToggle');if(checkbox)checkbox.checked=enabled;
 if(!uid)status('☁ 未登入：資料僅保存在這台裝置','idle');
 else if(!enabled)status('☁ 已登入，但此裝置關閉了自動同步','idle');
 else{status('☁ 已登入，正在排程版本核對…','idle');request('auth',900)}
}
function install(){
 const checkbox=$('archiveAutoSyncToggle');
 if(checkbox)checkbox.addEventListener('change',e=>setEnabled(e.target.checked));
 $('archiveAutoSyncNow')?.addEventListener('click',manualRetry);
 window.addEventListener('archive:cloud-auth',onAuth);
 window.addEventListener('archive:local-ready',()=>{
  localReady=true;
  request('ready',300);
 });
 window.addEventListener('archive:local-changed',()=>{
  if(!app.isApplyingCloud())request('local-change',3000);
 });
 window.addEventListener('archive:handover-changed',()=>{
  if(!app.isApplyingCloud())request('handover-change',3500);
 });
 window.addEventListener('online',()=>{blocked=false;request('network-online',600)});
 window.addEventListener('focus',()=>{
  if(!blocked&&Date.now()-lastAttempt>3*60*1000)request('focus',900);
 });
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&!blocked&&Date.now()-lastAttempt>3*60*1000)request('visible',1000);
 });
 app.autoReady().then(()=>{localReady=true;if(app.user())onAuth({detail:{uid:app.user().uid}});request('init',1100)})
  .catch(e=>status('⚠ 本機檔案館尚未準備好：'+String(e.message||e),'error'));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();
