/* Independent Gal AI page scanner. v0.10.9: independent history-source-only supplement. */
(() => {
'use strict';
if(globalThis.GalArchivePageScanner)return;
const SCANNER_VERSION='0.10.9';
 // Large JSON is retained in the isolated page and pulled by its owning
 // background document in small, independently checked pieces. No story
 // content is sent to the network or persisted outside the existing exports.
 const GAL_WIRE_CHARS=256*1024, GAL_INLINE_CHARS=128*1024;
 const galTransferTexts=new Map();
 async function galWireHash(text){
  const bytes=new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 }
 async function galWireEnvelope(message,fields){
  const out={...message},tokens=[];
  try{
   for(const field of fields){
    const value=out[field];
    if(typeof value!=='string'||value.length<=GAL_INLINE_CHARS)continue;
    if(value.length>256*1024*1024)throw Error('單份掃描資料超過256Mi UTF-16 units，請先本機保全');
    const token=crypto.randomUUID();
    const descriptor={galWire:1,token,length:value.length,count:Math.ceil(value.length/GAL_WIRE_CHARS),sha256:await galWireHash(value)};
    galTransferTexts.set(token,{value,field,scanRunId:message.scanRunId,cycleId:message.cycleId});
    tokens.push(token);out[field]=descriptor;
    setTimeout(()=>galTransferTexts.delete(token),15*60*1000);
   }
   return {out,tokens};
  }catch(error){for(const token of tokens)galTransferTexts.delete(token);throw error}
 }
 async function galSendEvidence(message){
  let tokens=[];
  try{
   const envelope=await galWireEnvelope(message,['result','diagnostic','unverified','text']);
   tokens=envelope.tokens;
   // A transient worker interruption can request the same page-held bytes again.
   let response;
   for(let attempt=0;attempt<2;attempt++){
    try{response=await chrome.runtime.sendMessage(envelope.out);break}
    catch(error){if(attempt===1)throw error}
   }
   if(!response?.ok&&message.type==='gal-run-finish')throw Error(response?.error||'掃描輸出未確認');
   return response;
  }catch(error){
   if(message.type==='gal-run-finish'){
    await chrome.runtime.sendMessage({type:'gal-run-export-failed',scanRunId:message.scanRunId,cycleId:message.cycleId,
     scanned:message.scanned,scanOutcome:message.state,transportError:String(error.message||error).slice(0,500)}).catch(()=>{});
   }
   return {ok:false,error:String(error.message||error)};
  }finally{for(const token of tokens)galTransferTexts.delete(token)}
 }

const core=globalThis.GalArchiveCore;
function formatEvidenceReady(){const a=globalThis.GalArchiveFormatEvidence;return a?.version===SCANNER_VERSION&&typeof a.summarize==='function'&&typeof a.inspectRaw==='function'}
function requireFormatEvidence(){if(!formatEvidenceReady())throw Error('原生格式驗收模組未載入或版本不符；請重新整理 WHIF 並開啟最新版掃描助手');return globalThis.GalArchiveFormatEvidence}
const STOP='gal-scanner-stop',STYLE='gal-scanner-style',PANEL='gal-scanner-panel';
const SCROLL_RATIO=.31,MAX_SCROLL_PX=350,WAIT_MS=420,STABLE_MS=350,BOTTOM_CONFIRM_MS=8000,BOTTOM_POLL_MS=750;
let busy=false,cancelled=false,paused=false,lastResult=null,target=null,calibration=null,picking=false,diagnostic=null;
let activeRun=null,activeScanRows=null,lastFailureIndices=[];
const localDifferences=new Map();
const nativePlayerTextCache=new Map(); // One React bridge read per WHIF user source.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const $=id=>document.getElementById(id);
function bindingStateIssue(requested,state,currentSource){
 if(!state?.ok)return '無法讀取目前 WHIF 頁面綁定：'+(state?.error||'請重開掃描助手');
 if(state.source!==currentSource)
  return 'WHIF 聊天網址正在切換，請確認頁面載入完成後重新讀取綁定。';
 const bound=state.profile;
 if(!bound?.cycleId||!bound?.worldName)
  return '目前 WHIF 聊天尚未儲存輪迴綁定。請使用右下角「🧭 開啟輪迴掃描助手」完成綁定。';
 if(requested?.cycleId&&(requested.cycleId!==bound.cycleId||
    requested.worldName&&requested.worldName!==bound.worldName||
    requested.cycleTitle&&requested.cycleTitle!==bound.cycleTitle))
  return '掃描面板的輪迴「'+(requested.cycleTitle||requested.cycleId)+
   '」與目前 WHIF 頁面綁定「'+(bound.cycleTitle||bound.cycleId)+
   '」不一致。請按「🔄 重新讀取目前綁定」確認後再掃描；本次未匯出任何正史。';
 return '';
}
async function fetchCurrentBinding(requested=null){
 const reply=await chrome.runtime.sendMessage({type:'gal-page-binding-state'});
 const currentSource=location.origin+location.pathname.replace(/\/$/,'');
 const issue=bindingStateIssue(requested,reply,currentSource);
 if(issue)throw Error(issue);
 return reply.profile;
}
async function refreshBoundTarget(){
 if(busy){status('掃描進行中，無法變更目標輪迴');return}
 try{
  const p=await fetchCurrentBinding();
  const names=Array.isArray(p.managerNames)?p.managerNames:String(p.manager||'').split(/[、，,;；\r\n]/u).filter(Boolean);
  if(!names.length||names.length>2)throw Error('目前綁定的副駕駛欄位無效，請重新儲存');
  target={uid:String(p.uid||''),worldName:p.worldName,cycleId:p.cycleId,
   cycleTitle:String(p.cycleTitle||''),managerNames:names};
  status('✅ 已重新讀取這個 WHIF 聊天的輪迴綁定：'+target.worldName+'／'+(target.cycleTitle||target.cycleId)+
   '\n尚未開始掃描。請確認名稱正確，再按「▶ 開始／重新掃描」。');
 }catch(error){status('⛔ '+String(error?.message||error))}
}
function mount(){
 if($(PANEL))return $(PANEL);
 const css=document.createElement('style');css.id=STYLE;css.textContent=
  '#'+PANEL+'{position:fixed!important;z-index:2147483646!important;right:12px!important;top:12px!important;width:min(390px,calc(100vw - 24px))!important;max-height:75vh!important;overflow:auto!important;padding:14px!important;border-radius:13px!important;background:#132039!important;color:#f7eaff!important;font:13px/1.5 system-ui!important;box-shadow:0 10px 50px #000a!important;border:1px solid #9574d2!important;text-align:left!important}'+
  '#'+PANEL+' button{font:inherit;padding:7px 9px;margin:4px;border:1px solid #a28adf;background:#5a468c;color:white;border-radius:7px;cursor:pointer}'+
  '#'+PANEL+' button:disabled{opacity:.5}#'+PANEL+' textarea{box-sizing:border-box;width:100%;resize:vertical}'+
  '#'+PANEL+' pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}';
 document.documentElement.append(css);
 const p=document.createElement('aside');p.id=PANEL;p.setAttribute('role','status');
 p.dataset.galExtensionId=chrome.runtime.id;p.dataset.galScannerVersion=SCANNER_VERSION;
 p.innerHTML='<strong>📚 Gal AI 原生正史掃描器 V'+SCANNER_VERSION+' 測試版</strong>'+
 '<div id="gal-scan-info" style="white-space:pre-wrap;margin:9px 0">準備中…</div>'+
 '<div><button id="gal-scan-export" disabled>下載原生正史 JSON</button>'+
 '<button id="gal-scan-save-progress">🧷 保全已讀進度（不可匯入）</button>'+
 '<div style="margin:6px 0"><label>指定索引（0 起算） <input id="gal-scan-index-input" type="number" min="0" step="1" style="width:95px"></label>'+
 '<button id="gal-scan-position-index">指定位置測試</button>'+
 '<button id="gal-scan-position-visible">測目前畫面</button>'+
 '<button id="gal-scan-position-last-error">測上次錯誤位置</button></div>'+
 '<details id="gal-anchor-tools"><summary>🧪 指定原生錨點復原取證</summary>'+
 '<label>原生訊息 ID <input id="gal-anchor-id" maxlength="100" style="width:95%"></label>'+
 '<label>上次可信 Y <input id="gal-anchor-y" type="number" min="0" step="any" style="width:110px"></label>'+
 '<label>上次頁面高度（選填） <input id="gal-anchor-height" type="number" min="1" step="any" style="width:110px"></label>'+
 '<label>目標劇情時間（選填，YYYY/MM/DD HH:mm） <input id="gal-anchor-clock" maxlength="24" style="width:95%"></label>'+
 '<label>已知相鄰來源 ID（選填，一行一個） <textarea id="gal-anchor-neighbors" rows="3" maxlength="2000" style="width:95%"></textarea></label>'+
 '<button id="gal-anchor-probe">執行錨點復原取證（不匯入）</button>'+
 '<button id="gal-player-anchor-probe">👤 取證目前畫面的玩家來源（含隱藏訊息）</button></details>'+
 '<button id="gal-history-source">📋 僅補取歷史來源清單（不解析正文）</button>'+
 '<div><button id="gal-transport-replay">🧪 保全檔傳輸重播（不掃描、不匯入）</button><input id="gal-transport-file" type="file" accept=".json,application/json" hidden></div>'+
 '<div style="margin:6px 0"><button id="gal-scan-open-folder">📁 顯示最近下載資料夾</button>'+
 '<button id="gal-scan-copy-folder">📋 複製批次路徑</button></div>'+
 '<button id="gal-scan-pick">🎯 點選開場校準</button><button id="gal-scan-refresh-binding">🔄 重新讀取目前綁定</button><button id="gal-scan-retry">▶ 開始／重新掃描</button>'+
 '<button id="gal-scan-preview">掃 3 則停下（開場測試）</button><button id="gal-scan-event-probe">🎯 事件三則測試</button></div>'+
 '<details open><summary>首則 AI 回覆的段落驗收</summary>'+
 '<label for="gal-scan-native-copy">無法自動讀取時，可貼上 Gal AI「複製」的完整首則 AI 回覆</label>'+
 '<textarea id="gal-scan-native-copy" rows="3" maxlength="30000" spellcheck="false"></textarea>'+
 '<button id="gal-scan-paragraph-preview">用原生來源驗收三則</button></details>'+
 '<div><button id="gal-scan-diagnostics">📋 複製版面診斷</button><button id="gal-scan-download-diagnostics">下載版面診斷 JSON</button>'+
 '<label id="gal-scan-difference-label" hidden>差異位置 <select id="gal-scan-difference-row"></select></label>'+
 '<button id="gal-scan-difference" hidden>在本機查看字元差異</button>'+
 '<button id="gal-scan-pause">暫停掃描</button>'+
 '<button id="gal-scan-cancel">停止掃描</button><button id="gal-scan-close">關閉</button></div>';
 document.documentElement.append(p);
 $('gal-scan-pause').onclick=()=>{if(busy){paused=true;status('已要求暫停，正在儲存診斷。')}};
 $('gal-scan-cancel').onclick=()=>{cancelled=true;status('已要求停止。未下載、未修改任何歸檔資料。')};
 $('gal-scan-open-folder').onclick=async()=>{
  if(!activeRun?.scanRunId)return status('此分頁尚無掃描批次');
  const response=await chrome.runtime.sendMessage({type:'gal-run-open-folder',
   scanRunId:activeRun.scanRunId,cycleId:target?.cycleId}).catch(error=>({error:String(error)}));
  if(response?.ok)status('已請 Windows 檔案總管顯示批次下載檔');
  else status('無法開啟下載位置：'+(response?.error||'未知錯誤'));
 };
 $('gal-scan-copy-folder').onclick=()=>{
  const path=activeRun?.batchFolder;
  if(!path)return status('尚無固定批次路徑');
  const full=activeRun?.statusPath?
    activeRun.statusPath.replace(/[/\\][^/\\]+$/,''):
    '下載\\'+path.replaceAll('/','\\');
  if(navigator.clipboard?.writeText)
   navigator.clipboard.writeText(full).then(()=>status('已複製批次路徑：'+full))
    .catch(()=>status(full));
  else status(full);
 };
 $('gal-scan-position-index').onclick=()=>positionSevenProbe('index');
 $('gal-scan-position-visible').onclick=()=>positionSevenProbe('visible');
 $('gal-scan-position-last-error').onclick=()=>positionSevenProbe('last-error');
 $('gal-anchor-probe').onclick=()=>anchorRecoveryProbe();
 $('gal-player-anchor-probe').onclick=()=>playerAnchorProbe();
 $('gal-history-source').onclick=()=>historySourceProbe();
 $('gal-transport-replay').onclick=()=>{if(!busy&&target)$('gal-transport-file').click();else status('請先確認綁定，且不得中斷掃描')};
 $('gal-transport-file').onchange=async()=>{
  const file=$('gal-transport-file').files?.[0];$('gal-transport-file').value='';
  if(!file||busy||!target)return;
  busy=true;
  try{
   if(file.size>256*1024*1024)throw Error('重播檔超過安全上限');
   const bytes=await file.arrayBuffer(),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=JSON.parse(text);
   const fileHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(await galWireHash(text)!==fileHash)throw Error('原檔不是可無損重播的UTF-8（可能有BOM）');
   if(data.format!=='gal-ai-unverified-scan'||data.importable!==false||data.forensicOnly!==true||
      data.target?.cycleId!==target.cycleId||data.source?.url!==location.origin+location.pathname)
    throw Error('僅接受目前輪迴的原始未驗證保全');
   await fetchCurrentBinding(target);
   status('正在使用原始檔重播兩段傳輸，未操作對話畫面…');
   const expected=await galWireHash(text);
   const r=await galSendEvidence({type:'gal-run-transport-replay',cycleId:target.cycleId,scanRunId:crypto.randomUUID(),text,sha256:expected});
   if(!r?.ok||r.status?.sha256!==expected)throw Error(r?.error||'傳輸重播未通過');
   status('✅ 保全檔重播下載完成，請核對原檔與下載檔 SHA-256\n'+r.status.filePath+'\n'+expected);
  }catch(error){status('⛔ '+String(error.message||error))}
  finally{busy=false}
 };
 $('gal-scan-pick').onclick=()=>chooseOpening();
 $('gal-scan-refresh-binding').onclick=()=>refreshBoundTarget();
 $('gal-scan-retry').onclick=()=>{if(!busy&&target)scan(target);else status('請先從擴充功能設定輪迴，或等目前掃描結束')};
 $('gal-scan-preview').onclick=()=>{if(!busy&&target)scan(target,true);else status('請先從擴充功能設定輪迴，或等目前掃描結束')};
 $('gal-scan-event-probe').onclick=()=>{if(!busy&&target)eventThreeRowProbe(target);else status('請先從擴充功能設定輪迴，或等目前掃描結束')};
 $('gal-scan-paragraph-preview').onclick=()=>{if(!busy&&target)scan(target,true,true);else status('請先從擴充功能設定輪迴，或等目前掃描結束')};
 $('gal-scan-diagnostics').onclick=()=>{const report=diagnostic||inspect();
   const sanitized=JSON.stringify(report,null,2);
   if(navigator.clipboard?.writeText){navigator.clipboard.writeText(sanitized).then(()=>status('已複製版面診斷（僅 DOM 類別／數量，不包含對話原文）：\n'+sanitized)).catch(()=>status(sanitized))}
   else status(sanitized)};
 $('gal-scan-download-diagnostics').onclick=()=>downloadJson('Gal_AI_版面診斷_',diagnostic||inspect());
 $('gal-scan-difference').onclick=()=>{
  const select=$('gal-scan-difference-row');
  const index=Number(select.value);
  const difference=localDifferences.get(index);
  if(difference)status(select.selectedOptions[0].textContent+'\n首個字元差異（只顯示在本頁）\n掃描：'+
   difference.scanned+'\n候選：'+difference.native);
 };
 $('gal-scan-close').onclick=()=>{if(busy)cancelled=true;p.remove();css.remove()};
 $('gal-scan-save-progress').onclick=()=>saveProgressSnapshot();
 $('gal-scan-export').onclick=async()=>{if(busy||!lastResult||!lastResult.validation?.ok||(!lastResult.validation.nativeFormatComplete&&lastResult.scope!=='opening-first-pair-preview'))return;
   if(!activeRun?.scanRunId||!activeRun?.batchFolder||!diagnostic)return status('沒有已核對批次，請重新掃描；不在下載根目錄重複建立正式正史。');
   busy=true;
   try{
    status('正在核對原批次並重試已驗收正史的下載，不重新掃描。');
    const result=await galSendEvidence({type:'gal-run-finish',...activeRun,state:'completed',scanned:lastResult.rawRows,
     result:JSON.stringify(lastResult,null,2),diagnostic:JSON.stringify(diagnostic,null,2)});
    if(!result?.ok||result.status?.state!=='completed')return status('正史下載尚未確認：'+(result?.error||result?.status?.reason||'請等待原批次終態'));
    $('gal-scan-open-folder').click();
   }finally{busy=false}
 };
 return p;
}
// Local rescue does not rely on the background worker or on the 4-hour
// deadline. A progress snapshot is explicitly NOT an authoritative scan;
// keep both visible and native source text for later forensic recovery.

// Failed scan evidence always remains downloadable, never canonical.
// Preserve all gathered DOM markdown (quotes/italics/fences), native React
// message text, original order, provenance and independently parsed clocks.
function unverifiedEvidence(rows,run,why,fullDiagnostic){
 const data=(rows||[]).map((row,scanIndex)=>{
  const native=row.formatSource?.nativeReply||null;
  return {scanIndex,role:row.role,eventType:row.eventType||null,
   worldName:row.worldName||null,autoContinue:row.autoContinue===true,
   domText:row.text,originalText:row.text,
   nativeText:native?.reason==='available'?native.text:
    row.role==='me'&&row.formatSource?.playerSources?.length&&
    row.formatSource.playerSources.every(x=>x.nativeReason==='available')?
     row.formatSource.playerSources.map(x=>x.nativeText).join('\n\n'):null,
   nativeTextUnavailableReason:native?.reason==='available'||(
    row.role==='me'&&row.formatSource?.playerSources?.length&&
    row.formatSource.playerSources.every(x=>x.nativeReason==='available'))?
    null:native?.reason||(
     row.role==='me'?'native-user-message-source-unavailable':'native-reader-not-captured'),
   sourceMessageId:native?.messageId||null,
   sourceEvidence:native?.eventEvidence||null,
   nativeMarkerCount:native?.markerCount??null,
   playerSources:row.formatSource?.playerSources||[],
   originalTimeHeader:core.clean(row.text).split('\n').slice(0,12),
   parsedGameTime:core.parseGameTime(row.text)||null,
   nativeParsedGameTime:native?.text?core.parseGameTime(native.text):null,
   explicitUnknownGameTime:core.isExplicitUnknownGameTime(row.text),
   formatSource:row.formatSource||null};
 });
 return {format:'gal-ai-unverified-scan',version:1,importable:false,
  validated:false,complete:false,forensicOnly:true,
  generatedAt:new Date().toISOString(),scanRunId:run?.scanRunId||null,
  scannerVersion:SCANNER_VERSION,coreVersion:core.version,
  target:{cycleId:target?.cycleId,cycleTitle:target?.cycleTitle,
   worldName:target?.worldName},
  source:{url:location.origin+location.pathname},scope:'unverified-read-progress',
  collectedCount:data.length,rawRows:data.length,
  failure:why||null,phase:fullDiagnostic?.phase||null,phaseHistory:fullDiagnostic?.phaseHistory||[],failedPhase:fullDiagnostic?.failedPhase||null,bottomProof:fullDiagnostic?.bottomProof||null,eventAudit:fullDiagnostic?.eventAudit||null,historySourceManifest:fullDiagnostic?.historySourceManifest||null,
  errors:fullDiagnostic?.errorContexts||[],errorContextEvidence:fullDiagnostic?.errorContextEvidence||null,rows:data,
  note:'不具正式正史效力，禁止直接匯入檔案館或 Firebase；不捏造時間、來源文字或未讀歷史。'};
}
function failureContexts(rows,validation,reason){
 const errs=validation?.errors?.length?validation.errors:[reason].filter(Boolean);
 const sourceFor=row=>row?.formatSource?.nativeReply;
 const indices=new Set();
 const issues=[];
 for(const error of errs){
  const m=String(error).match(/第\s*(\d+)\s*則/);
  if(m){const at=Number(m[1])-1;indices.add(at);issues.push({scanIndex:at,error})}
  else issues.push({scanIndex:null,error,unavailableReason:'錯誤沒有全輪掃描索引'});
 }
 const primary=[...indices][0]??null;
 const evidence=new Map();
 const serialize=(row,index)=>{
  if(!row)return null;
  if(evidence.has(index))return evidence.get(index);
  const native=sourceFor(row),users=row.formatSource?.playerSources||[];
  const nativeText=native?.reason==='available'?native.text:
   row.role==='me'&&users.length&&users.every(x=>x.nativeReason==='available')?
    users.map(x=>x.nativeText).join('\n\n'):null;
  let compare=null;
  if(typeof nativeText==='string'&&nativeText){
   try{
    const examined=core.compareNativeParagraphs(row.text,nativeText,{
     source:row.eventType==='event'?'whif-event-content':'whif-message-content',
     event:row.eventType==='event',
     verifiedUntimedNative:!core.parseGameTime(row.text)
    });
    compare={contentEqual:examined.comparison?.contentEqual??null,
     clockEqual:examined.comparison?.clockEqual??null,
     exactDifference:examined.comparison?.firstDifference||null,
     remainingUnexplained:examined.comparison?.remainingUnexplained||null,
     localContext:examined.localContext||null,
     reason:examined.text===null?'native-text-or-clock-not-proven':'native-content-matched'};
   }catch(error){compare={error:String(error.message||error)}}
  }
  const result={scanIndex:index,role:row.role,eventType:row.eventType||null,
   domText:row.text,nativeText,
   nativeUnavailableReason:nativeText!==null?null:native?.reason||(
    row.role==='me'?'player-native-source-unavailable':'not-captured'),
   sourceMessageId:native?.messageId||null,
   playerSources:row.formatSource?.playerSources||[],
   sourceEvidence:native?.eventEvidence||null,
   classificationBasis:row.eventType==='event'?'WHIF event header + source evidence':
    row.role==='ai'?'WHIF reply header + reaction toolbar':'between adjacent WHIF AI toolbars',
   originalTimeHeader:core.clean(row.text).split('\n').slice(0,12),
   parsedTime:core.parseGameTime(row.text)||null,
   nativeParsedTime:nativeText?core.parseGameTime(nativeText):null,
   explicitUnknown:core.isExplicitUnknownGameTime(row.text),compare};
  evidence.set(index,result);return result;
 };
 const ref=(row,index)=>{
  const entry=serialize(row,index);
  return entry?{scanIndex:index,sourceMessageId:entry.sourceMessageId}:null;
 };
 const errorContexts=issues.map(({scanIndex,error,unavailableReason})=>({
  scanIndex,error,
  cascadePossible:primary!==null&&scanIndex!==null&&scanIndex>primary,
  cascadeExplanation:primary!==null&&scanIndex>primary?
   '前方第 '+(primary+1)+' 則已經失敗；本訊息配對可能是連鎖異常':null,
  unavailableReason:unavailableReason||null,
  message:scanIndex!==null&&rows[scanIndex]?ref(rows[scanIndex],scanIndex):null,
  context:scanIndex===null?[]:
   rows.slice(Math.max(0,scanIndex-3),Math.min(rows.length,scanIndex+4))
    .map((row,j)=>ref(row,Math.max(0,scanIndex-3)+j))
 }));
 return {errorContexts,errorContextEvidence:{format:'gal-error-context-refs',version:1,rows:[...evidence.values()].sort((a,b)=>a.scanIndex-b.scanIndex)}};
}

async function saveProgressSnapshot(){
 if(!activeScanRows?.length){
  status('目前沒有已讀掃描資料，禁止輸出空白或偽造的正史');return false;
 }
 const run=activeRun;
 const data=unverifiedEvidence(activeScanRows,run,'人工保全已讀進度',diagnostic||{});
 status('🧷 正在保全 '+data.collectedCount+' 則；若背景佇列未回應將啟用本頁備援下載。');
 if(run?.scanRunId&&run?.batchFolder){
  try{
   let timer;
   const result=await Promise.race([galSendEvidence({type:'gal-run-manual-save',
    scanRunId:run.scanRunId,cycleId:run.cycleId,unverified:JSON.stringify(data)}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('背景下載佇列等待超過 180 秒')),180000)})]).finally(()=>clearTimeout(timer));
   if(result?.ok&&result.status?.files?.unverified&&(result.status?.unverifiedCount??0)>=data.collectedCount){
    status('🧷 '+(target?.cycleTitle||'輪迴')+' 已保全 '+
     data.collectedCount+' 則。\\n'+
     '批次：'+result.status.batchFolder+'\\n'+
     'Chrome 已核對：'+(result.status.files?.unverified||'未驗證掃描資料.json')+
     '\\n不得直接匯入正式正史。');
    return true;
   }
   throw Error(result?.error||'下載未完成');
  }catch(error){
   status('背景批次保全未成功：'+String(error.message||error)+
    '\\n將啟用本頁的緊急本機下載；名稱與批次路徑可能無法歸類。');
  }
 }
 // Fallback solely for an already-invalidated extension worker. It MUST
 // remain non-importable; do not sacrifice user evidence to folder aesthetics.
 await downloadJson('Gal_AI_緊急未驗證保全_',data);
 status('🧷 已請 Chrome 緊急下載 '+data.collectedCount+' 則未驗證保全；請核對下載完成。原始批次仍保留。');
 return true;
}
async function downloadJson(prefix,data){
 const meta={worldName:data.target?.worldName||data.worldName||target?.worldName||null,cycleTitle:data.target?.cycleTitle||data.cycleTitle||target?.cycleTitle||null,cycleId:data.target?.cycleId||data.cycleId||target?.cycleId||null};
 const payload={...data,...meta};
 const kind=prefix.includes('保全')?'unverified':'diagnostic';
 try{
  await fetchCurrentBinding(target);
  const result=await galSendEvidence({type:'gal-run-download-extra',kind,cycleId:meta.cycleId,scanRunId:crypto.randomUUID(),text:JSON.stringify(payload)});
  if(result?.ok){status('已下載獨立證據批次：'+result.status.filePath);return true;}
  throw Error(result?.error||'背景下載無回應');
 }catch(error){
  status('無法分類下載，改用本頁緊急下載：'+String(error.message||error));
  // Only emergency evidence can fall back to a flat browser download. It
  // remains non-importable and is conspicuously labelled for review.
 }
 const a=document.createElement('a');
 const blob=new Blob([JSON.stringify({...payload,importable:false,cycleNumber:data.cycleNumber??data.target?.cycleNumber??activeRun?.cycleNumber??null,archiveKey:null,classificationPending:true},null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 a.href=url;
 a.download=(kind==='unverified'?'待分類_緊急保全_':'待分類_緊急診斷_')+(target?.worldName||'世界觀待確認')+'_'+(target?.cycleTitle||'輪迴').replace(/[\\/:*?"<>|]/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.json';
 document.documentElement.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
 return true;
}
function status(msg){const n=$('gal-scan-info');if(n)n.textContent=String(msg);}

function isDocumentRoot(el){return el===document.scrollingElement||el===document.documentElement||el===document.body}
function scrollCandidates(){
 const list=[...document.querySelectorAll('main,[role="main"],[role="log"],[role="feed"],section,article,div')];
 const roots=list.filter(el=>{
  if(el.closest('#'+PANEL))return false;
  const r=el.getBoundingClientRect(),st=getComputedStyle(el);
  return r.height>220&&r.width>250&&r.bottom>40&&r.top<innerHeight
    &&el.scrollHeight-el.clientHeight>130&&/(?:auto|scroll|overlay)/.test(st.overflowY);
 });
 roots.sort((a,b)=>{
  const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
  return (br.width>=innerWidth*.55?100:0)-(ar.width>=innerWidth*.55?100:0)
   +(br.height-ar.height)*.5
   +(b.scrollHeight-b.clientHeight-a.scrollHeight+a.clientHeight)*.001;
 });
 return roots;
}
function scroller(){
 if(calibration?.root?.isConnected)return calibration.root;
 return scrollCandidates()[0]||document.scrollingElement||document.documentElement;
}
const rowSelectors=[
 '[data-message-id]','[data-testid="message"]','[data-testid*="message"]',
 '[data-message-role]','[data-role="user"]','[data-role="assistant"]',
 '[role="article"]','[role="listitem"]',
 '.chat-message','.message-item','.message-row','.chat-item','.chat-bubble-row',
 '[class*="message"]','[class*="Message"]','[class*="bubble"]','[class*="Bubble"]',
 '[class*="reply"]','[class*="Reply"]','[class*="response"]','[class*="Response"]',
 '[class*="chat-item"]','[class*="chatItem"]','[class*="turn-item"]'
];
function isVisible(node,root){
 if(!node||!node.isConnected||node.closest('#'+PANEL))return false;
 const r=node.getBoundingClientRect(),container=isDocumentRoot(root)?
  {top:0,bottom:innerHeight,left:0,right:innerWidth}:root.getBoundingClientRect();
 if(r.width<35||r.height<10||r.bottom<container.top-50||r.top>container.bottom+50
   ||r.right<container.left||r.left>container.right)return false;
 const st=getComputedStyle(node);
 return st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0';
}
function roleOf(node,root){
 const classes=[node.getAttribute('data-role'),node.getAttribute('data-message-role'),node.getAttribute('data-testid'),
  node.className?.baseVal||node.className||'',node.getAttribute('style')||''].join(' ').toLowerCase();
 if(/\b(user|human|player|outgoing|mine|my-message|is-user|from-user)\b/.test(classes))return 'me';
 if(/\b(assistant|incoming|bot|ai-message|is-bot|from-ai)\b/.test(classes))return 'ai';
 const style=getComputedStyle(node),bg=style.backgroundColor||'';
 const color=bg.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
 if(color){const [r,g,b]=color.slice(1).map(Number);
  if(r>45&&b>r*1.15&&b>g*1.15)return 'me'}
 const rect=node.getBoundingClientRect();
 const container=isDocumentRoot(root)?{left:0,right:innerWidth,width:innerWidth}:root.getBoundingClientRect();
 const relativeLeft=(rect.left-container.left)/(container.width||1);
 if(relativeLeft>.52&&rect.width<container.width*.81)return 'me';
 if(relativeLeft<.33)return 'ai';
 const align=style.alignSelf||style.justifySelf||'';
 if(/end|right/.test(align))return 'me';
 if(/start|left/.test(align))return 'ai';
 return null;
}
function genericRows(root){
 // Fallback for UIs with anonymous / generated CSS classes. The outermost
 // role-homogeneous message body is wanted, never each of its paragraphs.
 const all=[...root.querySelectorAll('article,li,[role="listitem"],[role="article"],[class*="bubble"],[class*="Bubble"],p,div,section')];
 const content=n=>core.clean(n.innerText||'');
 const pool=all.filter(n=>{
  if(n===root||!isVisible(n,root)||n.matches('button,input,textarea,[role="toolbar"],nav,header,footer'))return false;
  const t=content(n);if(t.length<8||t.length>25000)return false;
  if(n.scrollHeight-n.clientHeight>200&&/auto|scroll/.test(getComputedStyle(n).overflowY))return false;
  const role=roleOf(n,root);if(!role)return false;
  // A feed/container contains both speakers. Don't turn the entire conversation
  // into a single left-aligned "AI" message.
  const descendants=[...n.querySelectorAll('p,article,blockquote,[class*="bubble"],[class*="Bubble"],[class*="message"],[class*="Message"]')]
    .filter(x=>x!==n&&isVisible(x,root)&&content(x).length>=8);
  if(descendants.some(x=>roleOf(x,root)&&roleOf(x,root)!==role))return false;
  return true;
 });
 // Prefer a complete multiline message wrapper instead of its child paragraphs.
 // A container that also encloses another complete role-separated bubble is
 // already filtered out above.
 return pool.filter(n=>!pool.some(parent=>parent!==n&&parent.contains(n)
   &&roleOf(parent,root)===roleOf(n,root)));
}
function calibratedRows(root){
 if(!calibration?.node?.isConnected)return [];
 const parent=calibration.node.parentElement;
 if(!parent)return [];
 const candidates=[...parent.children].filter(node=>isVisible(node,root)&&node.tagName===calibration.node.tagName
  &&core.clean(node.innerText||'').length>=8);
 return candidates.length?[...candidates]:[calibration.node];
}
function candidateRows(root){
 const raw=[...root.querySelectorAll(rowSelectors.join(','))].filter(n=>{
  if(!isVisible(n,root)||n.matches('button,[role="toolbar"],textarea,input'))return false;
  const text=core.clean(n.innerText||'');
  return text.length>=8&&text.length<=25000;
 });
 const byRole=raw.filter(n=>roleOf(n,root));
 const groupable=byRole.filter(n=>{
  const role=roleOf(n,root);
  return !byRole.some(ch=>ch!==n&&n.contains(ch)&&roleOf(ch,root)!==role);
 });
 let out=groupable.filter(n=>!groupable.some(parent=>parent!==n&&parent.contains(n)));
 if(!out.length)out=genericRows(root);
 if(calibration?.node?.isConnected){
  const picked=calibratedRows(root);
  const merged=new Set([...picked,...out]);
  out=[...merged].filter(n=>!picked.some(p=>p!==n&&p.contains(n)));
 }
 // Reject UI controls and rows whose text is mostly tab/tool chrome.
 out=out.filter(n=>!n.closest('nav,header,footer,[role="toolbar"]')&&
  !/^(?:複製|設定|BL故事|發送|新增書籤|前往最新)/.test(core.clean(n.innerText||'')));
 return out.map(node=>({node,role:node===calibration?.node?'ai':roleOf(node,root),rect:node.getBoundingClientRect()}))
  .filter(x=>x.role).sort((a,b)=>a.rect.top-b.rect.top||a.rect.left-b.rect.left);
}
function inspect(){
 const root=scroller(),r=root.getBoundingClientRect();
 const candidates=scrollCandidates();
 const common=[...root.querySelectorAll(rowSelectors.join(','))];
 return {
  version:SCANNER_VERSION,pageOrigin:location.origin,
  root:{tag:root.tagName,className:String(root.className||'').slice(0,150),
    scrollTop:root.scrollTop,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight,
    width:Math.round(r.width),height:Math.round(r.height)},
  scrollableCount:candidates.length,
  scrollableSample:candidates.slice(0,5).map(n=>({tag:n.tagName,cls:String(n.className||'').slice(0,90),
    sh:n.scrollHeight,ch:n.clientHeight,w:Math.round(n.getBoundingClientRect().width)})),
  knownSelectors:common.length,
  genericCandidates:genericRows(root).length,
  worldHeaderMarkers:boundaryTitles(root).length,
  eventHeaderMarkers:boundaryHeaders(root).filter(x=>x.kind==='event').length,
  reactionBarMarkers:boundaryToolbars(root).length,
  boundedReplies:boundaryRead(root).debug.completeAI,
  boundedEvents:boundaryRead(root).debug.completeEvents,
  recognizedRows:target?.worldName?boundaryRead(root).rows.length:candidateRows(root).length,
  calibrated:!!calibration?.node?.isConnected,
  iframeCount:document.querySelectorAll('iframe').length
 };
}
function openingNode(target,root){
 // Select an ancestor that looks like one message, preferring containers
 // with comparable sibling messages, not a single paragraph.
 const ancestors=[];
 for(let n=target;n&&n!==root&&n!==document.body&&ancestors.length<12;n=n.parentElement){
  if(!isVisible(n,root))continue;
  const t=core.clean(n.innerText||''),r=n.getBoundingClientRect();
  if(t.length<8||t.length>25000||r.width<110)continue;
  const parent=n.parentElement;
  const siblings=parent?[...parent.children].filter(x=>x!==n&&x.tagName===n.tagName
    &&core.clean(x.innerText||'').length>=8):[];
  const semantic=/message|bubble|reply|chat|turn|response|prose|markdown/i.test(String(n.className||''));
  const opposite=siblings.some(x=>roleOf(x,root)!==roleOf(n,root));
  const score=(opposite?35:siblings.length?6:0)+(semantic?17:0)+(r.width>250?3:0)
    +(r.height>55?8:0)+Math.min(t.length/400,10)
    -(n.tagName==='P'?24:0)-(parent===document.body?60:0);
  ancestors.push({node:n,score,siblings:siblings.length});
 }
 ancestors.sort((a,b)=>b.score-a.score);
 return ancestors[0]?.node||null;
}
function chooseOpening(){
 if(busy){status('先停止正在執行的掃描，才能校準');return}
 if(picking){status('目前正在等待你點選左側開場訊息');return}
 picking=true;status('🎯 請在 Gal AI 頁面直接點選第一則「左側、沒有時間的輪迴開場」文字。\\n不會送出訊息，也不會立即覆蓋資料。');
 const listener=ev=>{
  if(ev.target.closest('#'+PANEL))return;
  ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
  document.removeEventListener('click',listener,true);picking=false;
  const nearest=ev.target.closest('main,article,[role="log"],div,section,p')||ev.target;
  const root=(()=>{let n=nearest;while(n&&n!==document.body){const st=getComputedStyle(n);
   if(n.scrollHeight-n.clientHeight>140&&/auto|scroll|overlay/.test(st.overflowY))return n;
   n=n.parentElement}return scroller()})();
  const node=openingNode(ev.target,root);
  if(!node){status('這個位置無法識別訊息文字，請改點左側開場的正文');return}
  calibration={node,root};
  diagnostic=inspect();
  status('已校準開場候選：'+node.tagName+'，文字 '+core.clean(node.innerText||'').length+
   ' 字；可見同層候選 '+calibratedRows(root).length+' 則。\\n按「🔁 重新掃描」測試；若仍失敗，按「複製版面診斷」。');
 };
 document.addEventListener('click',listener,true);
}

/* Gal AI message boundaries.
 * Header "《current world》" begins an AI message; the message's like/reaction
 * bar ends it. Neither header nor button row is archived as story prose.
 * This is deliberately separate from the ChatGPT assistant extractor.
 */
function boundaryOrder(a,b){
 if(a===b)return 0;
 const v=a.compareDocumentPosition(b);
 return v&Node.DOCUMENT_POSITION_FOLLOWING?-1:v&Node.DOCUMENT_POSITION_PRECEDING?1:0;
}
function boundaryFollows(a,b){return !!(a&&b&&(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING))}
function boundaryDirectText(n){
 return [...(n.childNodes||[])].filter(x=>x.nodeType===Node.TEXT_NODE)
   .map(x=>x.nodeValue||'').join('').replace(/\s+/g,' ').trim();
}
// Resolve only the closest native message owner. Never infer sender from story text.
// Cache per boundary pass, not across virtualized mounts.
function boundaryNativeOwner(node,cache){
 const wrapper=node.closest?.('[data-message-id]')||node.closest?.(nativeMessageSelector);
 if(!wrapper)return null;
 if(cache.has(wrapper))return cache.get(wrapper);
 const id=wrapper.getAttribute('data-message-id')||wrapper.getAttribute('data-selection-copy-message-id');
 if(!id){cache.set(wrapper,null);return null;}
 const markers=[...(wrapper.querySelectorAll?.(nativeMessageSelector)||[])].filter(n=>
  n.getAttribute('data-selection-copy-message-id')===id&&
  (!n.closest('[data-message-id]')||n.closest('[data-message-id]')===wrapper));
 if(wrapper.getAttribute('data-selection-copy-message-id')===id)markers.unshift(wrapper);
 // The bridge validates its React message ID. Conflicting or unavailable
 // evidence stays unknown; it must never cause a player exclusion.
 const proofs=[...new Set([...markers,wrapper])].map(n=>readNativeNode(n,true).eventEvidence)
  .filter(e=>e?.messageId===id&&typeof e.sender==='string'&&e.sender);
 const senders=[...new Set(proofs.map(e=>e.sender))];
 const owner={id,sender:senders.length===1?senders[0]:null};
 cache.set(wrapper,owner);
 return owner;
}
function boundaryToolbarMatches(heading,toolbar,cache){
 const a=heading.owner,b=boundaryNativeOwner(toolbar,cache);
 if(b?.sender==='user')return false;
 if(a?.id&&b?.id)return a.id===b.id;
 // For proven native headings, do not borrow a strip of unknown ownership.
 if(a?.id&&a.sender)return false;
 // Unproven legacy structures retain the original bounded positional checks.
 return true;
}
function boundaryHeaders(root,ownerCache=new Map()){
 const name=core.normalizedWorld(target?.worldName||'');
 if(!name)return [];
 const elements=[...root.querySelectorAll('span,strong,b,p,h1,h2,h3,h4,label,div')];
 const candidates=[];
 for(const n of elements){
  if(n.closest('#'+PANEL+',button,[role="button"],nav,[role="navigation"]'))continue;
  // The event author heading is "與《世界觀》的事件"; ordinary AI replies
  // have just "《世界觀》". Keep BOTH as explicit, distinct boundaries.
  const direct=boundaryDirectText(n),shown=core.clean(n.innerText||'');
  // The world name can be nested inside the event label.
  const found=[direct,shown].filter(Boolean).map(raw=>{
   const normalized=core.normalizedWorld(raw);
   const kind=normalized==='與'+name+'的事件'||normalized===name+'的事件'?'event':
     normalized===name||normalized==='與'+name?'reply':null;
   return {raw,kind};
  }).find(x=>x.kind&&x.raw.length<=name.length+22);
  if(!found)continue;
  const kind=found.kind;
  const style=getComputedStyle(n);
  if(style.display==='none'||style.visibility==='hidden')continue;
  const owner=boundaryNativeOwner(n,ownerCache);
  if(owner?.sender==='user')continue;
  candidates.push({node:n,kind,owner});
 }
 // Event's outer banner wins over the nested 《世界觀》 span.
 const withoutNestedEvent=candidates.filter(a=>!candidates.some(b=>b!==a&&b.kind==='event'&&b.node.contains(a.node)));
 const minimal=withoutNestedEvent.filter(a=>!withoutNestedEvent.some(b=>b!==a&&a.node.contains(b.node)));
 return minimal.sort((a,b)=>boundaryOrder(a.node,b.node));
}
function boundaryTitles(root){return boundaryHeaders(root).filter(h=>h.kind==='reply').map(h=>h.node)}
function boundaryIconTag(n){
 const icon=n.querySelector?.('svg,use,img')||n;
 const attrs=['aria-label','title','data-testid','data-icon','class','href','alt','data-lucide','name'];
 return [n,icon].map(x=>attrs.map(a=>String(x.getAttribute?.(a)||'')).join(' ')).join(' ').toLowerCase();
}
function boundaryIsLike(n){return /thumbs[-_ ]?up|hand[-_ ]?thumb|like(?:-button)?|upvote|點讚|点赞|喜歡|按讚|讚好|赞同/i.test(boundaryIconTag(n))}
function boundaryToolbars(root){
 // The thumbs action strip can contain bare SVGs nested in spans/divs
 // instead of HTML buttons. Detect a small horizontal row of 4–8 icons.
 const svgs=[...root.querySelectorAll('svg')].filter(svg=>!svg.closest(
  '#'+PANEL+',nav,form,[role="textbox"],[role="dialog"],[contenteditable="true"]'));
 const matched=new Set();
 function isStrip(n){
  if(!n||n===root||n.closest('#'+PANEL+',nav,form,[role="textbox"],[role="dialog"],[contenteditable="true"]'))
   return false;
  const icons=[...n.querySelectorAll('svg')];
  if(icons.length<4||icons.length>8)return false;
  const bounds=icons.map(x=>x.getBoundingClientRect());
  const spread=Math.max(...bounds.map(x=>x.left))-Math.min(...bounds.map(x=>x.left));
  const ys=bounds.map(x=>x.top+x.height/2).sort((a,b)=>a-b);
  const mid=ys[Math.floor(ys.length/2)];
  const r=n.getBoundingClientRect();
  return r.width>=60&&r.width<Math.min(innerWidth*.9,760)&&r.height<110
    &&spread>=40&&spread<690&&bounds.filter(x=>Math.abs(x.top+x.height/2-mid)<=16).length>=4
    &&core.clean(n.innerText||'').length<80;
 }
 for(const svg of svgs){
  let p=svg.parentElement;
  for(let depth=0;p&&p!==root&&depth<8;depth++,p=p.parentElement){
   if(isStrip(p)){matched.add(p);break;}
  }
 }
 return [...matched].filter(x=>![...matched].some(y=>y!==x&&x.contains(y))).sort(boundaryOrder);
}

const nativeMessageSelector='[data-selection-copy-message-id]';
function readNativeNode(node,evidenceOnly=false,historyOnly=false,playerDetail=false){
 const response='gal-archive-native-reply-response-v1';
 let source={reason:'native-reader-unavailable'};
 const receive=event=>{
  if(event.target!==node||typeof event.detail!=='string')return;
  try{
   const data=JSON.parse(event.detail);
   if(playerDetail&&data?.reason==='player-anchor-evidence'&&typeof data.text==='string'&&data.text.length<=30000&&data.eventEvidence?.sender==='user')source=data;
   else if(evidenceOnly&&data?.reason==='evidence'&&data.eventEvidence)source=data;
   else if(!evidenceOnly&&data?.reason==='available'&&typeof data.text==='string'&&data.text.length<=30000)source=data;
   else if(data?.reason==='message-content-unavailable')source={reason:data.reason};
  }catch{ /* An unreadable bridge response leaves the source unavailable. */ }
 };
 node.addEventListener(response,receive);
 try{node.dispatchEvent(new CustomEvent('gal-archive-native-reply-request-v1',{
  bubbles:true,detail:playerDetail?'player-anchor-evidence':historyOnly?'history-source-evidence':evidenceOnly?'event-evidence':null
 }))}
 finally{node.removeEventListener(response,receive)}
 return source;
}
function nativeReplySource(nodes){
 const distinct=new Map([...nodes].map(node=>[node.getAttribute('data-selection-copy-message-id'),node]));
 distinct.delete('');
 const markerCount=distinct.size;
 if(!markerCount)return {reason:'message-marker-unavailable',markerCount};
 if(markerCount!==1)return {reason:'ambiguous-message-markers',markerCount};
 const node=distinct.values().next().value;
 return {...readNativeNode(node),markerCount,messageId:node.getAttribute('data-selection-copy-message-id')};
}
function boundaryFragmentText(start,end,role='ai',trace,metadata,event=false){
 if(!boundaryFollows(start,end))return '';
 const range=document.createRange();range.setStartAfter(start);range.setEndBefore(end);
 const holder=document.createElement('div');
 const live=core.copyRangeWithLiveStyles(range,trace);
 holder.appendChild(live.fragment);
 if(diagnostic){
  diagnostic.styleSnapshots=(diagnostic.styleSnapshots||0)+1;
  if(!live.mapped)diagnostic.styleSnapshotFailures=(diagnostic.styleSnapshotFailures||0)+1;
 }
 // Controls embedded in an incomplete DOM fragment are not game narration.
 holder.querySelectorAll('button,[role="button"],[role="toolbar"],svg,style,script,textarea,input').forEach(n=>n.remove());
 const text=core.markdownFromDom(holder,{role,trace,metadata,event,worldName:target?.worldName}).trim().replace(/^(?:回到最初|前往最新訊息|前往最新消息)\s*$/gm,'').trim();
 if(metadata){
  const base=range.commonAncestorContainer;
  const markers=[...(base.querySelectorAll?.(nativeMessageSelector)||[])].filter(node=>range.intersectsNode(node));
  if(base.matches?.(nativeMessageSelector))markers.unshift(base);
  metadata.nativeReply=nativeReplySource(markers);
  metadata.nativeReply.scannedText=text;
 }
 return text;
}

// Identify individual native WHIF user markers in a rendered player gap.
// Native source IDs remain internal; diagnostics publish hashes only.
function nativePlayerSourcesBetween(start,end,forceFresh=false){
 if(!boundaryFollows(start,end))return [];
 const range=document.createRange();range.setStartAfter(start);range.setEndBefore(end);
 const ancestor=range.commonAncestorContainer;
 const base=ancestor.nodeType===Node.ELEMENT_NODE?ancestor:ancestor.parentElement;
 if(!base?.querySelectorAll)return [];
 const out=new Map();
 const take=node=>{
  if(!range.intersectsNode(node))return;
  const id=node.getAttribute('data-selection-copy-message-id');
  if(!id||out.has(id))return;
  const evidence=readNativeNode(node,true).eventEvidence;
  out.set(id,{id,sender:evidence?.sender||null,kind:evidence?.kind||null,
   hasText:Boolean(core.clean(node.textContent||'')),
   hasMedia:Boolean(node.querySelector('img,video,audio,[data-attachment-id]')),
   sourceNode:node});
 };
 if(base.matches?.(nativeMessageSelector))take(base);
 for(const node of base.querySelectorAll(nativeMessageSelector))take(node);
 // Save each native user message in page memory once. This also preserves
 // exact per-source player text for ordinary one-source player turns.
 for(const item of out.values()){
  let proof=forceFresh?null:nativePlayerTextCache.get(item.id);
  if(!proof){
   const original=readNativeNode(item.sourceNode);
   proof={nativeReason:original?.reason||'unavailable',
    nativeText:original?.reason==='available'?original.text:null,
    nativeSender:original?.eventEvidence?.sender||null,
    nativeMessageId:original?.eventEvidence?.messageId||null};
   nativePlayerTextCache.set(item.id,proof);
  }
  Object.assign(item,proof);
  delete item.sourceNode; // Never retain DOM node pointers in snapshots.
 }
 return [...out.values()];
}

function candidatePlayerGap(start,end,previousId,currentId){
 const range=document.createRange();range.setStartAfter(start);range.setEndBefore(end);
 const markers=new Map();
 for(const node of range.commonAncestorContainer.querySelectorAll?.(nativeMessageSelector+', [data-message-id]')||[]){
  if(!range.intersectsNode(node))continue;
  const id=node.getAttribute('data-selection-copy-message-id')||node.getAttribute('data-message-id');
  if(!id||id===previousId||id===currentId||markers.has(id))continue;
  const evidence=readNativeNode(node,true).eventEvidence;
  const hasText=!!core.clean(node.textContent);
  const hasMedia=!!node.querySelector('img,video,audio,[data-attachment-id]');
  markers.set(id,{sourceRef:hash(id),sender:evidence?.sender||null,hasText,hasMedia});
 }
 const loading=[...(range.commonAncestorContainer.querySelectorAll?.('[aria-busy="true"], [role="progressbar"], [data-loading="true"]')||[])]
  .some(node=>range.intersectsNode(node));
 return {markers:[...markers.values()],loading};
}
function boundaryRead(root,traceFirst=false,captureNative=false,probeTrace=null){
 const ownerCache=new Map();
 const headings=boundaryHeaders(root,ownerCache),tools=boundaryToolbars(root);
 const rows=[],debug={headers:headings.filter(h=>h.kind==='reply').length,
  eventHeaders:headings.filter(h=>h.kind==='event').length,
  reactionBars:tools.length,completeAI:0,completeEvents:0,playerGaps:0,
  incompleteAI:0,mode:'world-heading-and-action-toolbar'};
 const eventHeaders=headings.filter(h=>h.kind==='event').map(h=>({node:h.node,reason:'unreached-header'}));
 const eventHeadersByNode=new Map(eventHeaders.map(h=>[h.node,h]));
 if(!headings.length)return {rows,debug,eventHeaders};
 const pairs=[];
 let firstTimedTrace=null;
 for(let i=0;i<headings.length;i++){
  const heading=headings[i],start=heading.node,next=headings[i+1]?.node||null;
  // Both "👍 👎 複製" and "✎ 👍 👎 書籤 更多" end a Gal AI item.
  const strips=tools.filter(t=>boundaryFollows(start,t)&&(!next||boundaryFollows(t,next))&&boundaryToolbarMatches(heading,t,ownerCache));
  const probe=probeTrace?{headingIndex:i,kind:heading.kind,heading:anchorProbeElement(start),
   nextHeading:next?anchorProbeElement(next):null,toolbarCandidates:strips.map(anchorProbeElement),outcome:'pending'}:null;
  if(probe)probeTrace.push(probe);
  if(!strips.length){
   if(probe)probe.outcome='action-toolbar-not-found';
   if(eventHeadersByNode.has(start))eventHeadersByNode.get(start).reason='action-toolbar-not-found';
   debug.incompleteAI++;break;
  }
  const trace=traceFirst&&!firstTimedTrace&&heading.kind==='reply'?{}:undefined;
  const metadata=captureNative?{}:undefined;
  const end=strips[0],text=boundaryFragmentText(start,end,'ai',trace,metadata,heading.kind==='event');
  if(trace&&core.parseGameTime(text)&&!core.isEvent(text))firstTimedTrace=trace;
  if(probe){probe.bodyLength=text.length;probe.nativeId=metadata?.nativeReply?.messageId||null;probe.nativeReason=metadata?.nativeReply?.reason||null;probe.markerCount=metadata?.nativeReply?.markerCount??null;probe.outcome='serialized'}
  if(text.length<8||text.length>25000){
   if(probe)probe.outcome='body-length-rejected';
   if(eventHeadersByNode.has(start))eventHeadersByNode.get(start).reason='event-body-incomplete';
   debug.incompleteAI++;break;
  }
  if(eventHeadersByNode.has(start))eventHeadersByNode.get(start).reason='serialized';
  pairs.push({start,end,text,kind:heading.kind,metadata});
 }
 for(let i=0;i<pairs.length;i++){
  const item=pairs[i];
  if(i){
   const visibleGap=boundaryFragmentText(pairs[i-1].end,item.start,'me');
   const playerSources=captureNative?nativePlayerSourcesBetween(pairs[i-1].end,item.start):[];
   let gap=visibleGap;
   let playerTemplateProjection=null;
   // A complete AI event is not itself a user turn.
   // A player can answer with one character. Controls and navigation
   // labels have already been removed from this bounded DOM range.
   {
    const templateCandidate=playerSources.some(s=>/\{\{[^{}]*\}\}/u.test(s.nativeText||''));
    const playerGapHasMedia=captureNative&&(playerSources.length>1||templateCandidate)?(()=>{
     const range=document.createRange();
     range.setStartAfter(pairs[i-1].end);range.setEndBefore(item.start);
     const base=range.commonAncestorContainer;
     return [...(base.querySelectorAll?.('img,video,audio,[data-attachment-id]')||[])]
      .some(node=>range.intersectsNode(node)&&
       !node.closest('#'+PANEL+',button,[role="button"],[role="toolbar"]'));
    })():false;
    if(captureNative&&templateCandidate){
     const projected=core.restorePlayerTemplates(visibleGap,playerSources,playerGapHasMedia);
     if(!projected.ok)throw Error('玩家原生模板投影未通過：'+projected.reason+'；禁止遺失原文或猜測');
     if(projected.applied){
      // Re-read source without cache before accepting invisible native text.
      const second=nativePlayerSourcesBetween(pairs[i-1].end,item.start,true);
      const verified=core.restorePlayerTemplates(visibleGap,second,playerGapHasMedia);
      if(!verified.ok||!verified.applied||verified.text!==projected.text||
         JSON.stringify(playerSources)!==JSON.stringify(second))throw Error('玩家模板原生來源兩次核對不一致');
      gap=projected.text;
      playerTemplateProjection={kind:'verified-player-native-template',visibleText:visibleGap};
     }
    }
    if(gap){
     rows.push({role:'me',text:gap,id:'',top:item.start.getBoundingClientRect().top-1,
      formatSource:captureNative?{playerSources,playerGapHasMedia,...(playerTemplateProjection?{playerTemplateProjection}:{})}:undefined});
     debug.playerGaps++;
    }
   }
   if(!gap&&item.metadata&&item.kind==='reply'&&pairs[i-1].kind==='reply'){
    item.metadata.playerGap={
     previousId:pairs[i-1].metadata?.nativeReply?.messageId||null,
     currentId:item.metadata.nativeReply?.messageId||null,
     previous:pairs[i-1].metadata?.nativeReply?.eventEvidence?.sender||null,
     current:item.metadata.nativeReply?.eventEvidence?.sender||null,
     ...candidatePlayerGap(pairs[i-1].end,item.start,
      pairs[i-1].metadata?.nativeReply?.messageId,item.metadata.nativeReply?.messageId)
    };
   }
  }
  const row={role:'ai',text:item.text,id:'',top:item.start.getBoundingClientRect().top,
   formatSource:item.metadata,scanNode:item.start};
  if(probeTrace)row.probeBoundary={start:item.start,end:item.end};
  if(item.kind==='event'){
   row.eventType='event';row.worldName=target?.worldName||'';
   debug.completeEvents++;
  }else debug.completeAI++;
  rows.push(row);
 }
 return {rows,debug,firstTimedTrace,eventHeaders};
}

function messageText(node,role='ai',trace,metadata){
 // Prefer the rendered message body; remove menu/action chrome from copy.
 const body=node.querySelector('[data-message-content],[data-testid*="message-content"],.markdown,.prose,.message-content,.bubble-content')
  ||node;
 const event=role==='ai'&&core.isEvent(body.innerText||'');
 const text=core.markdownFromDom(body,{role,trace,metadata,event,worldName:target?.worldName}).replace(/\n(?:複製訊息|編輯訊息|新增書籤|點讚|點踩)\s*$/gm,'').trim();
 if(metadata){
  const markers=[...node.querySelectorAll(nativeMessageSelector)];
  if(node.matches(nativeMessageSelector))markers.unshift(node);
  metadata.nativeReply=nativeReplySource(markers);
  metadata.nativeReply.scannedText=text;
 }
 return text;
}
function snapshot(fixedRoot=null,preferredMode='auto',traceFirst=false,captureNative=false){
 const root=fixedRoot?.isConnected?fixedRoot:scroller();
 const anchored=target?.worldName?boundaryRead(root,traceFirst&&preferredMode!=='legacy',captureNative&&preferredMode!=='legacy'):
  {rows:[],debug:{headers:0,reactionBars:0,completeAI:0}};
 diagnostic={...(diagnostic||{}),...anchored.debug};
 // Regression fix: v0.7.3 ALWAYS returned empty when two markers were not
 // simultaneously recognized, disabling the 0.7.2 scanner that read 4 turns.
 // Keep that parser as a live fallback; freeze mode per scan to avoid mixing
 // two incompatible message segmentation systems midway through the timeline.
 if(preferredMode==='bounded'||(preferredMode==='auto'&&anchored.rows.length)){
  return {root,rows:anchored.rows,method:'world-header-reaction-bar',boundaryDebug:anchored.debug,
   firstTimedTrace:anchored.firstTimedTrace,eventHeaders:anchored.eventHeaders};
 }
 const rs=candidateRows(root);
 let firstTimedTrace=null;
 const rows=rs.map(({node,role,rect})=>{
  const trace=traceFirst&&!firstTimedTrace&&role==='ai'?{}:undefined;
  const metadata=captureNative&&role==='ai'?{}:undefined;
  const text=messageText(node,role,trace,metadata);
  if(trace&&core.parseGameTime(text)&&!core.isEvent(text))firstTimedTrace=trace;
  // data-testid is usually shared by EVERY bubble (e.g. "message"), not a unique ID.
  // Comparing it as identity could silently skip a different message of the same role.
  const id=node.getAttribute('data-message-id')||node.getAttribute('data-id')||'';
  return {role,text,id,top:rect.top,node,formatSource:metadata};
 }).filter(r=>r.text.length>5);
 const start=calibration?.node?.isConnected?rows.findIndex(r=>r.node===calibration.node):-1;
 return {root,rows:(start>=0?rows.slice(start):rows).map(({node,...rest})=>({...rest,scanNode:node})),
   method:'legacy-dom',boundaryDebug:anchored.debug,firstTimedTrace,eventHeaders:anchored.eventHeaders};
}
/* Repeated literal text is common ("嗯", "..."). Never globally deduplicate
 * by text: merge overlapping windows as an ORDERED sequence instead. */
function sameRow(a,b){
 if(a.role!==b.role||(a.eventType||null)!==(b.eventType||null))return false;
 const aNative=a.formatSource?.nativeReply?.messageId,bNative=b.formatSource?.nativeReply?.messageId;
 if(aNative&&bNative&&aNative!==bNative)return false;
 const ap=a.formatSource?.playerSources?.map(s=>s.id),bp=b.formatSource?.playerSources?.map(s=>s.id);
 if(a.role==='me'&&ap?.length&&bp?.length&&JSON.stringify(ap)!==JSON.stringify(bp))return false;
 return a.id&&b.id&&a.id===b.id||a.text===b.text;
}
function appendSample(sample,all){
 const incoming=sample.rows.map(r=>({role:r.role,text:r.text,domId:r.id||null,id:r.id||null,
   eventType:r.eventType||null,worldName:r.worldName||null,formatSource:r.formatSource}));
 if(!incoming.length)throw Error('當前視窗沒有可比對的訊息');
 if(all.length===0){all.push(...incoming.map(({id,...rest})=>rest));return {repeated:0,added:incoming.length}}
 // The next viewport may still contain the ENTIRE last viewport, including
 // its old beginning. Find an ordered *suffix* of stored messages ANYWHERE
 // in the incoming window, not only at the incoming window's first row.
 let size=0,matches=[];
 const max=Math.min(all.length,incoming.length);
 for(let k=max;k>=1;k--){
  const candidates=[];
  for(let start=0;start<=incoming.length-k;start++){
   if(incoming.slice(start,start+k).every((x,j)=>sameRow(x,all[all.length-k+j])))
    candidates.push(start);
  }
  if(candidates.length){size=k;matches=candidates;break}
 }
 if(!size)throw Error('目前畫面與上一視窗無法找到順序重疊，已停止以免漏掉對話');
 // Repeated identical "嗯" messages can make a one-message anchor ambiguous.
 // Never guess which occurrence was already collected.
 if(matches.length>1){
  const strong=matches.filter(start=>incoming.slice(start,start+size).some(x=>!!x.id));
  if(size<2||strong.length!==1)throw Error('重疊錨點不唯一，可能是重複短句造成，拒絕跳過對話');
  matches=strong;
 }
 const start=matches[0];
 if(size===1&&!incoming[start].id&&all.filter(x=>sameRow(x,incoming[start])).length>1)
  throw Error('重複短句錨點不唯一，已安全停止');
 for(let i=0;i<size;i++){
  const old=all[all.length-size+i],next=incoming[start+i];
  const oldSource=old.formatSource?.nativeReply,nextSource=next.formatSource?.nativeReply;
  if(old.text===next.text&&oldSource?.reason!=='available'&&nextSource?.reason==='available'&&
   (!oldSource?.messageId||oldSource.messageId===nextSource.messageId))old.formatSource=next.formatSource;
 }
 const extra=incoming.slice(start+size).map(({id,...rest})=>rest);
 all.push(...extra);
 return {repeated:size,added:extra.length,anchorPosition:start};
}
function observeEventAudit(audit,shot,collected,alignment){
 const offset=alignment?collected.length-alignment.added-alignment.repeated-(alignment.anchorPosition||0):null;
 const anchors=offset===null?[]:shot.rows.flatMap((row,index)=>{
  const scanIndex=offset+index;
  return row.scanNode&&scanIndex>=0&&scanIndex<collected.length
   ?[{node:row.scanNode,scanIndex,id:row.formatSource?.nativeReply?.messageId}]:[];
 });
 const position=node=>{
  const exact=anchors.find(row=>row.node===node);
  if(exact)return {scanIndex:exact.scanIndex};
  const next=anchors.find(row=>boundaryFollows(node,row.node));
  const previous=anchors.findLast(row=>boundaryFollows(row.node,node));
  return {scanIndex:null,afterScanIndex:previous?.scanIndex??null,beforeScanIndex:next?.scanIndex??null};
 };
 for(const h of shot.eventHeaders||[]){
  const anchor=anchors.find(row=>row.node===h.node);
  const key=anchor?.id||h.node;
  if(anchor?.id)audit.headers.delete(h.node);
  const old=audit.headers.get(key);
  if(old?.scanIndex!=null&&h.reason!=='serialized')continue;
  audit.headers.set(key,{...position(h.node),reason:h.reason});
 }
 const remember=(evidence,node)=>{
  if(!evidence?.messageId||!['event-message','event-card'].includes(evidence.kind))return false;
  const prior=audit.native.get(evidence.messageId);
  const here=position(node);
  audit.native.set(evidence.messageId,{...here,kind:evidence.kind,
   seenAsCard:evidence.kind==='event-card'||!!prior?.seenAsCard,
   accepted:evidence.accepted===true||prior?.accepted===true?true:evidence.accepted??prior?.accepted??null});
  return true;
 };
 const captured=new Map();
 if(offset!==null)for(const [index,row] of shot.rows.entries()){
  const scanIndex=offset+index;
  if(row.role!=='me'||scanIndex<0||scanIndex>=collected.length||
   collected[scanIndex]?.role!=='me')continue;
  for(const source of row.formatSource?.playerSources||[]){
   if(!source.id)continue;
   if(!audit.playerSourceRows.has(source.id))audit.playerSourceRows.set(source.id,new Set());
   audit.playerSourceRows.get(source.id).add(scanIndex);
  }
 }
 for(const row of shot.rows){
  const evidence=row.formatSource?.nativeReply?.eventEvidence;
  if(evidence?.messageId){
   captured.set(evidence.messageId,evidence);
   if(row.scanNode)remember(evidence,row.scanNode);
  }
 }
 // Read separately from the serializer so an unexported event can be
 // observed even if its toolbar or header was not recognized.
 for(const node of shot.root.querySelectorAll(nativeMessageSelector+', [data-message-id]')){
  if(!node.getClientRects().length)continue;
  const id=node.getAttribute('data-selection-copy-message-id')||node.getAttribute('data-message-id');
  const cached=audit.probes.get(node);
  const evidence=captured.get(id)||(cached?.messageId===id?cached:null)||readNativeNode(node,true).eventEvidence;
  if(evidence?.kind==='ordinary-message')audit.probes.set(node,evidence);
  if(id&&(!audit.history.has(id)||evidence?.kind!=='unknown-message'&&evidence?.kind))
   audit.history.set(id,evidence?.kind||'unreadable');
  if(id&&evidence?.sender)audit.senders.set(id,evidence.sender);
  if(id&&evidence?.sender==='user'){
   const near=position(node),old=audit.userNearby.get(id);
   audit.userNearby.set(id,{
    first:old?.first||near,last:near,sightings:(old?.sightings||0)+1,
    hasText:old?.hasText||Boolean(core.clean(node.textContent||'')),
    hasMedia:old?.hasMedia||Boolean(node.querySelector('img,video,audio,[data-attachment-id]'))
   });
  }
  remember(evidence,node);
 }
 // WHIF's pending event card uses the reject/accept action row; it may not
 // have a transcript message marker. Inspect its component prop, not labels.
 for(const group of shot.root.querySelectorAll('.flex.h-9.w-full.items-center.gap-3')){
  if(!group.getClientRects().length)continue;
  const buttons=[...group.children].filter(node=>node.matches('button,[role="button"]'));
  if(buttons.length<2)continue;
  const evidence=readNativeNode(buttons[0],true).eventEvidence;
  if(remember(evidence,group))audit.unverifiedCards.delete(group);
  else audit.unverifiedCards.set(group,position(group));
 }
}

/*
 * Prove each WHIF continuation independently. A global comparison of
 * history.size versus collected.length is invalid: source markers describe
 * original WHIF message nodes whereas bounded scan rows include synthesized
 * player gaps. Count disagreement alone is diagnostic, NOT proof of a
 * missing player message. Fail closed if a locally observed user marker or a
 * native assistant/event message is truly unaccounted for.
 *
 * Never infer an auto-continue from a timestamp or from text similarity.
 */

/*
 * A rendered player gap can contain multiple native user IDs.
 * This audit explains the units rather than declaring two missing turns
 * from a count difference alone. It never authorizes a canonical export.
 */

/*
 * Strict source-preserving merge. A player *turn* can contain consecutive
 * WHIF user messages. We keep one me/AI turn for the canonical importer,
 * but require complete ordered React content for EVERY native source.
 * Media and any non-whitespace mismatch FAIL CLOSED, never guessed away.
 */
function proveMergedPlayerSources(row,expectedIds){
 const sources=row?.formatSource?.playerSources;
 const errors=[],expected=new Set(expectedIds||[]);
 const check=(bad,error)=>{if(bad)errors.push(error)};
 const current=Array.isArray(sources)?sources:[];
 const ids=current.map(x=>x.id);
 check(!Array.isArray(sources)||current.length<2,'native-user-sources-not-captured');
 check(ids.length!==new Set(ids).size,'duplicate-native-source-id-in-gap');
 check(ids.length!==expected.size||ids.some(id=>!expected.has(id)),'observed-gap-id-set-mismatch');
 check(row?.formatSource?.playerGapHasMedia===true,'unverified-gap-media');
 for(const source of current){
  check(source.sender!=='user'||source.kind!=='ordinary-message','native-sender-not-user');
  check(source.nativeReason!=='available'||typeof source.nativeText!=='string'||
   !source.nativeText.trim(),'native-content-unavailable');
  check(source.nativeMessageId!==source.id||source.nativeSender!=='user','native-content-id-or-sender-mismatch');
  check(source.hasMedia===true||/\{\{\s*(?:img|image)\s*:/i.test(source.nativeText||'')||
   /!\[[^\]]*\]\([^)]+\)/.test(source.nativeText||''),'source-media-needs-manual-verification');
 }
 const unspaced=value=>String(value||'').replace(/\s/gu,'');
 const nativeText=current.map(x=>x.nativeText||'').join('');
 const renderedText=String(row?.text||'');
 const sourceKey=unspaced(nativeText),renderedKey=unspaced(renderedText);
 check(!sourceKey||sourceKey!==renderedKey,'merged-player-text-not-exactly-preserved');
 const ok=errors.length===0;
 return {ok,errors,sourceCount:current.length,
  nativeSourceHashes:ids.filter(Boolean).map(hash),
  originalNonWhitespaceChars:[...sourceKey].length,
  renderedNonWhitespaceChars:[...renderedKey].length,
  originalContentHash:hash(sourceKey),renderedContentHash:hash(renderedKey),
  exactNonWhitespaceMatch:sourceKey===renderedKey&&sourceKey.length>0,
  mediaPresent:current.some(x=>x.hasMedia===true)||row?.formatSource?.playerGapHasMedia===true};
}

function analyzePlayerSourceDifference(collected,history,senders,links,nearby){
 const playerIndices=collected.flatMap((row,index)=>row.role==='me'?[index]:[]);
 const observed=[...history.keys()].filter(id=>senders.get(id)==='user');
 const observedSet=new Set(observed);
 const perRow=new Map(playerIndices.map(index=>[index,new Set()]));
 for(const [id,indices] of links||[]){
  for(const index of indices)if(perRow.has(index))perRow.get(index).add(id);
 }
 const mapped=observed.filter(id=>links?.has(id));
 const unmapped=observed.filter(id=>!links?.has(id)).map(id=>({
  sourceHash:hash(id),nearFirst:nearby?.get(id)?.first||null,
  nearLast:nearby?.get(id)?.last||null,
  sightings:nearby?.get(id)?.sightings||0,
  hasText:nearby?.get(id)?.hasText===true,
  hasMedia:nearby?.get(id)?.hasMedia===true
 }));
 const adjacentAi=index=>{
  const before=collected.slice(0,index).findLast(row=>row?.role==='ai');
  const after=collected.slice(index+1).find(row=>row?.role==='ai');
  const sourceHash=row=>row?.formatSource?.nativeReply?.messageId
   ?hash(row.formatSource.nativeReply.messageId):null;
  return {previousAiSourceHash:sourceHash(before),nextAiSourceHash:sourceHash(after),
   playerTextLength:String(collected[index]?.text||'').length};
 };
 const multiSourceRows=[...perRow].filter(([,ids])=>ids.size>1)
  .map(([scanIndex,ids])=>({scanIndex,nativeUserSourceCount:ids.size,
   sourceHashes:[...ids].map(hash),...adjacentAi(scanIndex),
   contentProof:proveMergedPlayerSources(collected[scanIndex],ids)}));
 const rowsWithoutProvenUserMarker=[...perRow].filter(([,ids])=>
  ![...ids].some(id=>observedSet.has(id))).map(([scanIndex])=>scanIndex);
 const multipleRows=[...(links||new Map())].filter(([id,indices])=>
  observedSet.has(id)&&indices.size>1).map(([id,indices])=>({
   sourceHash:hash(id),scanIndices:[...indices].sort((a,b)=>a-b)
  }));
 const notObserved=[...(links||new Map()).keys()]
  .filter(id=>!observedSet.has(id)).map(id=>({sourceHash:hash(id),
   scanIndices:[...(links?.get(id)||[])]}));
 const extraNativeIds=observed.length-playerIndices.length;
 const explanationFromMerges=multiSourceRows.reduce((total,row)=>
  total+row.nativeUserSourceCount-1,0);
 const safeSourceMerge=extraNativeIds>0&&
  multiSourceRows.length>0&&explanationFromMerges===extraNativeIds&&
  !unmapped.length&&!rowsWithoutProvenUserMarker.length&&
  !multipleRows.length&&!notObserved.length&&
  multiSourceRows.every(row=>row.contentProof.ok)&&
  mapped.length===observed.length;
 return {
  originalUserMarkers:observed.length,renderedPlayerRows:playerIndices.length,
  countDifference:extraNativeIds,
  safeSourceMerge,
  explainedExtraNativeIds:explanationFromMerges,
  mappedNativeUserMarkers:mapped.length,unmappedNativeUserMarkers:unmapped.length,
  unmappedNativeUserDetails:unmapped.slice(0,30),
  rowsWithMultipleNativeUserSources:multiSourceRows.length,
  multipleNativeSourceDetails:multiSourceRows.slice(0,30),
  rowsWithoutProvenUserMarker:rowsWithoutProvenUserMarker.length,
  rowsWithoutProvenUserMarkerIndices:rowsWithoutProvenUserMarker.slice(0,30),
  sourceInMultiplePlayerRows:multipleRows.slice(0,30),
  linkedButNotObserved:notObserved.slice(0,30),
  diagnosis:'Count difference alone cannot establish missing messages. Distinguish multiple native user IDs in one rendered gap from user markers outside those gaps. Never invent missing text.'
 };
}

function verifyAutoContinueAudit(collected,candidates,history,senders,playerLinks=null,userNearby=null){
 const sourceRows=new Map();
 const identities=new Map();
 for(const [scanIndex,row] of collected.entries()){
  const native=row.formatSource?.nativeReply;
  const id=native?.messageId;
  if(!id)continue;
  if(!sourceRows.has(id))sourceRows.set(id,[]);
  sourceRows.get(id).push({scanIndex,role:row.role,eventType:row.eventType||null});
  if(native.eventEvidence?.sender)identities.set(id,native.eventEvidence.sender);
 }
 const problems=[];
 const gaps=candidates.map(candidate=>{
  const index=candidate.scanIndex;
  const prev=collected[index-1],curr=collected[index];
  const pId=prev?.formatSource?.nativeReply?.messageId;
  const cId=curr?.formatSource?.nativeReply?.messageId;
  const evidence=curr?.formatSource?.playerGap;
  const errors=[];
  const forbid=(check,label)=>{if(check)errors.push(label)};
  forbid(!Number.isInteger(index)||index<2||index>=collected.length,'index-invalid');
  forbid(prev?.role!=='ai'||curr?.role!=='ai'||!!prev?.eventType||!!curr?.eventType,'not-adjacent-ordinary-ai');
  forbid(curr?.autoContinue!==true,'not-explicitly-proven-in-scan');
  forbid(!pId||!cId||pId===cId,'missing-or-duplicate-pair-ids');
  forbid(candidate.previousId!==pId||candidate.currentId!==cId,'candidate-pair-id-mismatch');
  forbid(!pId||sourceRows.get(pId)?.length!==1,'previous-native-source-not-unique');
  forbid(!cId||sourceRows.get(cId)?.length!==1,'current-native-source-not-unique');
  forbid(!evidence||evidence.previousId!==pId||evidence.currentId!==cId,'local-gap-source-id-mismatch');
  forbid(evidence?.previous!=='character'||evidence?.current!=='character','local-native-sender-not-character');
  forbid(!Array.isArray(evidence?.markers)||evidence.markers.length!==0,'player-or-other-source-marker-in-gap');
  forbid(evidence?.loading!==false,'gap-still-loading');
  forbid(history.get(pId)!=='ordinary-message'||history.get(cId)!=='ordinary-message','history-source-kind-not-ordinary');
  const pSender=senders.get(pId)||identities.get(pId);
  const cSender=senders.get(cId)||identities.get(cId);
  forbid(pSender!=='character'||cSender!=='character','history-sender-not-character');
  if(errors.length)problems.push({scanIndex:index,errors});
  return {scanIndex:index,ok:errors.length===0,errors,
   previousSourceHash:pId?hash(pId):null,currentSourceHash:cId?hash(cId):null,
   bothOrdinary:history.get(pId)==='ordinary-message'&&history.get(cId)==='ordinary-message',
   noGapMarkers:Array.isArray(evidence?.markers)&&evidence.markers.length===0,
   notLoading:evidence?.loading===false};
 });
 const unknown=[...history].filter(([,kind])=>kind==='unknown-message'||kind==='unreadable')
  .map(([id,kind])=>({sourceHash:hash(id),kind}));
 if(unknown.length)problems.push({scope:'history',errors:['unreadable-or-unknown-native-message-markers']});
 const missingObserved=[...history].filter(([id])=>{
  const sender=senders.get(id)||identities.get(id);
  return ['character','assistant','deg_event'].includes(sender)&&sourceRows.get(id)?.length!==1;
 }).map(([id,kind])=>({sourceHash:hash(id),kind,sender:senders.get(id)||identities.get(id),
  collectedMatches:sourceRows.get(id)?.length||0}));
 if(missingObserved.length)problems.push({scope:'history',errors:['observed-ai-or-event-source-not-uniquely-collected']});
 const playerSourceAudit=analyzePlayerSourceDifference(collected,history,senders,playerLinks,userNearby);
 const playerMarkers=playerSourceAudit.originalUserMarkers;
 const playerRows=playerSourceAudit.renderedPlayerRows;
 if(playerMarkers>playerRows&&!playerSourceAudit.safeSourceMerge)
  problems.push({scope:'history',
  errors:['more-observed-user-messages-than-player-rows'],
  extraNativeUserMarkers:playerMarkers-playerRows,
  candidateMultipleSourceRowIndices:playerSourceAudit.multipleNativeSourceDetails.map(x=>x.scanIndex),
  unmatchedNativeUserSourceHashes:playerSourceAudit.unmappedNativeUserDetails.map(x=>x.sourceHash)});
 if(playerSourceAudit.sourceInMultiplePlayerRows.length)
  problems.push({scope:'player-provenance',errors:['same-user-source-mapped-to-multiple-player-rows']});
 if(playerSourceAudit.linkedButNotObserved.length)
  problems.push({scope:'player-provenance',errors:['player-source-in-gap-not-seen-in-native-history']});
 return {ok:problems.length===0,candidateIndices:candidates.map(x=>x.scanIndex),
  gaps,problems,observedNativeMarkers:history.size,scannedRows:collected.length,
  markerCountDifference:history.size-collected.length,
  unaccountedAIOrEvents:missingObserved,
  unknownMarkers:unknown,
  observedUserMessages:playerMarkers,playerRows,playerSourceAudit,
  explanation:'A global marker/row cardinality mismatch is not itself a missed player. Each continuation must pass native ID, sender, local between-message markers and loading checks; independently observed missing character/event IDs still fail.'};
}

function summarizeEventAudit(audit,collected,validation,complete){
 const eventPositions=new Set(validation.events.map(event=>event.scanIndex));
 const nativePositions=new Map();
 collected.forEach((row,index)=>{
  const id=row.formatSource?.nativeReply?.messageId;
  if(id)nativePositions.set(id,nativePositions.has(id)?null:index);
 });
 const candidates=[...audit.native].map(([id,item])=>{
  const scanIndex=nativePositions.get(id)??null;
  const classified=scanIndex!==null&&eventPositions.has(scanIndex);
  const reason=classified?(item.accepted===false?'event-exported-without-acceptance':'classified-event'):
   item.accepted===true?(scanIndex===null?'accepted-event-missing':'accepted-event-in-ordinary-row'):
   item.accepted===false?'not-accepted':'acceptance-unverified';
  return {...item,sourceRef:hash(id),scanIndex,reason};
 });
 const headers=[...audit.headers.values()].map(header=>({...header,
  classified:header.scanIndex!==null&&eventPositions.has(header.scanIndex)}));
 const aiRows=validation.messages.filter(row=>row.role==='ai');
 const verifiedAi=aiRows.filter(row=>collected[row.scanIndex]?.formatSource?.nativeReply?.eventEvidence?.kind==='ordinary-message').length;
 const unresolvedAccepted=candidates.filter(row=>['accepted-event-missing','accepted-event-in-ordinary-row',
  'event-exported-without-acceptance'].includes(row.reason)).length;
 const unresolvedHeaders=headers.filter(row=>!row.classified).length;
 const unreadableHistoryMarkers=[...audit.history.values()].filter(kind=>
  kind==='unknown-message'||kind==='unreadable').length;
 return {complete,scannerVersion:SCANNER_VERSION,headerCandidates:headers.length,headers,
  nativeCandidates:candidates,cards:candidates.filter(row=>row.seenAsCard).length,
  unverifiedCards:[...audit.unverifiedCards.values()],exportedEvents:validation.events.length,
  ordinaryAiVerified:verifiedAi,ordinaryAiTotal:aiRows.length,unresolvedAccepted,unresolvedHeaders,
  historyMarkersObserved:audit.history.size,unreadableHistoryMarkers,
  zeroEventAssessment:validation.events.length?'not-zero':complete&&verifiedAi===aiRows.length&&
   !unresolvedAccepted&&!unresolvedHeaders&&!audit.unverifiedCards.size&&!unreadableHistoryMarkers&&
   candidates.every(row=>row.accepted===false)
    ?'no-accepted-event-in-observed-history':'unverified'};
}
function isBottom(root){
 const y=root===document.scrollingElement||root===document.documentElement?root.scrollTop:root.scrollTop;
 return y+root.clientHeight>=root.scrollHeight-5;
}
async function advanceScanScroll(root,stepPx,wait=sleep){
 const initialTop=root.scrollTop,attempts=[];
 for(let retry=1;retry<=4;retry++){
  if(!root.isConnected)throw Error('捲動期間 WHIF 更換了訊息容器；已停止避免漏掃');
  const before=root.scrollTop;
  const heightBefore=root.scrollHeight;
  const maxTop=Math.max(0,heightBefore-root.clientHeight);
  const requested=Math.min(maxTop,before+Math.max(12,stepPx));
  if(requested>before+0.25)root.scrollTop=requested;
  await wait(WAIT_MS+STABLE_MS);
  if(!root.isConnected)throw Error('捲動期間 WHIF 更換了訊息容器；已停止避免漏掃');
  const after=root.scrollTop,atBottom=isBottom(root);
  attempts.push({retry,before,requested,after,
   scrollHeightBefore:heightBefore,scrollHeightAfter:root.scrollHeight,
   clientHeight:root.clientHeight,atBottom});
  if(after>initialTop+1)return {moved:true,atBottom:false,geometryShift:false,attempts};
  // A lazy-loaded WHIF message can cancel the requested scroll or change
  // scrollHeight between the scroll command and the next DOM snapshot.
  // Bottom must still pass the existing 15-second stability proof; NEVER infer
  // completion from an immobile scroll alone.
  if(atBottom)return {moved:false,atBottom:true,geometryShift:false,attempts};
  if(after<initialTop-4){
   // WHIF's infinite-history loader can expand the document while applying
   // scroll anchoring. In cycle 3 it grew by 20,075px and adjusted scrollTop
   // backwards by 43px. This is not forward progress: return to the main
   // loop and require a new ordered, source-ID-aware appendSample overlap.
   if(root.scrollHeight>heightBefore+5)
    return {moved:false,atBottom:false,geometryShift:false,reanchor:true,attempts};
   return {moved:false,atBottom:false,geometryShift:true,attempts};
  }
 }
 return {moved:false,atBottom:false,geometryShift:false,attempts};
}
// Recovery is a search for a proven ordered overlap, not a geometric
// assertion. Never append tentative probes to the real collected rows.
function recoveryNativeId(row){
 const n=row?.formatSource?.nativeReply;
 return n?.reason==='available'&&n.markerCount===1&&n.messageId?n.messageId:null;
}
function trustedRecoveryAnchor(root,shot,locate){
 const row=shot.rows.at(-1),id=recoveryNativeId(row);
 return {top:root.scrollTop,height:root.scrollHeight,id,
  relativeTop:id?locate(id):null,windowRows:shot.rows.map(recoveryDiagnosticRow)};
}
function recoveryMarkerTop(root,id){
 const nodes=root.querySelectorAll('[data-selection-copy-message-id="'+CSS.escape(id)+'"]');
 if(nodes.length!==1||!nodes[0].isConnected)return null;
 const y=nodes[0].getBoundingClientRect().top;
 return y-(isDocumentRoot(root)?0:root.getBoundingClientRect().top);
}
function recoveryDiagnosticRow(row){
 const nativeId=recoveryNativeId(row);
 const playerIds=(row.formatSource?.playerSources||[]).filter(x=>x.id&&x.sender==='user'&&x.nativeReason==='available'&&x.nativeSender==='user'&&x.nativeMessageId===x.id).map(x=>x.id);
 return {id:nativeId,playerIds,sourceIds:nativeId?[nativeId]:playerIds,domId:row.domId||row.id||null,role:row.role,eventType:row.eventType||null};
}
function proveRecoveryOverlap(shot,all,detail=null){
 const reject=reason=>{if(detail)detail.reason=reason;return false};
 if(detail){
  detail.trustedTail=all.slice(-Math.max(shot.rows.length,20)).map(recoveryDiagnosticRow);
  detail.candidateRows=shot.rows.map(recoveryDiagnosticRow);
  const ids=detail.candidateRows.flatMap(r=>r.sourceIds);
  detail.candidateMissingIds=detail.candidateRows.filter(r=>!r.sourceIds.length).length;
  detail.candidateDuplicateIds=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
  const known=new Set(all.flatMap(row=>recoveryDiagnosticRow(row).sourceIds));
  detail.sharedNativeIds=ids.filter(id=>known.has(id));
  // Include per-ID mismatch flags even when appendSample cannot find an anchor.
  const stored=new Map();
  for(const row of all)for(const id of recoveryDiagnosticRow(row).sourceIds){
   if(!stored.has(id))stored.set(id,[]);
   stored.get(id).push(row);
  }
  detail.sharedIdChecks=shot.rows.flatMap((row,candidateIndex)=>recoveryDiagnosticRow(row).sourceIds.flatMap(id=>
   (stored.get(id)||[]).map(prior=>({id,candidateIndex,textEqual:prior.text===row.text,
    roleEqual:prior.role===row.role,eventEqual:(prior.eventType||null)===(row.eventType||null),
    storedOccurrences:stored.get(id).length}))));
  detail.trustedMissingIds=detail.trustedTail.filter(r=>!r.sourceIds.length).length;
  const tailIds=detail.trustedTail.flatMap(r=>r.sourceIds);
  detail.trustedDuplicateIds=[...new Set(tailIds.filter((id,i)=>tailIds.indexOf(id)!==i))];
 }
 if(!all.length||!shot.rows.length)return reject('empty-window');
 const copies=all.map(row=>({...row}));
 let proof;
 try{proof=appendSample(shot,copies)}catch(error){if(detail)detail.appendError=String(error?.message||error);return reject(detail?.sharedNativeIds.length?'shared-id-but-append-rejected':'no-proven-ordered-overlap')}
 if(detail)detail.alignment=proof;
 if(!proof.repeated)return reject('no-overlap');
 const tail=all.slice(-proof.repeated),overlap=shot.rows.slice(proof.anchorPosition,proof.anchorPosition+proof.repeated);
 // An ID is evidence only when unique on both sides and the entire
 // overlapping rendered text and classification still agree.
 if(detail)detail.overlapChecks=tail.map((row,i)=>({id:recoveryNativeId(row),candidateId:recoveryNativeId(overlap[i]),textEqual:row.text===overlap[i].text,roleEqual:row.role===overlap[i].role,eventEqual:(row.eventType||null)===(overlap[i].eventType||null),sameRow:sameRow(row,overlap[i])}));
 if(!tail.every((row,i)=>row.text===overlap[i].text&&sameRow(row,overlap[i])))return reject('overlap-content-or-classification-mismatch');
 const id=recoveryNativeId(tail.at(-1));
 if(!id||id!==recoveryNativeId(overlap.at(-1))||
    all.filter(row=>recoveryNativeId(row)===id).length!==1||
    shot.rows.filter(row=>recoveryNativeId(row)===id).length!==1)return reject('anchor-id-missing-or-not-unique');
 const known=new Set(all.map(recoveryNativeId).filter(Boolean));
 const extras=shot.rows.slice(proof.anchorPosition+proof.repeated).map(recoveryNativeId).filter(Boolean);
 const ok=extras.every(id=>!known.has(id))&&new Set(extras).size===extras.length;
 if(detail){detail.extraNativeIds=extras;detail.reason=ok?'proven':'extra-id-duplicate-or-already-collected'}
 return ok;
}
async function recoverScanOverlap(root,trusted,all,sample,locate,wait=sleep,guard=()=>{}){
 const attempts=[],seen=new Set();
 if(!trusted)return {ok:false,attempts};
 // First try the current observed location, then a live marker offset,
 // then height-delta estimates and the old coordinate. Recalculate geometry
 // after each asynchronous layout update. At most six probes, no guessing.
 for(let i=0;i<6;i++){
  guard();
  if(!root.isConnected)throw Error('捲動復原期間 WHIF 更換了訊息容器；已停止避免漏掃');
  const live=trusted.id?locate(trusted.id):null;
  const current=root.scrollTop,delta=root.scrollHeight-trusted.height;
  const positions=[current,
   Number.isFinite(live)&&Number.isFinite(trusted.relativeTop)?current+live-trusted.relativeTop:null,
   trusted.top+delta,trusted.top,trusted.top+delta-root.clientHeight/4,trusted.top+delta+root.clientHeight/4];
  const max=Math.max(0,root.scrollHeight-root.clientHeight);
  const candidate=positions.filter(Number.isFinite).map(y=>Math.max(0,Math.min(max,y)))
   .find(y=>!seen.has(Math.round(y)));
  if(candidate===undefined)break;
  seen.add(Math.round(candidate));
  const beforeHeight=root.scrollHeight;
  root.scrollTop=candidate;
  await wait(WAIT_MS+STABLE_MS);guard();
  if(!root.isConnected)throw Error('捲動復原期間 WHIF 更換了訊息容器；已停止避免漏掃');
  const shot=sample();
  const detail={trustedWindow:trusted.windowRows||[],trustedAnchorId:trusted.id||null};
  const proven=proveRecoveryOverlap(shot,all,detail);
  attempts.push({requested:candidate,actual:root.scrollTop,heightBefore:beforeHeight,
   heightAfter:root.scrollHeight,proven,detail});
  if(proven)return {ok:true,shot,attempts};
  seen.add(Math.round(root.scrollTop));
 }
 return {ok:false,attempts};
}


// Independent local diagnostic. Never appends to trusted scan rows or
// modifies the normal scanner's recovery algorithm.
function anchorProbeOffsets(y,height,max){
 const h=Math.max(1,height),limit=Math.max(0,max);
 const values=[y,...[.5,1,2,4,8].flatMap(n=>[y-h*n,y+h*n])];
 const seen=new Set();
 return values.map(x=>Math.max(0,Math.min(limit,x))).filter(x=>{
  const key=Math.round(x);if(seen.has(key))return false;seen.add(key);return true;
 });
}
// This probe does not decide whether an invisible user message is a
// continuation. It preserves the missing evidence without scrolling or
// changing the chat. A wrapper without a selection marker is valid evidence.
function playerAnchorSample(root,id,neighbors){
 const wraps=[...root.querySelectorAll('[data-message-id]')];
 const matches=wraps.filter(n=>n.getAttribute('data-message-id')===id);
 if(matches.length!==1)throw Error('player-wrapper-not-unique-or-mounted');
 const wrapper=matches[0],index=wraps.indexOf(wrapper);
 const prev=wraps[index-1],next=wraps[index+1];
 if(!prev||!next||prev.getAttribute('data-message-id')!==neighbors[0]||next.getAttribute('data-message-id')!==neighbors[1])throw Error('neighbor-order-not-proven');
 const owned=[...wrapper.querySelectorAll(nativeMessageSelector)];
 if(owned.length>1||owned.some(n=>n.getAttribute('data-selection-copy-message-id')!==id))throw Error('foreign-or-duplicate-player-marker');
 const native=readNativeNode(owned[0]||wrapper,true,false,true);
 const proof=native.eventEvidence;
 if(native.reason!=='player-anchor-evidence'||proof?.messageId!==id||proof.sender!=='user'||proof.kind!=='ordinary-message')throw Error('native-player-source-unavailable');
 const adjacent=[prev,next].map(n=>{
  const sourceId=n.getAttribute('data-message-id');
  const markers=[...n.querySelectorAll(nativeMessageSelector)].filter(m=>m.getAttribute('data-selection-copy-message-id')===sourceId);
  const r=readNativeNode(markers.length===1?markers[0]:n,true,true);
  if(r.reason!=='evidence'||r.eventEvidence?.messageId!==sourceId||r.eventEvidence.kind!=='ordinary-message'||!['character','assistant'].includes(r.eventEvidence.sender))throw Error('adjacent-ai-source-not-proven');
  return {id:sourceId,source:r.eventEvidence,nativeHash:r.nativeHash,nativeLength:r.nativeLength};
 });
 const capture=n=>({outerHTML:n.outerHTML,textContent:n.textContent,innerText:typeof n.innerText==='string'?n.innerText:null,geometry:anchorProbeElement(n)});
 const wrapperDom=capture(wrapper),markerDom=owned.length?capture(owned[0]):null;
 if(wrapperDom.outerHTML.length>200000||markerDom?.outerHTML.length>200000)throw Error('player-dom-exceeds-bound');
 const hasMedia=!!wrapper.querySelector('img,video,audio,[data-attachment-id]');
 const loading=!!wrapper.querySelector('[aria-busy="true"],[role="progressbar"],[data-loading="true"]')||wrapper.matches('[aria-busy="true"],[data-loading="true"]');
 return {sourceId:id,native:{...native,nativeHash:hash(native.text),nativeNormHash:hash(native.text.replace(/\s/gu,'')),nativeLength:native.text.length},adjacent,wrapperDom,markerDom,hasMedia,loading,scrollTop:root.scrollTop,scrollHeight:root.scrollHeight,order:[neighbors[0],id,neighbors[1]]};
}
async function playerAnchorProbe(){
 if(busy)return status('掃描進行中，禁止同時取證');
 if(!target?.cycleId||core?.version!==SCANNER_VERSION||!formatEvidenceReady())return status('請確認輪迴綁定與新版模組');
 const id=$('gal-anchor-id').value.trim(),neighbors=$('gal-anchor-neighbors').value.trim().split(/\s+/u).filter(Boolean);
 if(neighbors.length!==2||new Set([id,...neighbors]).size!==3||[id,...neighbors].some(v=>!/^[A-Za-z0-9_-]{5,100}$/.test(v)))return status('填入玩家原生 ID，及前後 AI ID（依順序，一行一個）');
 const origin=location.origin+location.pathname,profile={...target};
 const run={scanRunId:crypto.randomUUID(),cycleId:profile.cycleId,scope:'missing',worldName:profile.worldName,cycleTitle:profile.cycleTitle,scannerVersion:SCANNER_VERSION};
 busy=true;cancelled=false;paused=false;let registered=false,reason=null,first=null,second=null;
 try{
  await fetchCurrentBinding(profile);
  const root=scroller();
  const reg=await chrome.runtime.sendMessage({type:'gal-run-start',pageSource:origin.replace(/\/$/,''),...run});
  if(!reg?.ok)throw Error(reg?.error||'取證批次未登記');
  Object.assign(run,{worldName:reg.status?.worldName||run.worldName,worldKey:reg.status?.worldKey||null,cycleNumber:reg.status?.cycleNumber??null,archiveKey:reg.status?.archiveKey||null,batchFolder:reg.status?.batchFolder});registered=true;
  first=playerAnchorSample(root,id,neighbors);
  await sleep(STABLE_MS);
  if(cancelled||paused||!root.isConnected||location.origin+location.pathname!==origin)throw Error('取證畫面變更');
  second=playerAnchorSample(root,id,neighbors);
  const stableKey=s=>JSON.stringify([s.sourceId,s.native,s.adjacent,s.wrapperDom.outerHTML,s.markerDom?.outerHTML,s.hasMedia,s.loading,s.scrollTop,s.scrollHeight,s.order]);
  if(stableKey(first)!==stableKey(second)||first.loading||second.loading)throw Error('來源或畫面未穩定');
 }catch(e){reason=String(e?.message||e)}
 finally{
  try{
   if(!registered){status('玩家取證未啟動：'+reason);return}
   const result={format:'gal-ai-hidden-player-source-proof',version:1,forensicOnly:true,importable:false,validated:false,complete:!reason,scope:'visible-player-anchor',scanRunId:run.scanRunId,scannerVersion:SCANNER_VERSION,coreVersion:core.version,source:{url:origin},target:{cycleId:run.cycleId,cycleTitle:run.cycleTitle,worldName:run.worldName,worldKey:run.worldKey,cycleNumber:run.cycleNumber,archiveKey:run.archiveKey},capturedAt:new Date().toISOString(),input:{anchorId:id,neighbors},stable:!reason,reason,first,second,note:'僅保存玩家來源及鄰接證據，不判定自動繼續，不修改對話，不匯入正史。'};
   const audit={...run,format:'gal-ai-hidden-player-source-diagnostic',importable:false,anchorId:id,neighbors,stable:!reason,reason,nativeLength:second?.native.nativeLength??first?.native.nativeLength??null,hasMedia:second?.hasMedia??first?.hasMedia??null};
   const saved=await galSendEvidence({type:'gal-run-finish',...run,state:reason?'failed':'completed',scanned:0,result:JSON.stringify(result),diagnostic:JSON.stringify(audit),reason:reason||null});
   if(!saved?.ok)throw Error(saved?.error||'下載未確認');
   status((reason?'玩家取證未完成：'+reason:'玩家來源兩次取證一致，已保存 JSON')+'\n'+run.batchFolder+'\n只供鑑識，不代表自動繼續驗收通過。');
  }catch(e){status('玩家取證保存失敗：'+String(e?.message||e))}
  finally{busy=false}
 }
}
function anchorProbeState(rawCount,rows,anchorId){
 const hits=rows.filter(r=>r.sourceIds.includes(anchorId)).length;
 return rawCount===0?'anchor-not-mounted':rawCount!==1?'anchor-marker-not-unique':
  hits===0?'mounted-but-not-collected':hits===1?'anchor-collected':'anchor-row-not-unique';
}

// History localization is separate from overlap proof. The clock is only
// a navigation hint; a missing ID is never inferred from a timestamp.
function anchorHintTime(value){
 const m=String(value||'').trim().match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/u);
 if(!m)return null;
 const [y,mo,d,h,mi]=m.slice(1).map(Number);
 const utc=new Date(0);utc.setUTCFullYear(y,mo-1,d);utc.setUTCHours(h,mi,0,0);
 if(utc.getUTCFullYear()!==y||utc.getUTCMonth()!==mo-1||utc.getUTCDate()!==d||
    utc.getUTCHours()!==h||utc.getUTCMinutes()!==mi)return null;
 return utc.getTime()-8*3600000;
}
function anchorHistoryDecision(sample,anchorId,neighbors,targetMs){
 const ids=sample.rawIds||[],matches=neighbors.filter(id=>ids.includes(id));
 if(ids.includes(anchorId))return {kind:'anchor-id-observed',matches};
 if(matches.length)return {kind:'reference-id-observed',matches};
 const times=(sample.clocks||[]).map(x=>Date.parse(x.iso)).filter(Number.isFinite);
 const min=times.length?Math.min(...times):null,max=times.length?Math.max(...times):null;
 const near=targetMs!==null&&min!==null&&min<=targetMs+15*60000&&max>=targetMs-15*60000;
 // When actual neighbor IDs are available, do not stop on a clock hint alone.
 if(near&&!neighbors.length)return {kind:'clock-hint-only',matches,min,max};
 return {kind:'target-interval-unconfirmed',matches,min,max,near};
}
function anchorHistoryStep(sample,direction){
 const max=Math.max(0,sample.height-sample.clientHeight);
 const step=Math.max(12,Math.floor(sample.clientHeight*.70));
 return Math.max(0,Math.min(max,sample.top+direction*step));
}
function anchorHistorySignature(s){
 return JSON.stringify([Math.round(s.top),s.height,s.clientHeight,s.rawIds]);
}
// Fast navigation only: old bottom distance survives most prepended history.
function anchorFastPlan(sample,decision,targetMs,oldY,oldHeight,previous,visited){
 const max=Math.max(0,sample.height-sample.clientHeight),h=Math.max(1,sample.clientHeight);
 const clamp=x=>Math.max(0,Math.min(max,x));
 const key=x=>sample.height+':'+sample.clientHeight+':'+Math.round(clamp(x));
 const fresh=x=>!visited.has(key(x))&&Math.abs(clamp(x)-sample.top)>2;
 const at=(x,mode)=>({top:clamp(x),mode});
 const distance=oldHeight===null?null:Math.max(0,oldHeight-oldY);
 const estimated=distance===null?null:sample.height-distance;
 // If the desired bottom-relative position is not loaded, request older
 // history immediately at the top, not by scrolling every intervening row.
 if(distance!==null&&estimated<0&&!(decision.max!==null&&targetMs!==null&&decision.max<targetMs)){
  return at(0,'preload-history');
 }
 if(estimated!==null&&estimated>=0&&(!previous||previous.height!==sample.height||previous.clientHeight!==sample.clientHeight)&&fresh(estimated))
  return at(estimated,'bottom-relative-jump');
 const earlier=targetMs!==null&&decision.min!==null&&decision.min>targetMs+15*60000;
 const later=targetMs!==null&&decision.max!==null&&decision.max<targetMs-15*60000;
 const direction=earlier?-1:later?1:(previous?.direction||-1);
 const far=earlier?decision.min-targetMs:later?targetMs-decision.max:0;
 // Crossing the time hint means slow down and examine the bracket, not
 // assume monotonic game time or claim source continuity.
 const crossed=previous&&previous.height===sample.height&&previous.clientHeight===sample.clientHeight&&previous.direction!==direction;
 const factors=crossed?[.7,1.4,3]:far>120*60000?[8,4,2,.7]:far>30*60000?[3,1.4,.7]:[.7,1.4,3];
 if(crossed){
  const mid=(sample.top+previous.top)/2;
  if(Math.abs(sample.top-previous.top)>h*1.4&&fresh(mid))return {...at(mid,'bracket-refine'),direction};
 }
 for(const sign of [direction,-direction])for(const factor of factors){
  const dest=sample.top+sign*h*factor;
  if(fresh(dest))return {...at(dest,far>30*60000&&!crossed?'coarse-jump':'nearby-search'),direction:sign};
 }
 // Revisit the top on a stale layout to give lazy loading a chance.
 if(earlier&&sample.top<=2)return {...at(0,'preload-history'),direction:-1};
 return {...at(sample.top,'retry-layout'),direction};
}
async function anchorFastSample(root,requested,guard,edgeWait){
 const beforeHeight=root.scrollHeight;
 root.scrollTop=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,requested));
 let first=null,last=null,stable=false,elapsed=0;
 const limit=edgeWait?2400:900;
 // Poll IDs and geometry; no copying/formatting of intervening messages.
 while(elapsed<limit){
  await sleep(100);elapsed+=100;guard();
  last=anchorHistorySample(root);
  stable=!!first&&anchorHistorySignature(first)===anchorHistorySignature(last)&&last.rawIds.length>0;
  if(stable&&(!edgeWait||last.height!==beforeHeight||elapsed>=limit))break;
  first=last;
 }
 return {sample:last,stable,elapsed,beforeHeight};
}
function anchorHistorySample(root){
 const nodes=[...root.querySelectorAll(nativeMessageSelector)],rawIds=[],clocks=[];
 for(const n of nodes){
  const id=n.getAttribute('data-selection-copy-message-id');
  if(!id)continue;rawIds.push(id);
  const native=readNativeNode(n);
  const clock=native.reason==='available'?core.parseGameTime(native.text):null;
  if(clock)clocks.push({id,iso:clock.iso});
 }
 return {top:root.scrollTop,height:root.scrollHeight,clientHeight:root.clientHeight,rawIds,clocks};
}
function anchorProbeReach(attempts,localization,anchorId,neighbors){
 const snapshots=attempts.filter(a=>a.stable).flatMap(a=>[a.before,a.after]);
 const hits=snapshots.filter(s=>s.rawIds.includes(anchorId));
 const nearIds=[...new Set(snapshots.flatMap(s=>s.rawIds.filter(id=>neighbors.includes(id))))];
 if(hits.length)return {state:'anchor-observed-in-stable-probe',nearIds};
 if(nearIds.length)return {state:'reference-ids-observed-anchor-unseen',nearIds};
 if(localization?.decision?.kind==='anchor-id-observed'||localization?.decision?.kind==='reference-id-observed')
  return {state:'located-but-not-reproduced-in-stable-probe',nearIds};
 if(localization?.decision?.kind==='clock-hint-only'||localization?.clockHintObserved)
  return {state:'clock-hint-only-anchor-unconfirmed',nearIds};
 return {state:'target-interval-not-confirmed',nearIds};
}

function anchorProbeElement(node){
 const r=node.getBoundingClientRect(),style=getComputedStyle(node);
 const wrapper=node.closest('[data-message-id]');
 const item=node.closest('[data-item-index],[data-index]');
 return {tag:node.tagName,ownerId:wrapper?.getAttribute('data-message-id')||null,
  itemIndex:item?.getAttribute('data-item-index')||item?.getAttribute('data-index')||null,
  className:String(node.getAttribute('class')||'').slice(0,500),
  top:r.top,bottom:r.bottom,width:r.width,height:r.height,
  display:style.display,visibility:style.visibility,opacity:style.opacity,
  textLength:(node.textContent||'').length};
}
function anchorProbeSnapshot(root,anchorId){
 const raw=[...root.querySelectorAll(nativeMessageSelector)];
 const selected=raw.filter(n=>n.getAttribute('data-selection-copy-message-id')===anchorId);
 const headings=boundaryHeaders(root),tools=boundaryToolbars(root),trace=[];
 const rowView=boundaryRead(root,false,true,trace);
 const rows=rowView.rows.map(row=>({...recoveryDiagnosticRow(row),textLength:row.text.length,
  textHash:hash(row.text),nativeReason:row.formatSource?.nativeReply?.reason||null,
  clock:core.parseGameTime(row.text)?.iso||null}));
 const elementInfo=n=>{
  const id=n.getAttribute('data-selection-copy-message-id');
  const parent=n.closest('[data-message-id]')||n.closest('[data-item-index],[data-index]')||n.parentElement;
  const proof=readNativeNode(n,true);
  const ancestor=parent||n;
  const headingLike=[...ancestor.querySelectorAll('span,strong,b,p,h1,h2,h3,h4,label,div')].filter(x=>{
   if(x===n||n.contains(x)||x.contains(n))return false;
   const q=boundaryDirectText(x);
   return q&&q.length<=140&&boundaryFollows(x,n);
  }).slice(0,20).map(x=>({text:boundaryDirectText(x),...anchorProbeElement(x)}));
  return {id,...anchorProbeElement(n),nativeEvidence:proof.eventEvidence||null,
   nativeEvidenceReason:proof.reason||null,wrapper:anchorProbeElement(ancestor),
   recognizedHeaders:headings.filter(h=>ancestor.contains(h.node)).map(h=>({kind:h.kind,...anchorProbeElement(h.node)})),
   recognizedToolbars:tools.filter(t=>ancestor.contains(t)).map(anchorProbeElement),
   headingCandidates:headingLike,
   actionIcons:[...ancestor.querySelectorAll('svg')].slice(0,40).map(x=>({icon:boundaryIconTag(x).slice(0,250),...anchorProbeElement(x)}))};
 };
 // Keep raw ID order even when no matching heading or toolbar exists.
 const rawIds=raw.map(n=>n.getAttribute('data-selection-copy-message-id'));
 const center=raw.findIndex(n=>n.getAttribute('data-selection-copy-message-id')===anchorId);
 const local=center>=0?raw.slice(Math.max(0,center-3),center+4):raw.slice(0,7);
 return {scrollTop:root.scrollTop,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight,
  rawMarkerCount:raw.length,rawIds,anchorMarkerCount:selected.length,
  anchorRelativeTop:recoveryMarkerTop(root,anchorId),
  state:anchorProbeState(selected.length,rows,anchorId),rows,
  boundaryDebug:rowView.debug,boundaryTrace:trace,
  headers:headings.map(h=>({kind:h.kind,...anchorProbeElement(h.node)})),toolbars:tools.map(anchorProbeElement),
  localMarkers:local.map(elementInfo)};
}
// Forensic-only: capture the actual mounted target after a stable pair.
// Never substitute checkpoint text, or inspect an adjacent message as the target.
function anchorClosingTails(text){
 const out=[];let open=false;
 for(const [index,line] of String(text||'').split(/\r?\n/).entries()){
  const m=line.match(/^[ \t]*\x60{3}(.*)$/u);
  if(!m)continue;
  if(open&&m[1].trim())out.push({line:index+1,text:m[1]});
  open=!open;
 }
 return out;
}
function anchorDetailedEvidence(root,anchorId,expected,run){
 const result={format:'gal-ai-live-anchor-detail',version:1,forensicOnly:true,importable:false,
  scanRunId:run.scanRunId,scannerVersion:SCANNER_VERSION,coreVersion:core.version,
  worldName:run.worldName,worldKey:run.worldKey,cycleId:run.cycleId,cycleNumber:run.cycleNumber,
  sourceId:anchorId,capturedAt:new Date().toISOString(),complete:false,missing:[]};
 const fail=why=>{result.missing.push(why);return result};
 try{
  const markers=[...root.querySelectorAll(nativeMessageSelector)].filter(n=>n.getAttribute('data-selection-copy-message-id')===anchorId);
  if(markers.length!==1)return fail('target-marker-not-unique');
  const node=markers[0],wrapper=node.closest('[data-message-id]');
  if(wrapper&&wrapper.getAttribute('data-message-id')!==anchorId)return fail('wrapper-id-mismatch');
  const body=wrapper||node;
  if([...body.querySelectorAll(nativeMessageSelector)].some(n=>n.getAttribute('data-selection-copy-message-id')!==anchorId))return fail('foreign-message-in-wrapper');
  const native=readNativeNode(node);
  result.native={reason:native.reason,source:native.eventEvidence||null,text:typeof native.text==='string'?native.text:null};
  const proof=native.eventEvidence;
  if(native.reason!=='available'||proof?.messageId!==anchorId||proof.kind!=='event-message'||proof.sender!=='deg_event'||proof.accepted!==true)return fail('unique-accepted-native-event-not-proven');
  const view=boundaryRead(root,false,true,[]);
  const rows=view.rows.filter(r=>r.formatSource?.nativeReply?.messageId===anchorId);
  if(rows.length!==1||rows[0].eventType!=='event')return fail('target-event-row-not-unique');
  const row=rows[0],source=row.formatSource.nativeReply;
  if(source.reason!=='available'||source.text!==native.text||source.eventEvidence?.messageId!==anchorId||source.markerCount!==1)return fail('live-native-row-mismatch');
  result.serialized={text:row.text,length:row.text.length,hash:hash(row.text),codeBlocks:row.formatSource.codeBlocks||[]};
  if(result.serialized.hash!==expected.textHash||result.serialized.length!==expected.textLength)return fail('live-serialization-changed');
  const {start,end}=row.probeBoundary||{};
  if(!start||!end||!boundaryFollows(start,end))return fail('live-boundary-unavailable');
  const range=document.createRange();range.setStartAfter(start);range.setEndBefore(end);
  if(!range.intersectsNode(node))return fail('marker-outside-event-boundary');
  const holder=document.createElement('div');holder.append(range.cloneContents());
  const styles=n=>{const s=getComputedStyle(n);return {...anchorProbeElement(n),contentVisibility:s.contentVisibility||null,overflow:s.overflow,clipPath:s.clipPath,whiteSpace:s.whiteSpace}};
  const snapshot=n=>n?{outerHTML:n.outerHTML??null,textContent:n.textContent??null,innerText:typeof n.innerText==='string'?n.innerText:null,style:n.nodeType===1?styles(n):null}:null;
  const sibling=n=>n?.nodeType===1?snapshot(n):n?{nodeType:n.nodeType,textContent:n.textContent}:null;
  result.dom={marker:snapshot(node),wrapper:wrapper?snapshot(wrapper):null,
   boundary:{start:snapshot(start),end:snapshot(end),html:holder.innerHTML,textContent:holder.textContent,rangeText:range.toString()},
   blocks:[...body.querySelectorAll('pre,code,span.message-bubble-text.TemplatedText.font-mono')].filter(n=>range.intersectsNode(n)).map(n=>({node:snapshot(n),previous:sibling(n.previousSibling),next:sibling(n.nextSibling),parent:snapshot(n.parentElement)}))};
  result.tails=anchorClosingTails(native.text).map(t=>{
   const matches=[],walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);
   for(let n=walker.nextNode();n;n=walker.nextNode()){
    if(!range.intersectsNode(n))continue;
    const value=n.nodeValue||'',needle=t.text.trim();let at=value.indexOf(needle);
    while(needle&&at>=0){
     const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+needle.length);
     const ancestors=[];for(let e=n.parentElement;e&&body.contains(e);e=e.parentElement)ancestors.push(styles(e));
     matches.push({text:value,offset:at,parent:snapshot(n.parentElement),ancestors,
      rects:[...r.getClientRects()].map(q=>({x:q.x,y:q.y,width:q.width,height:q.height}))});
     at=value.indexOf(needle,at+needle.length);
    }
   }
   const needle=t.text.trim(),contains=v=>typeof v==='string'&&v.includes(needle);
   return {...t,native:true,markerText:contains(node.textContent),markerInnerText:contains(node.innerText),
    wrapperText:contains(wrapper?.textContent),wrapperInnerText:contains(wrapper?.innerText),
    boundaryText:contains(holder.textContent),serialized:contains(row.text),matches};
  });
  const live=[...root.querySelectorAll(nativeMessageSelector)].filter(n=>n.getAttribute('data-selection-copy-message-id')===anchorId);
  if(live.length!==1||live[0]!==node||!node.isConnected)return fail('target-unmounted-during-capture');
  if(typeof node.innerText!=='string'||!result.dom.marker.outerHTML||!result.dom.boundary.html)return fail('required-live-dom-fields-unavailable');
  result.complete=true;return result;
 }catch(error){return fail('capture-error: '+String(error?.message||error))}
}

// Source-only walk: no snapshot(), boundaryRead(), markdownFromDom(), or clock parsing.
function historySourceAppend(all,ids){
 if(!ids.length||new Set(ids).size!==ids.length)throw Error('empty-or-duplicate-window');
 if(!all.length){all.push(...ids);return}
 const start=all.indexOf(ids[0]);if(start<0)throw Error('no-ordered-overlap');
 const overlap=Math.min(all.length-start,ids.length);
 if(ids.slice(0,overlap).some((id,i)=>id!==all[start+i]))throw Error('source-order-changed');
 const tail=ids.slice(overlap);
 if(tail.length&&start+overlap!==all.length)throw Error('nonterminal-overlap');
 if(tail.some(id=>all.includes(id)))throw Error('duplicate-source-outside-overlap');
 all.push(...tail);
}
function historySourceSample(root){
 const entries=[],seen=new Set(),cards=[];
 const wrappers=[...root.querySelectorAll('[data-message-id]')].filter(n=>n.getClientRects().length);
 const markers=[...root.querySelectorAll(nativeMessageSelector)].filter(n=>n.getClientRects().length);
 for(const wrapper of wrappers){
  const id=wrapper.getAttribute('data-message-id'),owned=markers.filter(n=>n.closest('[data-message-id]')===wrapper);
  if(!id||seen.has(id)||owned.length!==1||owned[0].getAttribute('data-selection-copy-message-id')!==id)throw Error('ambiguous-live-wrapper');
  seen.add(id);const marker=owned[0],native=readNativeNode(marker,true,true),e=native.eventEvidence;
  if(native.reason!=='evidence'||e?.messageId!==id||!['ordinary-message','event-message'].includes(e.kind)||!['chapter','character','assistant','user','deg_event'].includes(e.sender)||!native.nativeHash||!native.nativeNormHash||!Number.isInteger(native.nativeLength))throw Error('unreadable-live-source:'+id);
  if(e.kind==='event-message'?(e.sender!=='deg_event'||e.accepted!==true):e.sender==='deg_event')throw Error('unverified-event-identity:'+id);
  const item=wrapper.closest('[data-item-index],[data-index]'),value=item?.getAttribute('data-item-index')??item?.getAttribute('data-index'),index=value!=null&&/^-?\d+$/.test(value)?Number(value):null;
  const row={id,index,kind:e.kind,sender:e.sender,accepted:e.accepted,nativeHash:native.nativeHash,nativeNormHash:native.nativeNormHash,nativeLength:native.nativeLength};
  if(e.sender==='user'){
   const spans=[...marker.querySelectorAll('span.message-bubble-text.TemplatedText')].filter(n=>!n.parentElement?.closest('span.message-bubble-text.TemplatedText'));
   const body=spans.map(n=>n.textContent||'').join('');
   const labels=[...wrapper.querySelectorAll('span')].filter(n=>!marker.contains(n)&&!n.children.length&&(n.textContent||'').trim()&&(n.textContent||'').trim().length<=40);
   row.player={ownerId:id,bodyParts:spans.length,bodyNormHash:hash(body.replace(/\s/gu,'')),markerNormHash:hash((marker.textContent||'').replace(/\s/gu,'')),hasMedia:!!marker.querySelector('img,video,audio,[data-attachment-id]'),outsideLabelHashes:[...new Set(labels.map(n=>hash((n.textContent||'').trim())))].sort()};
  }
  entries.push(row);
 }
 if(markers.length!==entries.length||markers.some(n=>!seen.has(n.getAttribute('data-selection-copy-message-id'))))throw Error('unmapped-live-markers');
 for(const group of root.querySelectorAll('.flex.h-9.w-full.items-center.gap-3')){
  if(!group.getClientRects().length)continue;
  const buttons=[...group.children].filter(n=>n.matches('button,[role="button"]'));
  if(buttons.length<2)continue;
  const e=readNativeNode(buttons[0],true).eventEvidence;
  if(e?.kind!=='event-card'||!e.messageId||e.accepted===true)throw Error('unverified-event-card');
  cards.push({id:e.messageId,kind:e.kind,sender:e.sender,accepted:e.accepted});
 }
 return {top:root.scrollTop,height:root.scrollHeight,clientHeight:root.clientHeight,entries,cards};
}
async function historySourceProbe(){
 if(busy)return status('掃描進行中，禁止同時補證');
 if(!target?.cycleId||core?.version!==SCANNER_VERSION||!formatEvidenceReady())return status('請確認輪迴綁定與新版模組');
 const profile={...target},url=location.origin+location.pathname,run={scanRunId:crypto.randomUUID(),cycleId:profile.cycleId,worldName:profile.worldName,cycleTitle:profile.cycleTitle,scannerVersion:SCANNER_VERSION,scope:'history-source'};
 let root=null,initial=null,registered=false,reason=null,firstProof=null,lastProof=null,restore=null;
 const order=[],records=new Map(),windows=[],cards=new Map();
 busy=true;paused=false;cancelled=false;activeScanRows=null;
 const guard=()=>{if(cancelled||paused)throw Error('使用者中止來源補證');if(!root?.isConnected||location.origin+location.pathname!==url)throw Error('聊天來源或容器變更')};
 const capture=()=>{guard();return historySourceSample(root)};
 const signature=s=>JSON.stringify(s);
 const stable=async()=>{let previous=null;for(let i=0;i<24;i++){const s=capture();if(s.entries.length&&previous&&signature(previous)===signature(s))return s;previous=s;await sleep(250)}throw Error('來源視窗未穩定')};
 const edge=async(side)=>{
  for(let retry=0;retry<8;retry++){
   guard();if(side==='first')root.scrollTop=0;
   const s=await stable(),atEdge=x=>side==='first'?x.top<=2:x.height-x.clientHeight-x.top<=3;
   if(!atEdge(s)){if(side==='first')continue;return null}
   const started=Date.now(),checks=[{at:0,top:s.top,height:s.height,clientHeight:s.clientHeight,ids:s.entries.map(x=>x.id)}];let changed=false;
   while(Date.now()-started<8000){await sleep(750);const v=capture();if(!atEdge(v)||signature(v)!==signature(s)){changed=true;break}checks.push({at:Date.now()-started,top:v.top,height:v.height,clientHeight:v.clientHeight,ids:v.entries.map(x=>x.id)})}
   if(!changed)return {sample:s,proof:{stable:true,waitedMs:Date.now()-started,checks}};
   if(side==='last')return null;
  }throw Error('無法確認歷史最初頁');
 };
 const append=s=>{
  const ids=s.entries.map(x=>x.id);
  for(const r of s.entries)if(records.has(r.id)&&JSON.stringify(records.get(r.id))!==JSON.stringify(r))throw Error('同一原生來源在不同視窗變更:'+r.id);
  historySourceAppend(order,ids);if(order.length>20000)throw Error('來源筆數超過安全上限');
  for(const r of s.entries)records.set(r.id,r);
  for(const c of s.cards){if(cards.has(c.id)&&JSON.stringify(cards.get(c.id))!==JSON.stringify(c))throw Error('事件卡狀態變更');cards.set(c.id,c)}
  windows.push({top:s.top,height:s.height,clientHeight:s.clientHeight,ids,indices:s.entries.map(r=>r.index),stable:true});
 };
 try{
  await fetchCurrentBinding(profile);root=scroller();initial={top:root.scrollTop,height:root.scrollHeight,clientHeight:root.clientHeight};
  const reg=await chrome.runtime.sendMessage({type:'gal-run-start',pageSource:location.origin+location.pathname.replace(/\/$/,''),...run});if(!reg?.ok)throw Error(reg?.error||'補證工作登記失敗');
  Object.assign(run,{worldName:reg.status.worldName,worldKey:reg.status.worldKey,cycleNumber:reg.status.cycleNumber,archiveKey:reg.status.archiveKey,batchFolder:reg.status.batchFolder,statusPath:reg.status.statusPath});registered=true;activeRun=run;
  const first=await edge('first');firstProof=first.proof;append(first.sample);
  let last=first.sample,stalls=0,step=Math.max(12,Math.floor(root.clientHeight*.75));
  for(let n=0;n<12000;n++){
   guard();if(last.height-last.clientHeight-last.top<=3){
    const end=await edge('last');if(end){append(end.sample);lastProof=end.proof;break}
   }
   root.scrollTop=Math.min(root.scrollHeight-root.clientHeight,last.top+step);
   let next=await stable();
   try{append(next)}catch(e){if(String(e.message)!=='no-ordered-overlap'||step<=12)throw e;step=Math.max(12,Math.floor(step/2));root.scrollTop=last.top;const restored=await stable();if(JSON.stringify(restored.entries.map(r=>r.id))!==JSON.stringify(last.entries.map(r=>r.id)))throw Error('未能復原可信來源視窗');continue}
   stalls=next.top<=last.top+0.25&&next.height===last.height?stalls+1:0;
   if(stalls>12)throw Error('歷史來源捲動停滯');
   last=next;step=Math.min(Math.floor(root.clientHeight*.75),Math.max(12,Math.floor(step*1.2)));
   status('📋 僅補取來源：'+order.length+' 個 ID；'+windows.length+' 個穩定視窗\n不解析正文、不匯入');
   if(n%20===0)await chrome.runtime.sendMessage({type:'gal-run-progress',scanRunId:run.scanRunId,cycleId:run.cycleId,scanned:order.length});
  }
  if(!lastProof)throw Error('未確認歷史頁尾');
  await fetchCurrentBinding(profile);
  if(!['chapter','character','assistant'].includes(records.get(order[0])?.sender)||order.some((id,i)=>!Number.isInteger(records.get(id).index)||(i>0&&records.get(id).index!==records.get(order[i-1]).index+1)))throw Error('開場或虛擬列表連續索引證據不足');
 }catch(e){reason=String(e?.message||e)}
 finally{
  if(root?.isConnected&&initial&&location.origin+location.pathname===url){root.scrollTop=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,root.scrollHeight===initial.height?initial.top:root.scrollHeight-root.clientHeight-(initial.height-initial.clientHeight-initial.top)));restore={requested:initial.top,actual:root.scrollTop,exact:root.scrollHeight===initial.height&&Math.abs(root.scrollTop-initial.top)<=2}}
  try{
   if(!registered){status('來源補證未啟動：'+reason);return}
   const entries=order.map((id,i)=>({...records.get(id),order:i,previousId:order[i-1]||null,nextId:order[i+1]||null}));
   const autoContinueIds=entries.filter((r,i)=>i>1&&['character','assistant'].includes(r.sender)&&['character','assistant'].includes(entries[i-1].sender)).map(r=>r.id);
   const result={format:'gal-ai-history-source-proof',version:1,forensicOnly:true,importable:false,complete:!reason,scope:'independent-live-source-inventory',scanRunId:run.scanRunId,scannerVersion:SCANNER_VERSION,coreVersion:core.version,source:{url},target:{cycleId:run.cycleId,cycleTitle:run.cycleTitle,worldName:run.worldName,worldKey:run.worldKey,cycleNumber:run.cycleNumber,archiveKey:run.archiveKey},generatedAt:new Date().toISOString(),reason,firstProof,lastProof,entries,windows,eventCards:[...cards.values()],autoContinueIds,initial,restore,note:'僅讀 WHIF 當時掛載來源及原文雜湊，不重新解析正文；首尾為現場虛擬列表證據，非服務端分頁 API。'};
   const audit={...result,cycleId:run.cycleId};
   const saved=await galSendEvidence({type:'gal-run-finish',...run,state:reason?'failed':'completed',scanned:entries.length,result:JSON.stringify(result),diagnostic:JSON.stringify(audit),reason});
   if(!saved?.ok)throw Error(saved?.error||'保存未確認');
   status((reason?'⛔ 補證未完成：'+reason:'✅ 獨立來源補證完成：'+entries.length+' 個 ID')+'\n'+run.batchFolder+'\n僅供檔案館交叉驗收，未重建正史。');
  }catch(e){status('來源補證保存失敗：'+String(e?.message||e))}
  finally{busy=false}
 }
}

async function anchorRecoveryProbe(){
 if(busy)return status('掃描進行中，禁止同時取證');
 if(!target?.cycleId)return status('先確認目前頁面的輪迴綁定');
 if(core?.version!==SCANNER_VERSION||!formatEvidenceReady())return status('模組版本不一致，請重新載入');
 const anchorId=$('gal-anchor-id').value.trim(),yText=$('gal-anchor-y').value.trim(),heightText=$('gal-anchor-height').value.trim();
 if(!/^[A-Za-z0-9_-]{5,100}$/.test(anchorId)||!yText||!Number.isFinite(Number(yText))||Number(yText)<0||
  (heightText&&(!Number.isFinite(Number(heightText))||Number(heightText)<=0)))return status('請填入有效原生 ID、可信 Y 與選填頁面高度');
 const y=Number(yText),oldHeight=heightText?Number(heightText):null;
 const clockText=$('gal-anchor-clock').value.trim(),targetMs=anchorHintTime(clockText);
 const neighbors=[...new Set($('gal-anchor-neighbors').value.trim().split(/\s+/u).filter(Boolean))].filter(id=>id!==anchorId);
 if((clockText&&targetMs===null)||neighbors.length>24||neighbors.some(id=>!/^[A-Za-z0-9_-]{5,100}$/.test(id)))return status('目標時間或相鄰原生ID格式錯誤');
 const history=[];let localization=null,restoreHint=null;
 busy=true;cancelled=false;paused=false;
 const origin=location.origin+location.pathname,profile={...target};
 const run={scanRunId:crypto.randomUUID(),cycleId:profile.cycleId,scope:'missing',
  worldName:profile.worldName,cycleTitle:profile.cycleTitle,scannerVersion:SCANNER_VERSION};
 const attempts=[],seen=new Set();let root=null,initial=null,registered=false,reason=null,restore=null,liveDetail=null;
 const detailFailures=[];
 const guard=()=>{
  if(cancelled||paused)throw Error('使用者中止局部取證');
  if(location.origin+location.pathname!==origin||!root?.isConnected)throw Error('聊天網址或捲動容器變更，停止取證');
 };
 try{
  await fetchCurrentBinding(profile);
  root=scroller();initial={top:root.scrollTop,height:root.scrollHeight,clientHeight:root.clientHeight};
  guard();
  restoreHint={id:anchorHistorySample(root).rawIds[0]||null,bottomDistance:Math.max(0,initial.height-initial.clientHeight-initial.top)};
  restoreHint.relativeTop=restoreHint.id?recoveryMarkerTop(root,restoreHint.id):null;
  const reg=await chrome.runtime.sendMessage({type:'gal-run-start',pageSource:location.origin+location.pathname.replace(/\/$/,''),...run});
  if(!reg?.ok)throw Error(reg?.error||'無法建立錨點取證批次');
  Object.assign(run,{worldName:reg.status?.worldName||run.worldName,worldKey:reg.status?.worldKey||null,cycleNumber:reg.status?.cycleNumber??null,archiveKey:reg.status?.archiveKey||null,batchFolder:reg.status?.batchFolder});
  registered=true;
  // Navigation is not scanning. Jump using current geometry and old
  // bottom-relative position; only detailed probes use scan-grade waits.
  const locateLimit=320;
  let requested=root.scrollTop,mode='initial',previous=null,repeat=0,lastSig=null;
  let clockHintObserved=false,decision=null,sample=null,direction=-1;
  const locatorSeen=new Set(),visited=new Set();
  for(let i=0;i<locateLimit;i++){
   guard();
   const edgeWait=mode==='preload-history';
   const fast=await anchorFastSample(root,requested,guard,edgeWait);
   sample=fast.sample;
   const stable=fast.stable;
   decision=anchorHistoryDecision(sample,anchorId,neighbors,targetMs);
   clockHintObserved||=!!decision.near||decision.kind==='clock-hint-only';
   history.push({requested,beforeHeight:fast.beforeHeight,stable,mode,waitMs:fast.elapsed,...sample,decision});
   if(stable&&decision.kind!=='target-interval-unconfirmed')break;
   const sig=anchorHistorySignature(sample);
   repeat=sig===lastSig?repeat+1:0;lastSig=sig;
   locatorSeen.add(sig);
   if(!stable){
    requested=sample.top;mode='retry-layout';
    if(repeat>=5)break;
    continue;
   }
   visited.add(sample.height+':'+sample.clientHeight+':'+Math.round(sample.top));
   const plan=anchorFastPlan(sample,decision,targetMs,y,oldHeight,previous,visited);
   previous={top:sample.top,height:sample.height,clientHeight:sample.clientHeight,direction};
   direction=plan.direction||direction;
   if(repeat>=5&&Math.abs(plan.top-sample.top)<=2)break;
   requested=plan.top;mode=plan.mode;
   status('🧭 快速歷史定位 '+(i+1)+'/'+locateLimit+'；高度 '+sample.height+'；'+mode+'；尚未確認目標區間');
  }
  localization={decision,clockHintObserved,samples:history.length,distinctLayouts:locatorSeen.size,
   navigation:'fast-bottom-relative-coarse',waitMs:history.reduce((n,x)=>n+(x.waitMs||0),0),stopped:history.at(-1)?.stable&&decision?.kind!=='target-interval-unconfirmed'?'located':'limit-or-stalled'};
  // If there is no evidence of the neighborhood, preserve localization
  // evidence and stop instead of pretending the target was absent.
  if(localization.stopped==='located'){
   let center=root.scrollTop,centerHeight=root.scrollHeight,centerWidth=root.clientHeight;
   const reference=decision.kind==='anchor-id-observed'?anchorId:decision.matches[0];
   const markerY=reference?recoveryMarkerTop(root,reference):null;
   if(Number.isFinite(markerY))center+=markerY-root.clientHeight/3;
   let planned=[root.scrollTop,...anchorProbeOffsets(center,root.clientHeight,root.scrollHeight-root.clientHeight)];
   if(oldHeight!==null&&Math.abs(root.scrollHeight-oldHeight)<root.clientHeight)
    planned.push(...anchorProbeOffsets(y,root.clientHeight,root.scrollHeight-root.clientHeight));
   for(let i=0;i<planned.length&&attempts.length<16;i++){
    guard();
    const requested=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,planned[i]));
    const key=[root.scrollHeight,root.clientHeight,Math.round(requested)].join(':');
    if(seen.has(key))continue;seen.add(key);
    const beforeHeight=root.scrollHeight;root.scrollTop=requested;
    await sleep(WAIT_MS+STABLE_MS);guard();
    const before=anchorProbeSnapshot(root,anchorId);
    await sleep(STABLE_MS);guard();
    const after=anchorProbeSnapshot(root,anchorId);
    const stable=before.scrollHeight===after.scrollHeight&&Math.abs(before.scrollTop-after.scrollTop)<2&&
     JSON.stringify(before.rawIds)===JSON.stringify(after.rawIds)&&
     JSON.stringify(before.rows.map(x=>x.sourceIds))===JSON.stringify(after.rows.map(x=>x.sourceIds));
    attempts.push({requested,beforeHeight,stable,before,after});
    if(stable&&!liveDetail&&before.state==='anchor-collected'&&after.state==='anchor-collected'){
     const a=before.rows.find(r=>r.sourceIds.includes(anchorId)),b=after.rows.find(r=>r.sourceIds.includes(anchorId));
     if(a&&b&&a.textHash===b.textHash&&a.textLength===b.textLength){
      const detail=anchorDetailedEvidence(root,anchorId,b,run);
      if(detail.complete)liveDetail=detail;
      else detailFailures.push({attempt:attempts.length,missing:detail.missing});
     }
    }
    status('🧪 錨點復原取證 '+attempts.length+'/16：'+after.state+'；僅保全，不接續掃描');
    if(root.scrollHeight!==centerHeight||root.clientHeight!==centerWidth){
     const live=reference?recoveryMarkerTop(root,reference):null;
     center=root.scrollTop+(Number.isFinite(live)?live-root.clientHeight/3:0);
     centerHeight=root.scrollHeight;centerWidth=root.clientHeight;
     planned=planned.slice(0,i+1).concat(anchorProbeOffsets(center,centerWidth,centerHeight-centerWidth));
    }
    if(after.anchorMarkerCount===1&&Number.isFinite(after.anchorRelativeTop)){
     const centered=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,root.scrollTop+after.anchorRelativeTop-root.clientHeight/3));
     if(!seen.has([root.scrollHeight,root.clientHeight,Math.round(centered)].join(':')))planned.splice(i+1,0,centered);
    }
   }
  }
 }catch(error){reason=String(error?.message||error)}
 finally{
  if(root?.isConnected&&initial&&location.origin+location.pathname===origin){
   const live=restoreHint?.id?recoveryMarkerTop(root,restoreHint.id):null;
   const canRestoreMarker=Number.isFinite(live)&&Number.isFinite(restoreHint?.relativeTop);
   const requested=canRestoreMarker?root.scrollTop+live-restoreHint.relativeTop:
    root.scrollHeight===initial.height?initial.top:root.scrollHeight-root.clientHeight-(restoreHint?.bottomDistance||0);
   root.scrollTop=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,requested));
   restore={requested,actual:root.scrollTop,height:root.scrollHeight,mode:canRestoreMarker?'original-marker':root.scrollHeight===initial.height?'original-coordinate':'approximate-bottom-distance',exact:false};
  }
  try{
   if(!registered){status('錨點取證未啟動：'+(reason||'未知錯誤'));return;}
   const reach=anchorProbeReach(attempts,localization,anchorId,neighbors);
   const result={format:'gal-ai-anchor-recovery-probe',version:2,importable:false,validated:false,complete:false,
    forensicOnly:true,scanRunId:run.scanRunId,scannerVersion:SCANNER_VERSION,coreVersion:core.version,
    liveDetail:liveDetail||{complete:false,missing:detailFailures.length?detailFailures:['no-stable-unique-accepted-event-capture']},
    generatedAt:new Date().toISOString(),scope:'anchor-overlap-diagnostic',source:{url:origin},
    target:{cycleId:profile.cycleId,cycleTitle:profile.cycleTitle,worldName:run.worldName,worldKey:run.worldKey,cycleNumber:run.cycleNumber,archiveKey:run.archiveKey},
    input:{anchorId,lastGoodY:y,previousScrollHeight:oldHeight,targetClock:clockText||null,neighbors},initial,restore,reason,localization,reach,history,attempts,
    observedStates:[...new Set(attempts.flatMap(a=>[a.before.state,a.after.state]))],
    note:'僅局部 DOM 與候選視窗鑑識，未證明連續性、未追加訊息、不得匯入正史。'};
   const audit={...run,format:'gal-ai-anchor-recovery-diagnostic',importable:false,initial,restore,reason,
    localization,reach,liveDetail:{complete:!!liveDetail,sourceId:anchorId,missing:liveDetail?[]:result.liveDetail.missing},historySampleCount:history.length,attemptCount:attempts.length,observedStates:result.observedStates,attempts:attempts.map(a=>({requested:a.requested,stable:a.stable,actual:a.after.scrollTop,height:a.after.scrollHeight,anchorMarkerCount:a.after.anchorMarkerCount,state:a.after.state,rawIds:a.after.rawIds,candidateIds:a.after.rows.flatMap(x=>x.sourceIds)}))};
   diagnostic=audit;
   const saved=await galSendEvidence({type:'gal-run-finish',...run,state:reason?'failed':'completed',scanned:0,result:JSON.stringify(result),diagnostic:JSON.stringify(audit),reason:reason||null});
   if(!saved?.ok)throw Error(saved?.error||'下載未確認');
   status('🧪 歷史定位 '+history.length+' 次；局部取證 '+attempts.length+' 次'+(reason?'；中斷：'+reason:'')+'\n'+reach.state+'\n'+result.observedStates.join(' / ')+'\n批次：'+run.batchFolder+'\n只供鑑識，不代表掃描通過。');
  }catch(error){status('錨點取證保存失敗：'+String(error?.message||error))}
  finally{busy=false;}
 }
}

function hash(str){let h1=2166136261,h2=0x811c9dc5;for(let i=0;i<str.length;i++){
 h1=Math.imul(h1^str.charCodeAt(i),16777619)>>>0;h2=Math.imul(h2^str.charCodeAt(i),2246822519)>>>0;
 }return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');}
function canonical(rows,valid,preview){
 const path=location.origin+location.pathname;
 const chatKey=(hash(path)+hash(path+'|Gal AI')).slice(0,32);
 const build=(entry,i,kind)=>{
  const sourceEventId='galnative-'+hash(path+'|'+i+'|'+kind);
  return {
  id:sourceEventId,
  role:entry.role,text:entry.text,gameTime:entry.gameTime||null,
  sourceEventId,
  sourcePartIndex:0,chatKey,messageOrder:Number.isInteger(entry.scanIndex)?entry.scanIndex:i,
  scanIndex:Number.isInteger(entry.scanIndex)?entry.scanIndex:null,
  sourceKind:'gal-ai-native',sourceSite:location.origin
  };
 };
 const messages=valid.messages.map((m,i)=>build(m,i,'message'));
 for(const [i,row] of valid.messages.entries()){
  if(row.verifiedUntimedNative)messages[i].nativeClockEvidence='verified-original-without-game-time';
  if(row.nativeInvalidDateEvidence){
   messages[i].nativeClockEvidence='verified-original-invalid-calendar-date';
   messages[i].nativeInvalidDateEvidence=row.nativeInvalidDateEvidence;
   messages[i].nativeSourceMessageId=row.nativeInvalidDateEvidence.sourceMessageId;
  }
  if(row.nativePairedInvalidDate)messages[i].nativePairedInvalidDate=row.nativePairedInvalidDate;
  if(Array.isArray(row.nativeUserSegments)){
   messages[i].nativeUserSegments=row.nativeUserSegments;
   messages[i].nativeUserMergeVerified=true;
  }
 }
 for(const [i,row] of valid.messages.entries()){
  if(row.autoContinue)messages[i].autoContinue={
   kind:'whif-adjacent-character-replies',previousSourceEventId:messages[i-1].sourceEventId
  };
 }
 const events=valid.events.map((e,i)=>({...build(e,e.scanIndex,'event'),role:'ai',
  status:'accepted',title:e.title,worldName:e.worldName||null,scanIndex:e.scanIndex}));
 return {
  format:'gal-ai-authoritative-scan',version:1,scannerVersion:SCANNER_VERSION,coreVersion:core.version,generatedAt:new Date().toISOString(),
  scope:preview?'opening-first-pair-preview':'entire-opening-to-bottom',source:{url:location.origin+location.pathname,origin:location.origin,
    path:location.pathname,gameClockOnly:true,...(core.isRoadWorld(target.worldName)?{gameClockProfile:'road',gameClockEncoding:core.ROAD_CLOCK_ENCODING}:{})},target:{cycleId:target.cycleId,worldName:target.worldName,
    cycleTitle:target.cycleTitle,uid:target.uid||'',manager:target.managerNames.join('、'),managerNames:target.managerNames},
  opening:valid.opening,messages,events,validation:{ok:valid.ok,pairs:valid.pairs,events:events.length,
    ...(valid.autoContinues?{autoContinues:valid.autoContinues}:{}),
    openingChars:valid.opening.length,gameTimeCount:messages.filter(m=>!!m.gameTime).length,
    unknownGameTimeCount:valid.unknownGameTimeCount||0,verifiedUntimedCount:valid.verifiedUntimedCount||0,
    invalidDateReplyCount:valid.invalidDateReplyCount||0,invalidDateRowCount:valid.invalidDateRowCount||0,
    warnings:valid.warnings,errors:valid.errors},rawRows:rows.length,
  readOnlyUntilImported:!preview,note:preview?'僅供三則測試驗收。':'原生來源對完整對話及事件具有優先權；不會更動副駕駛聊天、世界觀或補充筆記。覆蓋前需在檔案館確認備份。'
 };
}
function applyNativeFormat(entry,rows,sourceCounts,scanMode,nativeCopy='',event=false,opening=false){
 const metadata=rows[entry.scanIndex]?.formatSource;
 const source=metadata?.nativeReply;
 const matchedRow=source?.scannedText===entry.text;
 const uniqueSource=Boolean(source?.messageId&&sourceCounts.get(source.messageId)===1);
 const nativeText=nativeCopy||(matchedRow&&uniqueSource&&source?.reason==='available'?source.text:'');
 const check={scannerVersion:SCANNER_VERSION,coreVersion:core.version,scanIndex:entry.scanIndex,
  gameTime:entry.gameTime,
  source:'rendered-dom',reason:source?.reason||'native-source-unavailable',
  domNewlines:(entry.text.match(/\n/g)||[]).length,
  domBlankLines:(entry.text.match(/\n[ \t]*\n/g)||[]).length,
  candidate:{type:nativeCopy?'clipboard-paste':'whif-message-content',
   path:nativeCopy?'panel-textarea':scanMode+' / data-selection-copy-message-id / React message.content',
   firstReplyScanIndex:entry.scanIndex,markerCount:source?.markerCount??0,
   matchedVisibleMessageId:!nativeCopy&&source?.reason==='available',matchedFirstReplyRow:matchedRow,uniqueSource}};
 if(!nativeCopy&&source?.reason==='available'){
  if(!matchedRow)check.reason='first-reply-row-mismatch';
  else if(!uniqueSource)check.reason='duplicate-native-source-id';
 }
 let localContext=null;
 if(nativeText){
  const result=core.compareNativeParagraphs(entry.text,nativeText,{
   source:nativeCopy?'native-copy':event?'whif-event-content':'whif-message-content',worldName:target?.worldName,
   statusText:metadata?.statusText,codeBlocks:metadata?.codeBlocks,
   chapterTitle:nativeCopy?undefined:source?.chapterTitle,event,opening,
   nativeEventProof:!nativeCopy&&event&&matchedRow&&uniqueSource&&source?.markerCount===1?source.eventEvidence:null,
   verifiedUntimedNative:entry.verifiedUntimedNative===true,eventTitle:event?entry.title:undefined,
   allowInvalidNativeDate:!nativeCopy&&!event&&!opening&&!!entry.nativeInvalidDateEvidence&&source?.markerCount===1&&uniqueSource&&matchedRow&&
    entry.nativeInvalidDateEvidence.sourceMessageId===source?.messageId&&source?.eventEvidence?.sender==='character'&&source?.eventEvidence?.kind==='ordinary-message'
  });
  check.comparison=result.comparison;
  if(result.text!==null){
   check.reason=result.text===entry.text?'source-matched-no-change':'applied';
   entry.text=result.text;
   check.source=nativeCopy?'native-copy':'whif-message-content';
  }else{
   check.reason=result.comparison.contentEqual?'story-time-mismatch':'content-mismatch';
   localContext=result.localContext||null;
  }
 }
 check.exportedBlankLines=(entry.text.match(/\n[ \t]*\n/g)||[]).length;
 check.exportedNewlines=(entry.text.match(/\n/g)||[]).length;
 return {check,localContext};
}
function summarizeNativeFormats(results,includeComparison=false){
 const rows=results.map(({check})=>({scanIndex:check.scanIndex,gameTime:check.gameTime,reason:check.reason,source:check.source,
  sourceIdMatched:check.candidate.matchedVisibleMessageId&&check.candidate.uniqueSource,
  domNewlines:check.domNewlines,exportedNewlines:check.exportedNewlines,
  domBlankLines:check.domBlankLines,exportedBlankLines:check.exportedBlankLines,
  ...(includeComparison||check.source==='rendered-dom'?{candidate:check.candidate,comparison:check.comparison}:{})}));
 return {total:rows.length,applied:rows.filter(row=>row.reason==='applied').length,
  matchedWithoutChange:rows.filter(row=>row.reason==='source-matched-no-change').length,
  fallback:rows.filter(row=>row.source==='rendered-dom').length,rows};
}
function showLocalDifferences(results){
 const select=$('gal-scan-difference-row');
 select.replaceChildren();
 for(const {check,localContext} of results){
  if(!localContext)continue;
  localDifferences.set(check.scanIndex,localContext);
  const option=document.createElement('option');
  option.value=String(check.scanIndex);
  const gameClock=check.gameTime?new Intl.DateTimeFormat('zh-TW',{
   timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).format(new Date(check.gameTime)):'時間無法核對';
  option.textContent='位置 '+check.scanIndex+' · 遊戲時間 '+gameClock;
  select.append(option);
 }
 const hidden=localDifferences.size===0;
 $('gal-scan-difference').hidden=hidden;
 $('gal-scan-difference-label').hidden=hidden;
}

function pickVisibleEventTriple(rows,root){
 const container=isDocumentRoot(root)?{top:0,bottom:innerHeight}:root.getBoundingClientRect();
 const center=(container.top+container.bottom)/2;
 const candidates=[];
 for(let index=0;index<rows.length;index++){
  const event=rows[index];
  if(event.eventType!=='event'||event.role!=='ai')continue;
  const previous=rows[index-1],next=rows[index+1];
  if(!previous||previous.role!=='ai'||previous.eventType||!next||next.role!=='me')continue;
  const rect=event.scanNode?.getBoundingClientRect?.();
  const y=rect?(rect.top+rect.bottom)/2:center;
  candidates.push({index,previous,event,next,distance:Math.abs(y-center)});
 }
 if(!candidates.length)throw Error('目前畫面找不到完整的「上一則 Gal AI → 事件 → 下一則我」。請把問題事件捲到畫面中央附近再按一次。');
 candidates.sort((a,b)=>a.distance-b.distance);
 return candidates[0];
}
function eventProbeRow(row,position,index){
 const source=row.formatSource?.nativeReply;
 return {
  position,index,role:row.role,eventType:row.eventType||null,
  scannedText:row.text,
  nativeText:source?.reason==='available'?source.text:null,
  nativeReason:source?.reason||'native-source-unavailable',
  sourceMessageId:source?.messageId||null,
  eventEvidence:source?.eventEvidence||null
 };
}

// Local, source-anchored 7-row forensic probe. It never treats an arbitrary
// viewport ordinal as a global scan index, nor triggers a one-hour rescan.
async function positionSevenProbe(mode){
 if(busy){status('掃描正在執行中，請勿用指定位置測試干擾目前工作');return}
 if(!target?.cycleId||!activeScanRows?.length){
  status('沒有本分頁前次掃描的全輪來源索引。不能把目前 DOM 排列位置冒充 scanIndex。');return;
 }
 const previous=activeRun,rows=activeScanRows;
 try{await fetchCurrentBinding(target);if(previous?.cycleId!==target.cycleId||previous?.worldName!==target.worldName||previous?.cycleTitle!==target.cycleTitle)throw Error('前次掃描與目前世界觀／輪迴綁定不一致');}catch(error){status(String(error.message||error));return}
 let index=null,sourceId=null,run=null,registered=false,probeRows=[];
 try{
  if(mode==='index'){
   const raw=$('gal-scan-index-input').value.trim();
   if(!/^\d+$/.test(raw))throw Error('請填寫從 0 開始的有效 scanIndex');
   index=Number(raw);
  }else if(mode==='last-error'){
   if(!lastFailureIndices.length)throw Error('最近一次掃描沒有可核對的錯誤 scanIndex');
   index=lastFailureIndices[0];
  }else if(mode==='visible'){
   const shot=snapshot(null,'bounded',false,true);
   const root=shot.root.getBoundingClientRect();
   const center=(root.top+root.bottom)/2;
   const choices=shot.rows.filter(row=>row.role==='ai'&&
    row.formatSource?.nativeReply?.messageId&&row.scanNode?.getBoundingClientRect);
   if(!choices.length)throw Error('當前畫面找不到可辨識來源 ID 的 WHIF AI 訊息');
   choices.sort((a,b)=>{
    const centerOf=r=>{const x=r.scanNode.getBoundingClientRect();return (x.top+x.bottom)/2};
    return Math.abs(centerOf(a)-center)-Math.abs(centerOf(b)-center);
   });
   sourceId=choices[0].formatSource.nativeReply.messageId;
   const matches=rows.flatMap((row,i)=>
    row.formatSource?.nativeReply?.messageId===sourceId?[i]:[]);
   if(matches.length!==1)throw Error('當前訊息來源 ID 無法唯一對應前次掃描 scanIndex，不得猜測位置');
   index=matches[0];
  }else throw Error('未知的指定位置模式');
  if(!Number.isSafeInteger(index)||index<0||index>=rows.length)
   throw Error('指定索引 '+index+' 不在前次已讀 '+rows.length+' 則資料內；不能補造未讀內容');
  const start=Math.max(0,index-3),end=Math.min(rows.length,index+4);
  const selected=rows.slice(start,end);
  probeRows=selected;
  // Full rows and their source IDs come from the actual prior scan memory,
  // NOT an unanchored newly loaded viewport.
  const output=selected.map((row,offset)=>{
   const i=start+offset,native=row.formatSource?.nativeReply||null;
   return {scanIndex:i,role:row.role,eventType:row.eventType||null,
    domText:row.text,nativeText:native?.reason==='available'?native.text:null,
    nativeSourceId:native?.messageId||null,
    unavailableReason:native?.reason==='available'?null:native?.reason||'not-captured',
    playerSources:row.formatSource?.playerSources||[],
    sourceEvidence:native?.eventEvidence||null,
    originalTimeHeader:core.clean(row.text).split('\n').slice(0,12),
    parsedTime:core.parseGameTime(row.text)||null,
    nativeParsedTime:native?.text?core.parseGameTime(native.text):null,
    explicitUnknownClock:core.isExplicitUnknownGameTime(row.text)};
  });
  run={scanRunId:crypto.randomUUID(),cycleId:target.cycleId,
   scope:'position-seven',worldName:target.worldName,cycleTitle:target.cycleTitle,scannerVersion:SCANNER_VERSION};
  const managed=['whif.io','www.whif.io'].includes(location.hostname);
  if(!managed)throw Error('指定位置測試僅支援正式 WHIF 分頁');
  const reg=await chrome.runtime.sendMessage({type:'gal-run-start',pageSource:location.origin+location.pathname.replace(/\/$/,''),...run});
  if(!reg?.ok)throw Error(reg?.error||'無法建立獨立指定位置測試批次');
  Object.assign(run,{worldName:reg.status?.worldName||run.worldName,cycleNumber:reg.status?.cycleNumber??null,worldKey:reg.status?.worldKey||null,archiveKey:reg.status?.archiveKey||null});
  run.batchFolder=reg.status?.batchFolder;
  run.statusPath=reg.status?.statusPath;
  registered=true;activeRun=run;
  const report={
   format:'gal-ai-position-seven-test',version:1,importable:false,
   generatedAt:new Date().toISOString(),scanRunId:run.scanRunId,
   scope:'source-anchored-position-seven',
   source:{url:location.origin+location.pathname},target:{cycleId:target.cycleId,cycleTitle:target.cycleTitle,
    worldName:target.worldName},
   originalScanRunId:previous?.scanRunId||null,
   selectedIndex:index,selectionMode:mode,selectedSourceId:sourceId,
   fromScanIndex:start,toScanIndex:end-1,
   count:output.length,completeSevenRows:output.length===7,rows:output,
   note:'只讀前次掃描記憶並核實原生來源；不能據此產出完整正史。'
  };
  const audit={
   scanRunId:run.scanRunId,cycleId:target.cycleId,scannerVersion:SCANNER_VERSION,
   sourceRunId:previous?.scanRunId||null,selectionMode:mode,selectionIndex:index,
   scannedRows:output.length,sourceIds:output.map(x=>x.nativeSourceId),
   ...failureContexts(rows,{errors:['第 '+(index+1)+' 則指定位置來源核對']},null)
  };
  const finished=await galSendEvidence({type:'gal-run-finish',...run,
   state:'completed',scanned:output.length,result:JSON.stringify(report),
   diagnostic:JSON.stringify(audit)});
  if(!finished?.ok)throw Error(finished?.error||'指定位置測試已讀取但下載尚未完成');
  status('🧪 '+target.cycleTitle+' 指定位置 '+index+'，已整理 '+output.length+
   ' 則。批次 '+(run.batchFolder||'未知')+
   '。'+(finished.status?.state==='completed'?'Chrome 已完成下載':'等待 Chrome 下載完成')+
   '。未驗證資料不能匯入。');
 }catch(error){
  const message=String(error.message||error);
  if(registered){
   const report={scanRunId:run.scanRunId,cycleId:run.cycleId,
    scannerVersion:SCANNER_VERSION,
    sourceScanRunId:previous?.scanRunId||null,
    index,selectionMode:mode,error:message,
    ...failureContexts(probeRows,null,message)};
   let unverified=null;
   if(probeRows.length){
    const data=unverifiedEvidence(probeRows,run,message,report);
    // The original whole-scan indices must not be replaced by slice ordinals.
    data.rows.forEach((row,i)=>{row.scanIndex=rows.indexOf(probeRows[i])});
    unverified=JSON.stringify(data);
   }
   const saved=await galSendEvidence({type:'gal-run-finish',...run,
    state:'failed',scanned:probeRows.length,reason:message,
    unverified,diagnostic:JSON.stringify(report)}).catch(e=>({error:String(e)}));
   status('指定位置測試失敗：'+message+'\n批次：'+(run.batchFolder||'未知')+
    '\n'+(saved?.ok?'已送出診斷與未驗證保全':'未能確認下載：'+(saved?.error||'未知')));
  }else status('指定位置測試未通過：'+message);
 }
}

async function eventThreeRowProbe(profile){
 if(busy)return {ok:false,error:'正在掃描中'};
 if(core?.version!==SCANNER_VERSION||!formatEvidenceReady()){const error='掃描器、核心或格式驗收模組缺失／版本不一致，請重新整理 Gal AI 頁面';status(error);return {ok:false,error};}
 busy=true;cancelled=false;paused=false;target=profile;mount();localDifferences.clear();
 const run={scanRunId:crypto.randomUUID(),cycleId:profile.cycleId,scope:'event-three',worldName:profile.worldName,cycleTitle:profile.cycleTitle,scannerVersion:SCANNER_VERSION};
 let registered=false,localRows=[];
 $('gal-scan-difference').hidden=true;$('gal-scan-difference-label').hidden=true;
 try{
  await fetchCurrentBinding(profile);
  const response=await chrome.runtime.sendMessage({type:'gal-run-start',pageSource:location.origin+location.pathname.replace(/\/$/,''),...run});
  if(!response?.ok)throw Error(response?.error||'無法建立事件測試批次');
  Object.assign(run,{worldName:response.status?.worldName||run.worldName,cycleNumber:response.status?.cycleNumber??null,worldKey:response.status?.worldKey||null,archiveKey:response.status?.archiveKey||null});
  run.batchFolder=response.status?.batchFolder;registered=true;activeRun=run;
  const shot=snapshot(null,'auto',false,true);
  diagnostic=inspect();
  if(!shot.rows.length)throw Error('目前畫面沒有可讀取的訊息');
  const scanMode=shot.method==='world-header-reaction-bar'?'bounded':'legacy';
  const picked=pickVisibleEventTriple(shot.rows,shot.root);
  const rows=[picked.previous,picked.event,picked.next];localRows=rows;
  const sourceCounts=new Map();
  for(const row of rows){
   const id=row.formatSource?.nativeReply?.messageId;
   if(id)sourceCounts.set(id,(sourceCounts.get(id)||0)+1);
  }
  const previousEntry={role:'ai',text:picked.previous.text,gameTime:core.parseGameTime(picked.previous.text)?.iso||null,scanIndex:0};
  const eventEntry={role:'ai',text:picked.event.text,gameTime:core.parseGameTime(picked.event.text)?.iso||null,
   scanIndex:1,title:core.clean(picked.event.text.split('\n')[0]||'')};
  const previousFormat=applyNativeFormat(previousEntry,rows,sourceCounts,scanMode,'',false);
  const eventFormat=applyNativeFormat(eventEntry,rows,sourceCounts,scanMode,'',true);
  showLocalDifferences([previousFormat,eventFormat]);
  const probeNativeFormatAudit=requireFormatEvidence().summarize(
   rows,[previousFormat,eventFormat],core,true);
  const eventTestId=crypto.randomUUID();
  const result={
   format:'gal-ai-event-three-row-test',version:1,generatedAt:new Date().toISOString(),
   scannerVersion:SCANNER_VERSION,coreVersion:core.version,eventTestId,scanRunId:run.scanRunId,importable:false,
   scope:'event-three-row-preview',
   source:{url:location.origin+location.pathname,origin:location.origin,path:location.pathname},
   target:{cycleId:profile.cycleId,worldName:profile.worldName,cycleTitle:profile.cycleTitle,
    manager:profile.managerNames.join('、'),managerNames:profile.managerNames},
   selection:{method:'nearest-visible-valid-event',distanceFromViewportCenterPx:Math.round(picked.distance),
    visibleRowCount:shot.rows.length,scanMode},
   rows:[
    {...eventProbeRow(picked.previous,'above-ai',0),exportedText:previousEntry.text},
    {...eventProbeRow(picked.event,'event',1),exportedText:eventEntry.text},
    {...eventProbeRow(picked.next,'below-me',2),exportedText:picked.next.text}
   ],
   paragraphAudit:{
    previousAi:summarizeNativeFormats([previousFormat]),
    event:summarizeNativeFormats([eventFormat],true)
   },
   nativeFormatAudit:{complete:probeNativeFormatAudit.nativeFormatComplete,
    failedNativeRows:probeNativeFormatAudit.failedNativeRows,
    checkedNativeRows:probeNativeFormatAudit.checkedNativeRows},
   note:'局部事件三則測試：只讀目前畫面附近的上一則 Gal AI、事件、下一則玩家回應；不匯入、不覆蓋正式正史。'
  };
  diagnostic={...diagnostic,...run,scannerVersion:SCANNER_VERSION,coreVersion:core.version,
   nativeFormatAudit:probeNativeFormatAudit,
   validationPhases:{integrity:'local-three-row-only',
    nativeFormatting:probeNativeFormatAudit.nativeFormatComplete?'passed':'failed'},
   eventThreeRowTest:{eventTestId,selection:result.selection,
    previousAi:previousFormat.check,event:eventFormat.check,
    localDifferences:{previousAi:previousFormat.localContext||null,event:eventFormat.localContext||null}}};
  const saved=await galSendEvidence({type:'gal-run-finish',...run,
   state:'completed',scanned:3,result:JSON.stringify(result),
   diagnostic:JSON.stringify(diagnostic)});
  if(!saved?.ok)throw Error(saved?.error||'事件測試下載尚未完成');
  const diff=eventFormat.localContext;
  status((probeNativeFormatAudit.nativeFormatComplete?'✅ 事件三則格式驗收通過。':'⚠ 事件三則鑑識已完成，但原生格式尚未全部通過！完整原生／DOM／來源 ID 已寫入診斷，不得匯入正史。')+'\n'+
   '上一則 Gal AI：'+previousFormat.check.reason+'\n事件：'+eventFormat.check.reason+
   '\n下一則玩家回應：已擷取'+
   (diff?'\n事件首個差異：掃描「'+diff.scanned+'」／native「'+diff.native+'」':'')+
   '\n已建立事件測試批次：'+(run.batchFolder||'未知')+
   '\n下載狀態：'+(saved.status?.state==='completed'?'已核對完成':'等待 Chrome 實際下載')+'。');
  return {ok:true,eventTestId,eventReason:eventFormat.check.reason,
   nativeFormatComplete:probeNativeFormatAudit.nativeFormatComplete};
 }catch(error){
  const message=String(error?.message||error);
  diagnostic={...(diagnostic||inspect()),...run,scannerVersion:SCANNER_VERSION,
   coreVersion:core.version,eventThreeRowError:message,
   ...failureContexts(localRows,null,message)};
  if(registered){
   const saved=await galSendEvidence({type:'gal-run-finish',...run,state:'failed',
    scanned:localRows.length,reason:message,
    unverified:localRows.length?JSON.stringify(unverifiedEvidence(localRows,run,message,diagnostic)):null,
    diagnostic:JSON.stringify(diagnostic)}).catch(error=>({error:String(error)}));
   status('⛔ 事件三則測試失敗：'+message+'\n批次：'+(run.batchFolder||'未知')+
    '\n'+(saved?.ok?'已送出保全下載':'保全失敗：'+(saved?.error||'未知')));
  }else status('⛔ 事件三則測試啟動失敗：'+message);
  return {ok:false,error:message};
 }finally{busy=false}
}

async function scan(profile,preview=false,requireNative=false,scanRunId=crypto.randomUUID()){
 if(busy)return {ok:false,error:'正在掃描中'};
 if(core?.version!==SCANNER_VERSION||!formatEvidenceReady()){const error='掃描器、核心或格式驗收模組缺失／版本不一致，請重新整理 Gal AI 頁面';status(error);return {ok:false,error};}
 const run={scanRunId,cycleId:profile.cycleId,scope:preview?'preview':'full',worldName:profile.worldName,cycleTitle:profile.cycleTitle};
 const managed=['whif.io','www.whif.io'].includes(location.hostname)&&location.protocol==='https:'&&
  typeof chrome.runtime.sendMessage==='function';
 activeRun=run;
 busy=true;cancelled=false;paused=false;lastResult=null;diagnostic=null;localDifferences.clear();target=profile;mount();
 $('gal-scan-difference').hidden=true;
 $('gal-scan-difference-label').hidden=true;
 const nativeCopy=$('gal-scan-native-copy').value.trim();
 const exportButton=$('gal-scan-export');
 exportButton.disabled=true;
 exportButton.textContent=preview?'下載三則測試 JSON':'下載原生正史 JSON';
 const collected=[];activeScanRows=collected;let bottomFrames=0,stepCount=0,failure='',recovery=0,root=null,lastGoodY=0,stepPx=0,noProgress=0,geometryReanchors=0,scanMode='auto',bottomProof=null;
 const recoveryLog=[];let trustedScroll=null;
 const phaseHistory=[];let phase='scan',bottomRetries=0;
 const phaseStatus=(name,msg)=>{phase=name;phaseHistory.push({phase:name,at:new Date().toISOString()});diagnostic={...(diagnostic||{}),phase,phaseHistory:phaseHistory.slice(-30)};status(msg);};
 const yieldUi=()=>sleep(0);
 const ensureRunning=()=>{if(cancelled||paused)throw Error(cancelled?'使用者停止掃描':'使用者暫停驗收')};
 let progressLastCount=0,progressLastAt=Date.now();
 let unpairedReply=null,scrollStall=null;
 const continuedPositions=[];
 const eventAudit={headers:new Map(),native:new Map(),unverifiedCards:new Map(),probes:new WeakMap(),history:new Map(),senders:new Map(),playerSourceRows:new Map(),userNearby:new Map()};
 let firstTimedTrace=null;
 let registered=false;
 // Preserve any partially valid event classifications in failure diagnostics.
 // A missing-clock AI must not erase previously observed accepted events.
 let failedValidation=null;
 let autoContinueAudit=null;
 let paragraphCheck={scannerVersion:SCANNER_VERSION,coreVersion:core.version,
  source:'rendered-dom',reason:'first-reply-not-validated'};
 try{
  if(managed){
   await fetchCurrentBinding(profile);
   const response=await chrome.runtime.sendMessage({type:'gal-run-start',pageSource:location.origin+location.pathname.replace(/\/$/,''),...run,
    scannerVersion:SCANNER_VERSION});
   if(!response?.ok)throw Error(response?.error||'背景程式未登記掃描工作');
   Object.assign(run,{worldName:response.status?.worldName||run.worldName,cycleNumber:response.status?.cycleNumber??null,worldKey:response.status?.worldKey||null,archiveKey:response.status?.archiveKey||null});
   run.batchFolder=response.status?.batchFolder||null;
   run.statusPath=response.status?.statusPath||null;
   registered=true;
  }
  const first=snapshot();diagnostic=inspect();
  if(!first.rows.length)throw Error('找不到完整訊息。世界觀界線與舊版泡泡辨識都沒有結果；請複製版面診斷。');
  scanMode=first.method==='world-header-reaction-bar'?'bounded':'legacy';
  if(!core.isAllowedOpeningRow(first.rows[0],target.worldName))
   throw Error('第一則不是綁定世界觀的可驗證輪迴開場，請回到最初訊息');
  root=first.root;lastGoodY=root.scrollTop;
  const nominal=Math.max(12,Math.min(MAX_SCROLL_PX,Math.floor(root.clientHeight*SCROLL_RATIO)));
  stepPx=nominal;
  while(!cancelled&&!paused&&stepCount<12000){
   if(!root.isConnected)throw Error('頁面替換了原捲動容器，為避免漏掃已停止');
   let shot=snapshot(root,scanMode,!firstTimedTrace,true);
   firstTimedTrace||=shot.firstTimedTrace;
   let info;
   try{info=appendSample(shot,collected)}
   catch(err){
    observeEventAudit(eventAudit,shot,collected,null);
    const reason=String(err?.message||err);
    if(!/重疊|無法找到順序|無法比對|沒有可比對的訊息|錨點不唯一|重複短句/.test(reason))throw err;
    recovery++;
    recoveryLog.push({step:stepCount,kind:'no-overlap',distance:stepPx,seen:shot.rows.length,stored:collected.length});
    diagnostic={...inspect(),recoveryLog:recoveryLog.slice(-10),lastGoodY,
      failingY:root.scrollTop,lastRole:collected.at(-1)?.role||null,
      currentFirstRole:shot.rows[0]?.role||null};
    if(recovery>9||stepPx<=12)
     throw Error('第 '+stepCount+' 步無法對上前後視窗，縮至 '+stepPx+'px 仍失敗，已保護正史並停止');
    const recovered=await recoverScanOverlap(root,trustedScroll,collected,
     ()=>snapshot(root,scanMode,false,true),id=>recoveryMarkerTop(root,id),sleep,ensureRunning);
    recoveryLog.push({step:stepCount,kind:'native-overlap-recovery',
     success:recovered.ok,attempts:recovered.attempts});
    diagnostic={...(diagnostic||{}),recoveryLog:recoveryLog.slice(-12)};
    if(!recovered.ok)
     throw Error('無法重新證明上一可信視窗的原生ID及順序重疊，拒絕猜測中間訊息');
    stepPx=Math.max(12,Math.floor(stepPx/2));
    bottomFrames=0;
    shot=recovered.shot;
    info=appendSample(shot,collected);
    status('↻ 第 '+stepCount+' 步已重新證明原生訊息重疊，改為 '+stepPx+'px 微捲動。');

   }
   observeEventAudit(eventAudit,shot,collected,info);
   recovery=0;lastGoodY=root.scrollTop;
   trustedScroll=trustedRecoveryAnchor(root,shot,id=>recoveryMarkerTop(root,id));
   for(let index=Math.max(2,collected.length-info.added);index<collected.length;index++){
    const row=collected[index],prior=collected[index-1];
    if(row.role!=='ai'||prior.role!=='ai'||row.eventType||prior.eventType||
      !core.parseGameTime(row.text)||!core.parseGameTime(prior.text)||!row.formatSource?.playerGap)continue;
    const {previousId,currentId,previous,current,markers,loading}=row.formatSource.playerGap;
    if(previous==='character'&&current==='character'&&previousId&&currentId&&previousId!==currentId&&
       previousId===prior.formatSource?.nativeReply?.messageId&&currentId===row.formatSource.nativeReply?.messageId&&
       !markers.length&&!loading){
     row.autoContinue=true;
     continuedPositions.push({scanIndex:index,previousId,currentId});
     continue;
    }
    unpairedReply={scanIndex:index,gameTime:core.parseGameTime(row.text).iso,
     previousTime:core.parseGameTime(prior.text).iso,previous,current,markers,loading};
    throw Error('第 '+(index+1)+' 則 Gal AI 沒有相鄰的「我」；已停在該處供核對原始訊息');
   }
   if(shot.rows.some(x=>x.text.length>25000))throw Error('訊息超長，禁止存入截斷正史');
   if(preview&&collected.length>=3){collected.length=3;break}
   if(collected.length>20000)throw Error('已達20,000則安全上限');
   if(registered&&collected.length>0&&
      (collected.length-progressLastCount>=80||
       Date.now()-progressLastAt>=120000)){
    progressLastCount=collected.length;progressLastAt=Date.now();
    // Live progress is persisted by the extension without a Chrome download.
    // A connection error must not interrupt a valid ongoing WHIF scan.
    chrome.runtime.sendMessage({type:'gal-run-progress',...run,
     scanned:collected.length}).catch(()=>{});
   }
   noProgress=info.added?0:noProgress+1;
   if(noProgress>180)throw Error('連續180次沒有新訊息，可能捲動區錯誤');
   status('掃描中：已讀 '+collected.length+' 則，步數 '+stepCount+
    '；辨識方式 '+(scanMode==='bounded'?'世界觀＋👍界線':'原泡泡辨識（備援）')+
    '。\n世界觀標頭 '+(shot.boundaryDebug?.headers??0)+'、事件標頭 '+(shot.boundaryDebug?.eventHeaders??0)+
    '、操作列（👍或✎開頭）'+(shot.boundaryDebug?.reactionBars??0)+
    '、普通回覆 '+(shot.boundaryDebug?.completeAI??0)+'、事件 '+(shot.boundaryDebug?.completeEvents??0)+'。'+
    '\n目前步距 '+stepPx+'px，'+Math.round(SCROLL_RATIO*100)+'%／'+MAX_SCROLL_PX+
    'px 上限；'+WAIT_MS+'ms＋'+STABLE_MS+'ms 等待。'+
    '\n'+(info.added?'新增 '+info.added+' 則':'前後畫面重疊')+'；尚未匯出或覆蓋。');
   if(isBottom(root)){
    bottomFrames++;
    if(bottomFrames>=3){
     const proofStarted=Date.now(),proofHeight=root.scrollHeight;
     const tailSignature=rows=>rows.slice(-8).map(row=>
      [row.formatSource?.nativeReply?.messageId||row.formatSource?.eventEvidence?.messageId||'',
       row.role,row.eventType||'',hash(row.text)].join(':')).join('|');
     const proofSignature=tailSignature(shot.rows);
     let changed=false,reason='stable';
     status('⏳ 已到目前頁面底部；等待 '+Math.round(BOTTOM_CONFIRM_MS/1000)+
      ' 秒確認 WHIF 是否仍在補載後續歷史。\n目前可信 '+collected.length+' 則，尚未匯出。');
     phaseStatus('bottom-confirm','⏳ 頁尾穩定確認：0/8 秒；已讀 '+collected.length+' 則；重試 '+bottomRetries+' 次。');
     while(Date.now()-proofStarted<BOTTOM_CONFIRM_MS){
      await sleep(BOTTOM_POLL_MS);ensureRunning();
      status('⏳ 頁尾穩定確認：'+Math.min(8,Math.floor((Date.now()-proofStarted)/1000))+'/8 秒；已讀 '+collected.length+' 則；重試 '+bottomRetries+' 次。');
      if(!root.isConnected)throw Error('底部確認期間頁面替換了原捲動容器，停止避免漏掃');
      if(root.scrollHeight!==proofHeight||!isBottom(root)){
       changed=true;reason='scroll-geometry-changed';break;
      }
      const probe=snapshot(root,scanMode,false,true);
      if(tailSignature(probe.rows)!==proofSignature){
       changed=true;reason='visible-tail-changed';break;
      }
     }
     bottomProof={stable:!changed,reason,waitedMs:Date.now()-proofStarted,
      collected:collected.length,retries:bottomRetries,initialScrollHeight:proofHeight,finalScrollHeight:root.scrollHeight};
     diagnostic={...(diagnostic||inspect()),bottomProof};
     if(!changed){phaseStatus('bottom-confirmed','✅ 頁尾已穩定 '+(bottomProof.waitedMs/1000).toFixed(2)+' 秒；開始資料驗收。');await yieldUi();break;}
     bottomRetries++;bottomFrames=0;
     status('↻ WHIF 頁尾發生變化（'+reason+'），第 '+bottomRetries+' 次重新確認；繼續掃描。');
     continue;
    }
   }else bottomFrames=0;
   if(info.added&&stepPx<nominal)stepPx=Math.min(nominal,Math.max(stepPx+12,Math.floor(stepPx*1.2)));
   const movement=await advanceScanScroll(root,stepPx);
   if(movement.reanchor){
    geometryReanchors++;
    const anchor=movement.attempts.at(-1);
    recoveryLog.push({step:stepCount,kind:'whif-scroll-height-growth-reanchor',
     scanned:collected.length,scrollTopBefore:anchor.before,scrollTopAfter:anchor.after,
     scrollHeightBefore:anchor.scrollHeightBefore,scrollHeightAfter:anchor.scrollHeightAfter});
    if(geometryReanchors>8){
     scrollStall={...movement,step:stepCount,scanned:collected.length};
     throw Error('WHIF 連續 9 次擴張捲動內容卻無法前進，已停止以防止無限循環');
    }
    // Do not accept the backwards position as progress or skip forward.
    // Resample the current viewport; appendSample must prove that it
    // overlaps the last trusted rows before any further scroll is allowed.
    bottomFrames=0;
    status('↻ WHIF 動態載入更多內容（高度 '+anchor.scrollHeightBefore+' → '+
     anchor.scrollHeightAfter+'px），捲動位置已調整；正在重新核對前後訊息。'+
     '\n已保留 '+collected.length+' 則，尚未匯出。');
    stepCount++;
    continue;
   }
   if(!movement.moved&&!movement.atBottom){
    scrollStall={...movement,step:stepCount,scanned:collected.length};
    throw Error(movement.geometryShift
     ?'WHIF 捲動位置無新內容載入卻突然倒退，為避免漏掃已停止；請提供含 scrollStall 的診斷'
     :'WHIF 捲動停滯，已重試 4 次仍無法向下移動，也尚未確認到底；請提供含 scrollStall 的診斷');
   }
   if(movement.moved)geometryReanchors=0;
   stepCount++;
  }
  if(cancelled)throw Error('使用者停止掃描');
  if(paused)throw Error('掃描已暫停。請返回輪迴開場重新開始，避免匯出半份正史。');
  if(stepCount>=12000)throw Error('未確認掃描到底，達到安全上限');
  phaseStatus('integrity','🔎 完整性檢查中：'+collected.length+' 則。');await yieldUi();ensureRunning();
  const validation=core.validate(collected,target.worldName);
  failedValidation=validation;
  if(preview){
   // A 3-item count alone does not prove opening/me/AI pairing. Keep
   // source-bound IDs out of the downloadable diagnostic; retain only
   // structure, clock parsing, safe header facts and validator messages.
   const rowFacts=collected.map((row,index)=>{
    const parsed=core.parseGameTime(row.text);
    const visible=core.clean(row.text);
    const firstLine=visible.split('\n').find(Boolean)||'';
    const native=row.formatSource?.nativeReply;
    return {index,role:row.role,eventType:row.eventType||null,
     characters:visible.length,firstLineLength:firstLine.length,
     beginsWithDateStatus:/^[｜|│]\s*(?:\d{4}年|\d{4}[-/]|日期不詳)/u.test(firstLine)||parsed?.profile==='adventure',
     explicitUnknownTime:core.isExplicitUnknownGameTime(row.text),
     clock:parsed?.iso||null,
     acceptedOpening:index===0?core.isAllowedOpeningRow(row):null,
     verifiedUntimedNative:index>0&&row.role==='ai'?validation.messages.some(m=>m.scanIndex===index&&m.verifiedUntimedNative===true):false,
     nativeSourceFound:native?.reason==='available',
     nativeMarkerCount:Number.isInteger(native?.markerCount)?native.markerCount:null};
   });
   diagnostic={...(diagnostic||{}),openingPreviewStructure:{
    collected:collected.length,rowRoles:rowFacts.map(row=>row.role).join(' → '),
    rows:rowFacts,pairs:validation.pairs,events:validation.events.length,
    verifiedUntimedCount:validation.verifiedUntimedCount||0,
    validationOk:validation.ok,errors:validation.errors.slice(0,12)}};
   if(collected.length!==3||validation.pairs!==1||validation.events.length||!validation.ok){
    const reason=validation.errors.length?validation.errors.slice(0,4).join('；'):
     '本次三筆沒有形成一組開場 → 玩家 → AI 回合';
    throw Error('三則測試結構未通過（'+rowFacts.map(row=>row.role).join(' → ')+
     '；完整回合 '+validation.pairs+' 組；事件 '+validation.events.length+' 件）：'+reason);
   }
  }
  if(!validation.ok)throw Error('完整性檢查失敗：\n'+validation.errors.slice(0,12).join('\n'));
  phaseStatus('source-audit','🔎 完整性通過；正在核對玩家來源及自動繼續。');await yieldUi();ensureRunning();
  const sourceCounts=new Map();
  for(const row of collected){
   const id=row.formatSource?.nativeReply?.messageId;
   if(id)sourceCounts.set(id,(sourceCounts.get(id)||0)+1);
  }
  // For a full scan, player provenance must be verified even when there
  // are NO AI auto-continuations. Preview keeps its original lighter scope.
  autoContinueAudit=!preview&&eventAudit.history.size
   ?verifyAutoContinueAudit(collected,continuedPositions,eventAudit.history,eventAudit.senders,
    eventAudit.playerSourceRows,eventAudit.userNearby)
   :{ok:true,notApplicable:true,candidateIndices:[],observedNativeMarkers:eventAudit.history.size,
     scannedRows:collected.length};
  if(!autoContinueAudit.ok){
   const onlyUserDifference=autoContinueAudit.problems.length===1&&
    autoContinueAudit.problems[0].errors?.includes('more-observed-user-messages-than-player-rows');
   if(onlyUserDifference)
    throw Error('玩家原生來源 ID 與玩家文字掃描列相差 '+
     autoContinueAudit.playerSourceAudit.countDifference+
     '（不等於已證實漏掃），AI 自動繼續均已通過；請核對診斷 autoContinueAudit.playerSourceAudit 的多來源玩家列及未定位標記');
   throw Error('來源完整性核對未通過（'+autoContinueAudit.problems
    .map(p=>p.scanIndex??p.scope).join('、')+'）；請依診斷 autoContinueAudit 核對，不得猜測漏失訊息');
  }
  // Preserve distinct native user messages within one rendered player turn.
  // Do NOT split into unsupported me/me/ai rows. Keep every native source's
  // original whitespace/paragraphs and the exact source boundaries.
  if(autoContinueAudit?.playerSourceAudit?.safeSourceMerge){
   for(const evidence of autoContinueAudit.playerSourceAudit.multipleNativeSourceDetails){
    if(!evidence.contentProof?.ok)
     throw Error('玩家多來源保留證據不完整：scanIndex '+evidence.scanIndex);
    const row=collected[evidence.scanIndex],sources=row?.formatSource?.playerSources;
    const entry=validation.messages.find(m=>m.role==='me'&&m.scanIndex===evidence.scanIndex);
    if(!entry||sources?.length!==evidence.nativeUserSourceCount)
     throw Error('原生玩家分段與匯出列無法對應：scanIndex '+evidence.scanIndex);
    entry.text=sources.map(s=>s.nativeText).join('\n\n');
    entry.nativeUserSegments=sources.map((s,index)=>({
     position:index,sourceIdHash:hash(s.id),text:s.nativeText
    }));
   }
  }
  // The independent opening is not part of validation.messages. It must
  // have its OWN source-ID-checked native paragraph pass before serialization.
  // In particular, an untimed opening cannot rely on the AI timestamp gate.
  const openingEntry={role:'ai',text:validation.opening,scanIndex:0,
   gameTime:core.parseGameTime(validation.opening)?.iso||null};
  requireFormatEvidence();
  const aiRows=validation.messages.filter(row=>row.role==='ai');
  const totalNative=1+aiRows.length+validation.events.length;
  phaseStatus('native-format','🔎 原生格式驗收：0/'+totalNative+' 則。');await yieldUi();ensureRunning();
  const openingFormat=applyNativeFormat(openingEntry,collected,sourceCounts,scanMode,'',false,true);
  validation.opening=openingEntry.text;
  const replies=[],events=[];let checkedNative=1;
  const tickNative=async()=>{checkedNative++;if(checkedNative%8===0||checkedNative===totalNative){
   status('🔎 原生格式驗收：'+checkedNative+'/'+totalNative+' 則。');await yieldUi();ensureRunning();
  }};
  for(const [i,row] of aiRows.entries()){replies.push(applyNativeFormat(row,collected,sourceCounts,scanMode,i===0?nativeCopy:''));await tickNative();}
  paragraphCheck=replies[0].check;
  for(const row of validation.events){events.push(applyNativeFormat(row,collected,sourceCounts,scanMode,'',true));await tickNative();}
  phaseStatus('native-summary','🔎 原生格式比對完成；整理驗收結果。');await yieldUi();ensureRunning();
  showLocalDifferences([openingFormat,...replies,...events]);
  const nativeApplied=paragraphCheck.reason==='applied';
  const nativeConfirmed=nativeApplied||paragraphCheck.reason==='source-matched-no-change';
  if(!nativeConfirmed&&(requireNative||nativeCopy)){
   $('gal-scan-native-copy').focus();
   throw Error(['content-mismatch','story-time-mismatch','first-reply-row-mismatch'].includes(paragraphCheck.reason)
    ?'原生文字與掃描到的首則 AI 回覆不一致，請核對或貼上完整回覆'
    :'無法讀取原生段落來源，請貼上完整首則 AI 回覆的原生複製文字');
  }
  const paragraphAudit={opening:openingFormat.check,ai:summarizeNativeFormats(replies),events:summarizeNativeFormats(events,true)};
  const nativeFormatAudit=requireFormatEvidence().summarize(collected,
   [openingFormat,...replies,...events],core,validation.ok);
  phaseStatus('serialize','📦 正在整理掃描結果及驗收證據。');await yieldUi();ensureRunning();
  lastResult=canonical(collected,validation,preview);
  lastResult.scanRunId=run.scanRunId;
  // Three-row test exports MUST include the opening's independent audit.
  // Otherwise paragraphCheck only describes the first ordinary AI reply,
  // which can misleadingly pass while opening remains flattened.
  lastResult.openingCheck=openingFormat.check;
  lastResult.paragraphAudit=paragraphAudit;
  lastResult.validation.integrityOk=validation.ok;
  lastResult.validation.nativeFormatComplete=nativeFormatAudit.nativeFormatComplete;
  lastResult.nativeFormatAudit={complete:nativeFormatAudit.nativeFormatComplete,
   checked:nativeFormatAudit.checkedNativeRows,
   verified:nativeFormatAudit.verifiedNativeRows,
   failed:nativeFormatAudit.failedNativeRows};
  if(!preview){
   lastResult.eventAudit=summarizeEventAudit(eventAudit,collected,validation,true);
  }
  const firstReply=lastResult.messages.find(row=>row.role==='ai');
  paragraphCheck.exportedBlankLines=(firstReply?.text.match(/\n[ \t]*\n/g)||[]).length;
  if(preview)lastResult.paragraphCheck=paragraphCheck;
  diagnostic={...diagnostic,scanMode,scannerVersion:SCANNER_VERSION,coreVersion:core.version,nativeParagraphsApplied:nativeApplied,bottomProof,
   openingCheck:openingFormat.check,autoContinueAudit,
   playerSourceAudit:autoContinueAudit?.playerSourceAudit||null,
   firstTimedReply:firstTimedTrace,export:{generatedAt:lastResult.generatedAt,
    firstReplyScanIndex:firstReply?.scanIndex,
    firstReplyQuotes:(firstReply?.text.match(/「/g)||[]).length,
    firstReplyBlankLines:paragraphCheck.exportedBlankLines},paragraphCheck,paragraphAudit,
   nativeFormatAudit,validationPhases:{integrity:validation.ok?'passed':'failed',
    nativeFormatting:nativeFormatAudit.nativeFormatComplete?'passed':'failed'},
   eventAudit:lastResult.eventAudit};
  Object.assign(diagnostic,run);
  // Structural success alone MUST NOT be reported as all validations passing.
  // Keep diagnostic + unverified full evidence, but never emit canonical
  // history while ANY opening, AI or accepted-event native format is unproven.
  if(!preview&&!nativeFormatAudit.nativeFormatComplete){
   const failed=nativeFormatAudit.failures.map(x=>x.scanIndex);
   lastResult=null;exportButton.disabled=true;
   throw Error('完整性檢查通過，但原生格式驗收未通過：'+
    failed.length+' 則（scanIndex '+failed.slice(0,12).join('、')+
    '）。已保存完整原文／DOM／來源 ID／標記位置與相鄰訊息，禁止輸出正式正史。');
  }
  if((!managed||nativeFormatAudit.nativeFormatComplete)&&$('gal-scan-export'))$('gal-scan-export').disabled=false;
  phaseStatus('download','📥 驗收通過，正在排隊提交 Chrome 下載。');await yieldUi();ensureRunning();
  status(managed?'驗收通過；正在排隊提交 Chrome 下載並等待寫入確認。':preview?'✅ 三則測試完成：世界觀開場 × 1、我 × 1、他 × 1。\n'+
   (nativeApplied?'已採用原生文字的分段。':nativeConfirmed?'分段與原生來源相同。':'本次僅使用頁面 DOM。段落驗收請用「用原生來源驗收三則」。')+
   '\n開場原生段落：'+openingFormat.check.reason+'（空白分段 '+openingFormat.check.exportedBlankLines+'）'+
   '\n首則 AI 回覆的段落空行：'+paragraphCheck.exportedBlankLines+'。可下載測試 JSON。':
   '✅ 已掃描完畢，未修改正史。\n開場：'+validation.opening.length+'字（原生段落 '+openingFormat.check.reason+'），完整回合：'+validation.pairs+
   '組，事件：'+validation.events.length+'件。'+(recoveryLog.length?'\n曾縮小步距修復 '+recoveryLog.length+' 次。':'')+
   '\nAI 原生分段套用 '+paragraphAudit.ai.applied+'／'+paragraphAudit.ai.total+
   '，與來源相同 '+paragraphAudit.ai.matchedWithoutChange+'，保留 DOM '+paragraphAudit.ai.fallback+'。'+
   '\n已核對自動繼續 '+validation.autoContinues+' 次。'+
   '\n整輪事件標頭候選 '+lastResult.eventAudit.headerCandidates+
   '，待查已接取事件 '+lastResult.eventAudit.unresolvedAccepted+'。'+
   '\n請下載 JSON 後到檔案館核對並備份。');
  if(registered){
   const response=await galSendEvidence({type:'gal-run-finish',...run,state:'completed',
    scanned:collected.length,result:JSON.stringify(lastResult,null,2),diagnostic:JSON.stringify(diagnostic,null,2)});
   if(!response?.ok){
    failure=String(response?.error||'背景程式未接收掃描結果');
    status('⚠ 掃描與正史驗收已完成，但輸出傳輸失敗：'+failure+'\n請按「下載原生正史 JSON」重試原批次，勿重載頁面。');
    return {ok:false,error:failure,scanValidated:true,pairs:lastResult.validation.pairs};
   }
   if(response.status?.state==='failed'||response.status?.state==='cancelled'){
    status('⚠ 掃描與正史驗證已完成，但背景工作狀態為 '+
     response.status.state+'。請按「下載原生正史 JSON」保全本頁完成結果，再用診斷核對；不要重載頁面。');
   }
  }
 }catch(err){
  failure=String(err?.message||err);
  const failedPhase=phase;
  phaseStatus('failure','⛔ '+failure+'\n可信訊息 '+collected.length+' 則；正在保全診斷。');await yieldUi();
  const scrollAtFailure=root?.isConnected?{
   scrollTop:root.scrollTop,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight}:null;
  if(root?.isConnected)root.scrollTop=lastGoodY;
  lastFailureIndices=(failedValidation?.errors||[]).map(text=>{
   const match=String(text).match(/第\s*(\d+)\s*則/);
   return match?Number(match[1])-1:null;
  }).filter(Number.isInteger);
  diagnostic={...(diagnostic||inspect()),...run,scanMode,error:failure,trustedCount:collected.length,paragraphCheck,unpairedReply,bottomProof,
   scrollStall,scrollAtFailure,
   autoContinueCandidates:continuedPositions.map(({scanIndex})=>scanIndex),autoContinueAudit,
   playerSourceAudit:autoContinueAudit?.playerSourceAudit||null,
   eventAudit:summarizeEventAudit(eventAudit,collected,
    failedValidation||{messages:[],events:[]},false),
   recoveryLog:recoveryLog.slice(-12),lastTrustedScrollTop:lastGoodY};
  diagnostic.scannerVersion=SCANNER_VERSION;diagnostic.coreVersion=core.version;
  diagnostic.historySourceManifest=[...eventAudit.history].map(([id,kind])=>({id,kind,sender:eventAudit.senders.get(id)||null,playerRows:[...(eventAudit.playerSourceRows.get(id)||[])].sort((a,b)=>a-b)}));
  diagnostic.failedPhase=failedPhase;
  diagnostic.phaseHistory=phaseHistory;
  try{Object.assign(diagnostic,failureContexts(collected,failedValidation,failure))}
  catch(error){diagnostic.errorContexts=[{scanIndex:null,error:failure}];diagnostic.errorContextEvidence=null;diagnostic.contextError=String(error)}
  if(!diagnostic.nativeFormatAudit&&collected.length){
   try{diagnostic.nativeFormatAudit=requireFormatEvidence().inspectRaw(
    collected,core,failedValidation?.ok===true);}
   catch(error){diagnostic.nativeFormatAudit={nativeFormatComplete:false,inspection:'unavailable',error:String(error)};}
  }
  diagnostic.validationPhases={
   integrity:failedValidation?.ok===true?'passed':'failed',
   nativeFormatting:diagnostic.nativeFormatAudit?.nativeFormatComplete===true?'passed':'failed'
  };
  status((cancelled?'已取消：':paused?'已暫停：':'⛔ 安全停止：')+failure+'\n可信訊息 '+collected.length+
   ' 則，未輸出半份正史；可按「📋 複製版面診斷」。');
  if(registered){
   status('⛔ '+failure+'\n正在排隊下載失敗診斷及未驗證保全。');await yieldUi();
   const unverified=collected.length?
    JSON.stringify(unverifiedEvidence(collected,run,failure,diagnostic)):null;
   const response=await galSendEvidence({type:'gal-run-finish',...run,
    state:cancelled?'cancelled':paused?'paused':'failed',scanned:collected.length,
    reason:failure,
    unverified,
    diagnostic:JSON.stringify(diagnostic,null,2)}).catch(error=>({error:String(error)}));
   if(response?.ok){
    const files=response.status?.files||{};
    status('⚠ '+(target?.cycleTitle||'輪迴')+' 掃描未通過正式驗證，已讀 '+
     collected.length+' 則。\n'+failure+
     '\n批次：'+(run.batchFolder||'請查下載目錄')+
     '\n已完成下載：'+Object.keys(files).join('、')+
     '\n未驗證資料禁止匯入。');
   }else{
    const transportError=String(response?.error||'背景下載未確認');
    await chrome.runtime.sendMessage({type:'gal-run-export-failed',scanRunId:run.scanRunId,
     cycleId:run.cycleId,scanned:collected.length,reason:failure.slice(0,500),
     transportError:transportError.slice(0,500)}).catch(()=>{});
    status('⚠ '+failure+'\n背景保全未確認：'+transportError+
     '\n可按「保全已讀進度（不可匯入）」立即本機保存。');
   }
  }
 }finally{
  busy=false;
  // A valid in-page canonical result survives a stale background run.
  // Make the local export control available even when browser downloads
  // have timed out, without changing the archive or Firebase.
  if(lastResult?.validation?.ok&&lastResult.validation.nativeFormatComplete===true)exportButton.disabled=false;
  else exportButton.disabled=true;
 }
 return {ok:!failure,error:failure||null,pairs:lastResult?.validation?.pairs||0};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type==='gal-run-wire-pull'&&sender.id===chrome.runtime.id&&!sender.tab){
  const entry=galTransferTexts.get(msg.token);
  if(!entry||entry.field!==msg.field||entry.scanRunId!==msg.scanRunId||
     entry.cycleId!==msg.cycleId||!Number.isInteger(msg.index)||msg.index<0||
     msg.index>=Math.ceil(entry.value.length/GAL_WIRE_CHARS)){
   respond({ok:false,error:'掃描資料分段來源或序號不符'});return false;
  }
  const text=entry.value.slice(msg.index*GAL_WIRE_CHARS,(msg.index+1)*GAL_WIRE_CHARS);
  respond({ok:true,token:msg.token,index:msg.index,text});return false;
 }
 if(msg?.type==='gal-scan-emergency-snapshot'&&sender.id===chrome.runtime.id){
  const run=activeRun,rows=activeScanRows||[];
  if(!run?.scanRunId){respond({ok:false,reason:'沒有進行中工作'});return false}
  const diag={...(diagnostic||{}),scanRunId:run.scanRunId,
   cycleId:run.cycleId,scannerVersion:SCANNER_VERSION,coreVersion:core.version,
   error:'Chrome 中斷／到期緊急保全：'+String(msg.reason||'未知'),
   trustedCount:rows.length};
  Object.assign(diag,failureContexts(rows,null,diag.error));
  galWireEnvelope({ok:true,scanRunId:run.scanRunId,cycleId:run.cycleId,scanned:rows.length,
   diagnostic:JSON.stringify(diag),
   unverified:rows.length?
    JSON.stringify(unverifiedEvidence(rows,run,diag.error,diag)):null},['diagnostic','unverified'])
   .then(({out})=>respond(out),error=>respond({ok:false,error:String(error.message||error)}));
  return true;
 }
 if(msg?.type==='gal-run-page-status'&&sender.id===chrome.runtime.id&&
    msg.status?.scanRunId===activeRun?.scanRunId){
  const result=msg.status;
  if(activeRun?.scanRunId===result.scanRunId){
   activeRun.statusPath=result.statusPath||activeRun.statusPath||null;
   activeRun.batchFolder=result.batchFolder||activeRun.batchFolder||null;
  }
  const duration=result.endedAt&&result.startedAt
   ?Math.max(0,Math.round((Date.parse(result.endedAt)-Date.parse(result.startedAt))/1000)):null;
  const files=[
   ...(result.statusPath?['掃描狀態：'+result.statusPath]:[]),
   ...Object.entries(result.files||{}).map(([kind,path])=>kind+'：'+path)
  ];
  const message=(result.state==='completed'?'✅':'⚠')+' '+(result.cycleTitle||'輪迴')+
   '｜'+(result.scope||'掃描')+'｜'+result.state+
   '\n已讀：'+(result.scanned??'未知')+' 則；耗時：'+(duration===null?'未知':duration+' 秒')+
   '\n原因：'+(result.reason||'無')+
   '\n批次資料夾：'+(result.batchFolder||'未知')+
   '\nChrome 已完成的下載：'+(files.length?'\n'+files.join('\n'):'尚無')+
   '\n正式 JSON 必須通過完整性驗收才會提供。';
  status(message);
  return false;
 }
 if(msg?.type==='gal-scan-open'){
  if(core?.version!==SCANNER_VERSION||!formatEvidenceReady()){respond({ok:false,error:'掃描器、核心或格式驗收模組缺失／版本不一致，請重新整理 Gal AI 頁面'});return false}
  const p=msg.profile||{};
  if(typeof p.cycleId!=='string'||!p.cycleId||typeof p.worldName!=='string'||!p.worldName){
   respond({ok:false,error:'這個 WHIF 聊天尚未綁定目標輪迴與世界觀'});return false;
  }
  const managerNames=Array.isArray(p.managerNames)?p.managerNames:String(p.manager||'').split(/[、，,;；\r\n]/u).map(x=>x.trim()).filter(Boolean);
  if(managerNames.length<1||managerNames.length>2||
     managerNames.some(name=>typeof name!=='string'||!name.trim()||/[、，,;；\r\n]/u.test(name))||
     new Set(managerNames.map(name=>name.trim())).size!==managerNames.length){
   respond({ok:false,error:'綁定中的副駕駛資料無效，請回擴充功能重新儲存'});return false;
  }
  if(busy){respond({ok:false,error:'掃描或取證進行中'});return false}
  const mounted=$(PANEL);
  if(mounted&&(mounted.dataset.galExtensionId!==chrome.runtime.id||mounted.dataset.galScannerVersion!==SCANNER_VERSION)){
   respond({ok:false,error:'此頁已有其他版本掃描面板'});return false;
  }
  if(msg.anchorInputs){
   const a=msg.anchorInputs;
   if(sender.id!==chrome.runtime.id||Object.keys(a).some(k=>!['id','y','height','clock','neighbors'].includes(k))||
    ['id','y','height','clock','neighbors'].some(k=>typeof a[k]!=='string')||
    !/^[A-Za-z0-9_-]{5,100}$/.test(a.id)||!a.y.trim()||!Number.isFinite(Number(a.y))||Number(a.y)<0||
    (a.height&&(!Number.isFinite(Number(a.height))||Number(a.height)<=0))||
    a.clock.length>24||(a.clock&&anchorHintTime(a.clock)===null)||a.neighbors.length>2000||
    a.neighbors.trim().split(/\s+/u).filter(Boolean).length>24||
    a.neighbors.trim().split(/\s+/u).filter(Boolean).some(id=>!/^[A-Za-z0-9_-]{5,100}$/.test(id))){
    respond({ok:false,error:'錨點取證欄位不合法'});return false;
   }
  }
  target={uid:String(p.uid||''),worldName:p.worldName,cycleId:p.cycleId,
    cycleTitle:String(p.cycleTitle||''),managerNames:managerNames.map(name=>name.trim())};
  mount();
  if(msg.anchorInputs){
   const a=msg.anchorInputs;
   for(const [key,id] of Object.entries({id:'gal-anchor-id',y:'gal-anchor-y',height:'gal-anchor-height',clock:'gal-anchor-clock',neighbors:'gal-anchor-neighbors'}))$(id).value=a[key];
   $('gal-anchor-tools').open=true;
   anchorRecoveryProbe().catch(error=>{busy=false;status('錨點復原取證失敗：'+String(error?.message||error))});
   respond({ok:true,opened:true,anchorStarted:true});return false;
  }
  status('✅ 已從 WHIF 頁面開啟掃描助手。\n目標：'+target.worldName+'／'+(target.cycleTitle||target.cycleId)+
   '\n尚未開始掃描；Browser Use 可直接操作本頁助手。');
  respond({ok:true,opened:true});return false;
 }
 if(msg?.type==='gal-scan-ping'){respond({ok:true,version:SCANNER_VERSION,coreVersion:core?.version,formatEvidenceVersion:globalThis.GalArchiveFormatEvidence?.version||null,formatEvidenceReady:formatEvidenceReady(),busy,hasResult:!!lastResult,
  scanRunId:activeRun?.scanRunId||null});return false}
 if(msg?.type==='gal-scan-event-probe'){
  if(busy){respond({ok:false,error:'掃描進行中'});return false}
  if(core?.version!==SCANNER_VERSION||!formatEvidenceReady()){respond({ok:false,error:'掃描器、核心或格式驗收模組缺失／版本不一致，請重新整理 Gal AI 頁面'});return false}
  const p=msg.profile||{};
  if(typeof p.cycleId!=='string'||!p.cycleId||typeof p.worldName!=='string'||!p.worldName){
   respond({ok:false,error:'必須先選擇目標輪迴與世界觀'});return false;
  }
  const managerNames=Array.isArray(p.managerNames)?p.managerNames:[p.manager];
  if(managerNames.length<1||managerNames.length>2||
     managerNames.some(name=>typeof name!=='string'||!name.trim()||/[、，,;；\r\n]/u.test(name))||
     new Set(managerNames.map(name=>name.trim())).size!==managerNames.length){
   respond({ok:false,error:'必須先儲存 1 至 2 位不同的副駕駛'});return false;
  }
  eventThreeRowProbe({uid:String(p.uid||''),worldName:p.worldName,cycleId:p.cycleId,
    cycleTitle:String(p.cycleTitle||''),managerNames:managerNames.map(name=>name.trim())});
  respond({ok:true,started:true,mode:'event-three-row-preview'});return false;
 }
 if(msg?.type==='gal-scan-start'){
  if(busy){respond({ok:false,error:'掃描進行中'});return false}
  if(core?.version!==SCANNER_VERSION||!formatEvidenceReady()){respond({ok:false,error:'掃描器、核心或格式驗收模組缺失／版本不一致，請重新整理 Gal AI 頁面'});return false}
  const p=msg.profile||{};
  if(typeof p.cycleId!=='string'||!p.cycleId||typeof p.worldName!=='string'||!p.worldName){
   respond({ok:false,error:'必須先選擇目標輪迴與世界觀'});return false;
  }
  const managerNames=Array.isArray(p.managerNames)?p.managerNames:[p.manager];
  if(managerNames.length<1||managerNames.length>2||
     managerNames.some(name=>typeof name!=='string'||!name.trim()||/[、，,;；\r\n]/u.test(name))||
     new Set(managerNames.map(name=>name.trim())).size!==managerNames.length){
   respond({ok:false,error:'必須先儲存 1 至 2 位不同的副駕駛'});return false;
  }
  const scanRunId=crypto.randomUUID();
  scan({uid:String(p.uid||''),worldName:p.worldName,cycleId:p.cycleId,
    cycleTitle:String(p.cycleTitle||''),managerNames:managerNames.map(name=>name.trim())},msg.preview===true,false,scanRunId);
  respond({ok:true,started:true,scanRunId});return false;
 }
 return false;
});
globalThis.GalArchivePageScanner={scan,eventThreeRowProbe,version:SCANNER_VERSION};
})();