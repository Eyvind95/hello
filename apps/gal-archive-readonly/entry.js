(function(){'use strict';
const firebaseConfig={apiKey:'AIzaSyAP4hKop0wN9jrAN6_xx0fGhwInAAa5chI',authDomain:'eyvind95-182f0.firebaseapp.com',projectId:'eyvind95-182f0',storageBucket:'eyvind95-182f0.firebasestorage.app',messagingSenderId:'105770576221',appId:'1:105770576221:web:dd3a57ce4e051bda91a0b4',measurementId:'G-7HHMTE1W1T'};
const targets=[{worldKey:'sentinel',cycleId:'a1be1db2-ed98-456e-978a-6946e8ffd2f5',cycleTitle:'第13輪迴'},{worldKey:'sentinel',cycleId:'0864dc24-d456-4269-b84e-db4ec808cf9d',cycleTitle:'第14輪迴'}];
const $=id=>document.getElementById(id);let auth,firestore,busy=false,output=null;
function refresh(){ $('capture').disabled=busy||!auth?.currentUser||!$('ready').checked; $('download').disabled=busy||!output; $('ready').disabled=busy; }
function openExisting(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open('gal-reincarnation-archive');let missing=false;
 req.onupgradeneeded=()=>{missing=true;req.transaction.abort()};
 req.onerror=()=>reject(Error(missing?'找不到既有網站資料庫，已中止建立':'本機資料庫無法唯讀開啟'));
 req.onblocked=()=>reject(Error('既有資料庫被鎖定'));
 req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();if(db.version!==2||!['cycles','worlds'].every(k=>db.objectStoreNames.contains(k))){db.close();reject(Error('正式網站資料庫版本或結構不符'));return}resolve(db)};
})}
$('ready').onchange=refresh;
$('capture').onclick=async()=>{
 if(busy||!auth?.currentUser||!$('ready').checked)return;
 output=null;busy=true;refresh();$('result').textContent='正在唯讀核對，請勿關閉本頁或操作其他檔案館頁面。';
 let db;try{
  if(!navigator.locks?.request)throw Error('瀏覽器不支援同步鎖，已停止');
  const uid=auth.currentUser.uid;
  await navigator.locks.request('gal-archive-safe-auto-sync-'+uid,{mode:'exclusive',ifAvailable:true},async lock=>{
   if(!lock)throw Error('同裝置有檔案館同步正在執行，已停止');
   if(auth.currentUser?.uid!==uid)throw Error('登入已變更');
   db=await openExisting();
   const result=await ArchiveReadOnlySnapshot.capture({db,firestore,currentUser:()=>auth.currentUser,targets,isBusy:()=>!busy||!$('ready').checked||auth.currentUser?.uid!==uid});
   const text=JSON.stringify(result,null,2);
   const hash=await ArchiveReadOnlyHash.sha(text);
   if(auth.currentUser?.uid!==uid||!$('ready').checked)throw Error('狀態已變更');
   output={text,hash,filename:'CAT-FINAL-002_R2_網站唯讀快照_'+result.finishedAt.replace(/[:.]/g,'-')+'.json'};
   $('result').textContent=['唯讀取證完成（未寫入正式資料）',...result.targets.map(t=>t.target.cycleTitle+'：本機／Firebase '+(t.equal?'一致':'不一致；僅保全，不可匯入')),'檔案 SHA-256：'+hash,'請按下載並私人保存。'].join('\n');
  });
 }catch(e){output=null;$('result').textContent='取證停止：'+String(e.message||e)}finally{db?.close();busy=false;refresh()}
};
$('download').onclick=()=>{if(busy||!output)return;const url=URL.createObjectURL(new Blob([output.text],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=output.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
try{
 if(!window.firebase||!window.ArchiveReadOnlyHash||!window.ArchiveReadOnlySnapshot)throw Error('必要模組未完整載入');
 const app=firebase.apps[0]||firebase.initializeApp(firebaseConfig);auth=app.auth();firestore=app.firestore();
 auth.onAuthStateChanged(u=>{if(!u)output=null;$('auth').textContent=u?'已讀取既有 Google 登入（未切換帳號）':'未找到既有登入；請停止，不在本頁登入';refresh()},e=>{$('auth').textContent='登入狀態讀取失敗：'+e.message;refresh()});
}catch(e){$('auth').textContent=String(e.message||e);refresh()}
})();