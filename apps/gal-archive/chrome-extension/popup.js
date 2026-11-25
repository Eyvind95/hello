'use strict';
const $=id=>document.getElementById(id);
$('releaseVersion').textContent='V'+chrome.runtime.getManifest().version;
const CHAT_PATTERN=/^\/(?:c\/[a-zA-Z0-9-]+|g\/[^/]+\/c\/[a-zA-Z0-9-]+)\/?$/;
let tab=null, chat=null,activeBinding=null;
const emptyTarget = () => ({uid:'',key:'',cycleId:'',manager:'',worldName:'',cycleTitle:''});
const targetFields=['uid','key','cycleId','worldName','cycleTitle'];
const managers=globalThis.ArchiveManagerNames;
const targetLabel=p=>[p.worldName,p.cycleTitle,managers.read(p).join('、')].filter(Boolean).join('／')||p.cycleId||'未命名輪迴';
function fillManagers(profile){
  const [first='',second='']=managers.read(profile);
  $('manager').value=first;
  $('manager2').value=second;
}
const saveStorage=data=>new Promise(resolve=>chrome.storage.local.set(data,resolve));
const getStorage=keys=>new Promise(resolve=>chrome.storage.local.get(keys,resolve));
const sendTab=message=>new Promise(resolve=>chrome.tabs.sendMessage(tab.id,message,response=>resolve(chrome.runtime.lastError?null:response)));
function notice(message,bad=false){$('status').textContent=message;$('status').className='notice '+(bad?'bad':'good');}
function showWatch(watched){$('start').disabled=!chat||watched||!activeBinding;$('stop').disabled=!chat||!watched;$('current').textContent=chat?`目前對話：${chat}\n狀態：${watched?'監看中':'未監看'}\n綁定：${activeBinding?targetLabel(activeBinding):'尚未指定輪迴（不會上傳）'}`:'請在 ChatGPT 的某一則具體對話中開啟本工具';}
(async()=>{
  const [active]=await chrome.tabs.query({active:true,currentWindow:true});
  tab=active;
  $('predecessorTitle').value=String(tab?.title||'').replace(/\s*[-–|]\s*ChatGPT\s*$/i,'');
  try {const u=new URL(tab.url);if(u.origin==='https://chatgpt.com'&&CHAT_PATTERN.test(u.pathname))chat=u.pathname.replace(/\/$/,'');}catch(_){}
  const data=await getStorage(['profile','profilesByChat','watch','last','lastByChat','autoTimeCapture','lastTimeCapture','lastTimeUpload','lastTimeCaptureByChat','lastTimeUploadByChat','bulkByChat']);
  const map=data.profilesByChat||{};
  // One-time safe migration: only a SINGLE previously watched conversation may inherit the old global target.
  if(chat&&!map[chat]&&data.profile?.cycleId){
    const existing=Object.keys(data.watch||{}).filter(k=>data.watch[k]===true);
    if(existing.length===1&&existing[0]===chat){
      map[chat]={...data.profile};await saveStorage({profilesByChat:map});
    }
  }
  activeBinding=map[chat]||null;
  $('bindingPanel').open=!activeBinding;
  const defaults=data.profile||{};
  for(const k of targetFields)$(k).value=activeBinding?.[k]||(k==='uid'||k==='key'?defaults[k]||'':'');
  fillManagers(activeBinding);
  const known=new Map(Object.values(map).filter(p=>p?.cycleId).map(p=>[JSON.stringify([p.uid,p.cycleId,managers.read(p)]),p]));
  for(const [key,p] of known){const option=document.createElement('option');option.value=key;option.textContent=targetLabel(p);$('targetPicker').appendChild(option);}
  $('targetPicker').onchange=()=>{const p=known.get($('targetPicker').value);if(!p)return;for(const k of targetFields)$(k).value=p[k]||'';fillManagers(p);notice('已帶入輪迴設定；按「將此對話綁定」才會正式生效。');};
  showWatch(data.watch?.[chat]===true);
  $('autoTime').checked=data.autoTimeCapture===true;
  updateTimePanels(data.lastTimeCaptureByChat?.[chat]||data.lastTimeCapture,data.lastTimeUploadByChat?.[chat]||data.lastTimeUpload);
  updateLastWrite(data.lastByChat?.[chat]||(data.last?.chat===chat?data.last:null));
  $('bulkStatus').textContent=data.bulkByChat?.[chat]?.progress||'範圍掃描：尚未執行';
  // 操作提示與最近寫入紀錄分開，避免回補按鈕訊息蓋掉時間／寫入結果。
})();
function showTime(iso){
  if(!iso)return '未知';
  const d=new Date(iso);
  return Number.isNaN(d.getTime())?'未知':d.toLocaleString('sv-SE',{timeZone:'Asia/Taipei'});
}
function updateLastWrite(record){
  const el=$('lastWriteStatus');
  if(!record||record.chat!==chat){el.textContent='最近寫入：此對話尚無紀錄';el.className='notice';return;}
  el.textContent=record.ok?
    `最近寫入：成功（${record.result||'ok'}） · ${record.role==='ai'?'ChatGPT':'皮卡'}\n${record.preview||''}\n上傳時間：${showTime(record.at)} · 目標輪迴 ID：${record.cycleId||'未記錄'}`:
    `最近寫入：失敗 · ${record.error||'未知錯誤'}\n時間：${showTime(record.at)}`;
  el.className='notice '+(record.ok?'good':'bad');
}
async function refreshLastWrite(){
  const d=await getStorage(['last','lastByChat']);
  updateLastWrite(d.lastByChat?.[chat]||(d.last?.chat===chat?d.last:null));
}
function updateTimePanels(c,u){
  if(c?.chat!==chat)c=null;
  if(u?.chat!==chat)u=null;
  $('timeCaptureStatus').textContent=c?`最近時間擷取：${c.status==='success'?'成功':c.status==='estimated'?'回覆推定（非原始時間）':'未取得'} · ${c.role==='ai'?'GPT':'皮卡'} ${c.preview||''}\n時間：${showTime(c.sourceCreatedAt)}\n來源：${c.sourceTimeOrigin||'—'} · ${c.detail||''}`:'最近時間擷取：此對話尚無紀錄';
  $('timeUploadStatus').textContent=u?`最近時間上傳：${u.ok?'成功':'失敗'} · ${u.role==='ai'?'GPT':'皮卡'} ${u.preview||''}\n原始發言時間：${showTime(u.sourceCreatedAt)}\n來源：${u.sourceTimeOrigin||'未知'}${u.error?' · '+u.error:''}`:'最近時間上傳：此對話尚無紀錄';
  $('timeUploadStatus').className='notice'+(u?' '+(u.ok?'good':'bad'):'');
}
async function refreshTimePanels(){const s=await getStorage(['lastTimeCapture','lastTimeUpload','lastTimeCaptureByChat','lastTimeUploadByChat']);updateTimePanels(s.lastTimeCaptureByChat?.[chat]||s.lastTimeCapture,s.lastTimeUploadByChat?.[chat]||s.lastTimeUpload);}
$('save').onclick=async()=>{
  if(!chat){notice('請先開啟一個 ChatGPT 對話，再為它綁定輪迴',true);return;}
  const profile=Object.fromEntries(targetFields.map(k=>[k,$(k).value.trim()]));
  try{profile.managerNames=managers.form($('manager').value,$('manager2').value);}
  catch(error){notice(error.message,true);return;}
  // The existing ChatGPT inbox attributes each individual message to one manager.
  profile.manager=profile.managerNames[0];
  if(!/^[A-Za-z0-9_-]{5,128}$/.test(profile.uid)||!/^[A-Za-z0-9_-]{5,160}$/.test(profile.cycleId)||!/^[a-fA-F0-9]{64}$/.test(profile.key)){notice('請確認 UID、輪迴 ID 和 64 位十六進位寫入金鑰。',true);return;}
  const data=await getStorage(['profilesByChat','profile','watch']);
  const map=data.profilesByChat||{};
  const previous=map[chat];
  const changed=previous&&(previous.cycleId!==profile.cycleId||previous.manager!==profile.manager||previous.uid!==profile.uid);
  if(changed&&!confirm('此對話之前已綁定其他輪迴！\n先前已收取的訊息不會自動搬家。\n確定要把「後續訊息」改綁到新的輪迴嗎？'))return;
  map[chat]=profile;
  const watch=data.watch||{};
  if(changed)delete watch[chat];
  await saveStorage({profilesByChat:map,profile:{uid:profile.uid,key:profile.key},watch});
  activeBinding=profile;showWatch(watch[chat]===true);
  $('bindingPanel').open=false;
  if(changed)await sendTab({type:'end-watch'});
  notice('此對話已綁定：'+targetLabel(profile)+(changed?'。原監看已停止，請重新按「開始監看」。':''));
};
$('start').onclick=async()=>{
  if(!chat)return;
  const {profilesByChat={},watch={}}=await getStorage(['profilesByChat','watch']);
  const profile=profilesByChat[chat];
  if(!profile?.uid||!profile.cycleId||!profile.manager||!profile.key){notice('請先將此對話綁定到正確的輪迴',true);return;}
  // Baseline prior conversation before enabling; prevents first-run historic backfill.
  const response=await sendTab({type:'begin-watch'});
  if(!response?.ok){notice('無法啟動：請重新整理 ChatGPT 對話頁面後再試',true);return;}
  watch[chat]=true;await saveStorage({watch});showWatch(true);notice(`監看已開啟，跳過原有 ${response.baseline} 則訊息；只記錄新訊息。`);
};
$('autoTime').onchange=async()=>{
  await saveStorage({autoTimeCapture:$('autoTime').checked});
  notice($('autoTime').checked?'已開啟新訊息選單時間擷取；不會回補既有訊息。':'已停用選單時間自動擷取。');
};
$('testTime').onclick=async()=>{
  if(!chat){notice('請先開啟 ChatGPT 對話',true);return}
  $('testTime').disabled=true;
  const result=await sendTab({type:'test-last-time'});
  $('testTime').disabled=false;
  await refreshTimePanels();
  if(!result?.ok){notice('測試未取得時間：'+(result?.reason||'請重整 ChatGPT 再試'),true);return}
  notice(`已配對：${result.preview}\n選單顯示：${result.text}\n台灣時間：${new Date(result.iso).toLocaleString('sv-SE',{timeZone:'Asia/Taipei'})}（僅精確到分鐘）${result.paired?"\n已同步到相鄰玩家／GPT 訊息（同分鐘推定）":""}`);
};
async function beginHistoricalScan(type){
  if(!chat){notice('請先開啟 ChatGPT 對話',true);return}
  const {watch={},profilesByChat={}}=await getStorage(['watch','profilesByChat']);
  const target=profilesByChat[chat];
  if(watch[chat]!==true||!target){notice('請先綁定此對話到正確輪迴，並開啟監看',true);return}
  const replay=$('replayExisting').checked===true;
  if(type==='bulk-down'&&!confirm(`從目前畫面開始，向下掃描至對話底端並上傳完整回合。\n目標：${targetLabel(target)}\n\n每一則皮卡必須有 GPT 回覆、每一則 GPT 回覆也必須有皮卡發言；若有一邊缺漏或跨畫面無法確認連續，會停止且整批不傳送。採小步慢速掃描，請勿手動捲動畫面。${replay?'\n注意：本次會重新傳送同輪迴先前已傳過的訊息，Firestore 已存在的來源仍會去重。':''}開始？`))return;
  const result=await sendTab({type,replay});
  if(!result?.ok){notice('無法開始：'+(result?.error||'請重整 ChatGPT 頁面'),true);return}
  notice(type==='bulk-down'?`已開始從目前畫面向下掃描。\n起點：${result.preview||'目前畫面'}\n進度請看 ChatGPT 畫面右上角面板。`:'請回到 ChatGPT 頁面，用滑鼠點選起點、捲動或拖曳、點選終點，最後按浮動面板「確認上傳」。');
  $('bulkStatus').textContent='操作已啟動；請查看 ChatGPT 頁面上的浮動面板。';
}
$('scanDown').onclick=()=>beginHistoricalScan('bulk-down');
$('pickRange').onclick=()=>beginHistoricalScan('bulk-range');
$('backfill').onclick=async()=>{
  if(!chat){notice('請先切換到 ChatGPT 對話',true);return}
  const {watch={}}=await getStorage(['watch']);
  if(watch[chat]!==true){notice('請先啟用此對話的監看',true);return}
  const {profilesByChat={}}=await getStorage(['profilesByChat']);
  const target=profilesByChat[chat];
  if(!target){notice('這個對話尚未綁定輪迴',true);return;}
  if(!confirm('將回補此對話已顯示的歷史訊息（最多 200 則）。\n目標：'+targetLabel(target)+'\n輪迴 ID：'+target.cycleId+'\n\n只包含網頁載入的歷史，不含附件或超長訊息。請再次確認這個輪迴正確！'))return;
  const result=await sendTab({type:'backfill-visible'});
  if(!result?.ok){notice(result?.error||'無法呼叫回補功能；請重新整理 ChatGPT 頁面',true);return}
  notice(`已排入最多 ${result.queued} 則目前可見的訊息（玩家 ${result.userCount}／GPT ${result.aiCount}），會逐則傳送。${result.tooLong?'\n略過超長訊息 '+result.tooLong+' 則。':''}${result.limited?'\n超過單次上限 '+result.limited+' 則，請分批操作。':''}${result.expanded?'\n'+result.expanded:''}`);
};
$('stop').onclick=async()=>{
  if(!chat)return;
  const {watch={}}=await getStorage(['watch']);
  delete watch[chat];await saveStorage({watch});await sendTab({type:'end-watch'});showWatch(false);notice('已停止監看這個對話。');
};

async function refreshDiagnostics(){
  const d=$('diagnostics');
  if(!chat){d.textContent='偵測診斷：請切換到已開啟的 ChatGPT 對話';return;}
  const result=await sendTab({type:'diagnostics'});
  if(!result?.ok){d.textContent='偵測診斷：無法連線到 ChatGPT 頁面；請重新整理該頁面';return;}
  if(result.bulkStatus)$('bulkStatus').textContent=result.bulkStatus.progress;
  const storyNode=$('storyHintsStatus');
  if(storyNode)storyNode.textContent=`目前已載入訊息：Gal AI 劇情時間 ${result.storyTimeCount||0} 處／疑似跳過片段 ${result.skipCueCount||0} 則\n${result.storyTimePreview?'劇情時間例：'+result.storyTimePreview+'\n':''}劇情時間由檔案館 V5.31 排序，這裡只提供線索，不修改現實發言時間。`;
  d.textContent=`偵測診斷：共 ${result.nodeCount} 則（玩家 ${result.userCount}／ChatGPT ${result.aiCount}）｜${result.enabled?'監看啟用':'監看未啟用'}\n模式：${result.mode || '未知'}\nGPT 標記：${result.assistantMarkers??'未提供'}／回合容器：${result.turnCount??'未提供'}／備援 GPT：${result.fallbackAiCount??0}／未判明回合：${result.ambiguousTurns??0}\n最後一則：${result.latest||'無'}${result.autoTime?'\n自動擷取選單時間：開啟':''}${result.timeResults?'\n擷取：'+result.timeResults:''}${result.collapsedCount?'\n⚠ 未展開長訊息：'+result.collapsedCount+' 則':''}${result.expansionStatus?'\n'+result.expansionStatus:''}${result.detectWarning?'\n'+result.detectWarning:''}${result.error?'\n錯誤：'+result.error:''}`;
  d.className='notice'+(result.detectWarning?' bad':'');
}
$('refresh').onclick=async()=>{await Promise.all([refreshDiagnostics(),refreshTimePanels(),refreshLastWrite()]);};
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.lastTimeCapture||changes.lastTimeUpload||changes.lastTimeCaptureByChat||changes.lastTimeUploadByChat)refreshTimePanels();
  if(changes.last||changes.lastByChat)refreshLastWrite();
  if(changes.bulkByChat && chat){
    const batch=changes.bulkByChat.newValue?.[chat];
    if(batch)$('bulkStatus').textContent=batch.progress;
  }
});
refreshDiagnostics();
$('predecessorUp').onclick=async()=>{if(!chat)return notice('請先開啟 ChatGPT 聊天',true);const title=$('predecessorTitle').value.trim();if(!title)return notice('請填寫聊天名稱',true);const r=await sendTab({type:'predecessor-history-up',title});notice(r?.ok?'已開始；請回聊天頁面查看向上掃描狀態。':'無法開始：'+(r?.error||'請重新整理該聊天頁面'),!r?.ok)};

$('predecessorTestTen').onclick=async()=>{if(!chat)return notice('請先開啟 ChatGPT 聊天',true);const title=$('predecessorTitle').value.trim();if(!title)return notice('請填寫聊天名稱',true);const r=await sendTab({type:'predecessor-history-up',title,sample:true});notice(r?.ok?'已開始最近十則測試；請回聊天頁面。':'無法開始：'+(r?.error||'請重新整理該聊天頁面'),!r?.ok)};
