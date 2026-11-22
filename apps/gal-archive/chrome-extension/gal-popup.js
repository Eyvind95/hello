/* Gal AI stand-alone popup. Never invokes ChatGPT watch/scan. */
'use strict';
const $=id=>document.getElementById(id),keys=['worldName','cycleTitle','cycleId','manager','uid'];
const storageGet=k=>new Promise(ok=>chrome.storage.local.get(k,ok));
const storageSet=o=>new Promise(ok=>chrome.storage.local.set(o,ok));
let tab=null,scope=null,profile=null;
const write=(message,warning=false)=>{const n=$('scanStatus');n.textContent=message;n.className='notice'+(warning?' warn':'')};
function nowProfile(){return Object.fromEntries(keys.map(k=>[k,$(k).value.trim()]))}
function fill(p){for(const k of keys)$(k).value=p?.[k]||''}
const label=p=>[p.worldName,p.cycleTitle,p.manager].filter(Boolean).join('／')||p.cycleId||'未命名';
async function state(){
 const tabs=await chrome.tabs.query({active:true,currentWindow:true});
 tab=tabs[0];
 try{const u=new URL(tab.url);if(!/^https?:$/.test(u.protocol)||['chatgpt.com','eyvind95.github.io'].includes(u.hostname))throw Error();
 scope=u.origin+u.pathname.replace(/\/$/,'');
 $('pageStatus').textContent='已選擇 Gal AI 原始頁面：\n'+scope;
 }catch(err){scope=null;$('pageStatus').textContent='請先開啟 Gal AI 原始對話分頁；不能在 ChatGPT 或檔案館內執行 Gal AI 掃描。';$('start').disabled=$('preview').disabled=true;return}
 const data=await storageGet(['galProfilesByPage','profilesByChat','profile']);
 const pmap=data.galProfilesByPage||{},old=data.profilesByChat||{};
 profile=pmap[scope]||null;
 const all=[...Object.values(pmap),...Object.values(old)].filter(p=>p?.cycleId&&p?.worldName);
 const unique=[...new Map(all.map(p=>[p.uid+'|'+p.cycleId,p])).values()];
 for(let i=0;i<unique.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=label(unique[i]);$('profileSelect').append(o)}
 $('profileSelect').onchange=()=>{const selected=$('profileSelect').value;if(selected==='')return;const p=unique[Number(selected)];if(p){fill(p);write('已套用預設值，按「儲存此頁面綁定」後才會用於掃描。')}};
 fill(profile||{uid:data.profile?.uid||'',worldName:'',cycleTitle:'',cycleId:'',manager:''});
 if(profile)write('已載入此 Gal AI 頁面的輪迴綁定：'+label(profile));
}
$('save').onclick=async()=>{
 if(!scope)return;
 const p=nowProfile();
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
 if(!confirm((preview?'即將從世界觀開場掃描 3 則，供格式驗收。':'即將從 Gal AI 目前畫面向下掃描到結尾。')+'\n目標：'+label(p)
  +'\n請確認當前第一則為「左側無時間的輪迴開場」。\n這次不會自動上傳，也不會刪改資料；掃描完成後需要手動下載 JSON 並在網站確認覆蓋。開始？'))return;
 try {
  $('start').disabled=$('preview').disabled=true;
  // User-initiated activeTab injection, no <all_urls> access and no guessing the site's hostname.
  if(['www.whif.io','whif.io'].includes(new URL(tab.url).hostname)){
   try { await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['gal-native-source.js']}); }
   catch { /* The scanner reports unavailable native source and supports pasted text. */ }
  }
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['gal-core.js','gal-content.js']});
  const expected=chrome.runtime.getManifest().version;
  const loaded=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-ping'});
  if(loaded?.version!==expected||loaded?.coreVersion!==expected)
   throw Error('分頁的掃描器或核心版本與已安裝版本不一致');
  const resp=await chrome.tabs.sendMessage(tab.id,{type:'gal-scan-start',profile:p,preview});
  if(!resp?.ok)throw Error(resp?.error||'頁面沒有接收到啟動訊號');
  write(preview?'已啟動三則測試。完成後可從頁面面板下載測試 JSON。':
   '已啟動 Gal AI 原生掃描。\n切回 Gal AI 頁面，右上角會有獨立進度面板。\n掃描完成後在面板按「下載原生正史 JSON」。');
 }catch(e){write('啟動失敗：'+String(e?.message||e)+'\n請重新整理 Gal AI 頁面再試。',true)}
 finally{$('start').disabled=$('preview').disabled=false}
}
$('start').onclick=()=>start(false);
$('preview').onclick=()=>start(true);
state();
