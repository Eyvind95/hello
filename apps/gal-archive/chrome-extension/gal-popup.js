/* Gal AI stand-alone popup. Never invokes ChatGPT watch/scan. */
'use strict';
const $=id=>document.getElementById(id),keys=['worldName','cycleTitle','cycleId','uid'];
$('releaseVersion').textContent='V'+chrome.runtime.getManifest().version;
const managers=globalThis.ArchiveManagerNames;
const storageGet=k=>new Promise(ok=>chrome.storage.local.get(k,ok));
const storageSet=o=>new Promise(ok=>chrome.storage.local.set(o,ok));
let tab=null,scope=null,profile=null;
const write=(message,warning=false)=>{const n=$('scanStatus');n.textContent=message;n.className='notice'+(warning?' warn':'')};
function nowProfile(){
 const managerNames=managers.form($('manager').value,$('manager2').value);
 return {...Object.fromEntries(keys.map(k=>[k,$(k).value.trim()])),manager:managerNames.join('、'),managerNames};
}
function fill(p){
 for(const k of keys)$(k).value=p?.[k]||'';
 const [first='',second='']=managers.read(p);
 $('manager').value=first;$('manager2').value=second;
}
const label=p=>[p.worldName,p.cycleTitle,managers.read(p).join('、')].filter(Boolean).join('／')||p.cycleId||'未命名';
async function state(){
 const tabs=await chrome.tabs.query({active:true,currentWindow:true});
 tab=tabs[0];
 try{const u=new URL(tab.url);if(!/^https?:$/.test(u.protocol)||['chatgpt.com','eyvind95.github.io'].includes(u.hostname))throw Error();
 scope=u.origin+u.pathname.replace(/\/$/,'');
 $('pageStatus').textContent='已選擇 Gal AI 原始頁面：\n'+scope;
 }catch(err){scope=null;$('pageStatus').textContent='請先開啟 Gal AI 原始對話分頁；不能在 ChatGPT 或檔案館內執行 Gal AI 掃描。';$('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=true;return}
 const data=await storageGet(['galProfilesByPage','profilesByChat','profile']);
 const pmap=data.galProfilesByPage||{},old=data.profilesByChat||{};
 profile=pmap[scope]||null;
 const all=[...Object.values(pmap),...Object.values(old)].filter(p=>p?.cycleId&&p?.worldName);
 const unique=[...new Map(all.map(p=>[JSON.stringify([p.uid,p.cycleId,managers.read(p)]),p])).values()];
 for(let i=0;i<unique.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=label(unique[i]);$('profileSelect').append(o)}
 $('profileSelect').onchange=()=>{const selected=$('profileSelect').value;if(selected==='')return;const p=unique[Number(selected)];if(p){fill(p);write('已套用預設值，按「儲存此頁面綁定」後才會用於掃描。')}};
 fill(profile||{uid:data.profile?.uid||'',worldName:'',cycleTitle:'',cycleId:'',manager:''});
 if(profile){
  write('已載入此 Gal AI 頁面的輪迴綁定：'+label(profile));
  const response=await chrome.runtime.sendMessage({type:'gal-run-query',cycleId:profile.cycleId,source:scope}).catch(()=>null);
  if(response?.status?.scanRunId){
   const {scanRunId,state,reason}=response.status;
   write('已載入此 Gal AI 頁面的輪迴綁定：'+label(profile)+'\n最近掃描：'+state+'\n'+scanRunId+(reason?'\n'+reason:''));
  }
 }
}
$('save').onclick=async()=>{
 if(!scope)return;
 let p;
 try{p=nowProfile()}catch(error){write(error.message,true);return}
 if(!/^[A-Za-z0-9_-]{5,160}$/.test(p.cycleId)||!p.worldName){write('請填入正確輪迴文件 ID 和世界觀名稱。',true);return}
 const d=await storageGet(['galProfilesByPage']),map=d.galProfilesByPage||{};
 if(map[scope]&&(map[scope].cycleId!==p.cycleId||map[scope].worldName!==p.worldName)
  &&!confirm('此 Gal AI 頁面之前綁定不同輪迴／世界觀！\n已匯出的 JSON 不會自動移動，確定變更之後的掃描目標嗎？'))return;
 map[scope]=p;await storageSet({galProfilesByPage:map});profile=p;write('已儲存：'+label(p));
};
async function start(preview){
 if(!scope||!tab)return;
 const d=await storageGet(['galProfilesByPage']),p=d.galProfilesByPage?.[scope];
 if(!p?.cycleId||!p?.worldName){write('請先儲存這個 Gal AI 對話的輪迴綁定',true);return}
 const managerNames=managers.read(p);
 if(managerNames.length<1||managerNames.length>2){write('請先確認並儲存 1 至 2 位副駕駛。',true);return}
 if(!confirm((preview?'即將從世界觀開場掃描 3 則，供格式驗收。':'即將從 Gal AI 目前畫面向下掃描到結尾。')+'\n目標：'+label(p)
  +'\n請確認當前第一則為「左側無時間的輪迴開場」。\nWHIF 掃描完成會自動下載 JSON 和診斷；之後才可在網站預覽匯入。開始？'))return;
 try {
  $('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=true;
  // User-initiated activeTab injection, no <all_urls> access and no guessing the site's hostname.
  if(['www.whif.io','whif.io'].includes(new URL(tab.url).hostname)){
   try { await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['gal-native-source.js']}); }
   catch { /* The scanner reports unavailable native source and supports pasted text. */ }
  }
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['gal-core.js','gal-format-evidence.js','gal-content.js']});
  const expected=chrome.runtime.getManifest().version;
  const loaded=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-ping'});
  if(loaded?.version!==expected||loaded?.coreVersion!==expected||loaded?.formatEvidenceVersion!==expected||loaded?.formatEvidenceReady!==true)
   throw Error('分頁的掃描器或核心版本與已安裝版本不一致');
  const resp=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-start',profile:{...p,managerNames},preview});
  if(!resp?.ok)throw Error(resp?.error||'頁面沒有接收到啟動訊號');
  write((preview?'已啟動三則測試。':'已啟動 Gal AI 原生掃描。')+
   '\n掃描 ID：'+resp.scanRunId+'\n可關閉彈出視窗。WHIF 的狀態與檔案將儲存至 Chrome 下載目錄。');
 }catch(e){write('啟動失敗：'+String(e?.message||e)+'\n請重新整理 Gal AI 頁面再試。',true)}
 finally{$('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=false}
}

async function probeEvent(){
 if(!scope||!tab)return;
 const d=await storageGet(['galProfilesByPage']),p=d.galProfilesByPage?.[scope];
 if(!p?.cycleId||!p?.worldName){write('請先儲存這個 Gal AI 對話的輪迴綁定',true);return}
 const managerNames=managers.read(p);
 if(managerNames.length<1||managerNames.length>2){write('請先確認並儲存 1 至 2 位副駕駛。',true);return}
 if(!confirm('只掃目前畫面附近的三筆：上一則 Gal AI → 中間事件 → 下一則我。\n請先把問題事件捲到畫面中央附近。\n不會啟動完整掃描，也不會修改正式正史。開始？'))return;
 try{
  $('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=true;
  if(['www.whif.io','whif.io'].includes(new URL(tab.url).hostname)){
   try{await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['gal-native-source.js']})}catch{}
  }
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['gal-core.js','gal-format-evidence.js','gal-content.js']});
  const expected=chrome.runtime.getManifest().version;
  const loaded=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-ping'});
  if(loaded?.version!==expected||loaded?.coreVersion!==expected||loaded?.formatEvidenceVersion!==expected||loaded?.formatEvidenceReady!==true)throw Error('分頁的掃描器或核心版本與已安裝版本不一致');
  const resp=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-event-probe',profile:{...p,managerNames}});
  if(!resp?.ok)throw Error(resp?.error||'頁面沒有接收到事件三則測試訊號');
  write('已啟動事件三則測試。\n完成後會直接下載測試 JSON 與診斷 JSON。');
 }catch(e){write('事件三則測試啟動失敗：'+String(e?.message||e),true)}
 finally{$('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=false}
}
async function probeAnchor(){
 if(!scope||!tab)return;
 const d=await storageGet(['galProfilesByPage']),p=d.galProfilesByPage?.[scope];
 if(!p?.cycleId||!p?.worldName){write('請先儲存這個 Gal AI 對話的輪迴綁定',true);return}
 const managerNames=managers.read(p);
 if(managerNames.length<1||managerNames.length>2){write('請先確認並儲存 1 至 2 位副駕駛。',true);return}
 const anchorInputs={id:$('anchorId').value.trim(),y:$('anchorY').value.trim(),
  height:$('anchorHeight').value.trim(),clock:$('anchorClock').value.trim(),neighbors:$('anchorNeighbors').value.trim()};
 if(!/^[A-Za-z0-9_-]{5,100}$/.test(anchorInputs.id)||!anchorInputs.y||!Number.isFinite(Number(anchorInputs.y))||Number(anchorInputs.y)<0||
    (anchorInputs.height&&(!Number.isFinite(Number(anchorInputs.height))||Number(anchorInputs.height)<=0))){
  write('請填入有效原生訊息 ID、可信 Y 與選填頁面高度。',true);return
 }
 if(!confirm('僅對目前 WHIF 分頁執行局部錨點復原取證。\n目標：'+label(p)+'\n不執行完整掃描、不匯入正史。開始？'))return;
 try{
  $('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=true;
  const current=await chrome.tabs.get(tab.id),u=new URL(current.url);
  if(!['www.whif.io','whif.io'].includes(u.hostname)||u.protocol!=='https:'||u.origin+u.pathname.replace(/\/$/,'')!==scope)
   throw Error('WHIF 分頁已切換，請重新開啟助手');
  const expected=chrome.runtime.getManifest().version;
  // A mounted foreign-version panel must never receive this probe.
  const guard=await chrome.scripting.executeScript({target:{tabId:tab.id},func:(id,version)=>{
   const panel=document.getElementById('gal-scanner-panel');
   return !panel||(panel.dataset.galExtensionId===id&&panel.dataset.galScannerVersion===version);
  },args:[chrome.runtime.id,expected]});
  if(guard?.[0]?.result!==true)throw Error('此分頁已有其他版本的掃描面板；請勿在正在掃描的分頁操作。');
  try{await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['gal-native-source.js']})}catch{}
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['gal-core.js','gal-format-evidence.js','gal-content.js']});
  const loaded=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-ping'});
  if(loaded?.version!==expected||loaded?.coreVersion!==expected||loaded?.formatEvidenceVersion!==expected||loaded?.formatEvidenceReady!==true)
   throw Error('分頁的掃描器或核心版本與已安裝版本不一致');
  if(loaded.busy)throw Error('此分頁已有掃描或取證進行中');
  const resp=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-open',profile:{...p,managerNames},anchorInputs});
  if(!resp?.ok||!resp.anchorStarted)throw Error(resp?.error||'頁面未接收到錨點取證訊號');
  write('已啟動錨點復原取證（不可匯入）。\n可關閉彈出視窗，請查看 WHIF 頁面內的掃描面板及下載檔案。');
 }catch(e){write('錨點復原取證啟動失敗：'+String(e?.message||e),true)}
 finally{$('start').disabled=$('preview').disabled=$('eventProbe').disabled=$('anchorProbe').disabled=false}
}
$('anchorProbe').onclick=()=>probeAnchor();
$('start').onclick=()=>start(false);
$('preview').onclick=()=>start(true);
$('eventProbe').onclick=()=>probeEvent();
state();