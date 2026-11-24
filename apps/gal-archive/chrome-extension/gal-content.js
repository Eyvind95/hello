/* Independent Gal AI page scanner. v0.8.38: native user-source-to-player-gap forensics; never infer missing player turns from count difference. */
(() => {
'use strict';
if(globalThis.GalArchivePageScanner)return;
const SCANNER_VERSION='0.8.38';
const core=globalThis.GalArchiveCore;
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
 if(requested?.cycleId&&requested.cycleId!==bound.cycleId)
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
  status('✅ 已重新讀取這個 WHIF 聊天的輪迴綁定：'+(target.cycleTitle||target.cycleId)+
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
 p.innerHTML='<strong>📚 Gal AI 原生正史掃描器 V0.8.38 測試版</strong>'+
 '<div id="gal-scan-info" style="white-space:pre-wrap;margin:9px 0">準備中…</div>'+
 '<div><button id="gal-scan-export" disabled>下載原生正史 JSON</button>'+
 '<button id="gal-scan-save-progress">🧷 保全已讀進度（不可匯入）</button>'+
 '<div style="margin:6px 0"><label>指定索引（0 起算） <input id="gal-scan-index-input" type="number" min="0" step="1" style="width:95px"></label>'+
 '<button id="gal-scan-position-index">指定位置測試</button>'+
 '<button id="gal-scan-position-visible">測目前畫面</button>'+
 '<button id="gal-scan-position-last-error">測上次錯誤位置</button></div>'+
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
 $('gal-scan-export').onclick=()=>{if(!lastResult||!lastResult.validation?.ok)return;
   const preview=lastResult.scope==='opening-first-pair-preview';
   downloadJson(preview?'Gal_AI_三則測試_':'Gal_AI_原生正史_',lastResult);
   status(preview?'已下載三則測試 JSON，供格式驗收。':'已請瀏覽器下載原生正史 JSON。這一步不會修改檔案館或 Firebase；請到輪迴檔案館「Gal AI 原生匯入」核對後套用。');
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
  failure:why||null,eventAudit:fullDiagnostic?.eventAudit||null,
  errors:fullDiagnostic?.errorContexts||[],rows:data,
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
 const serialize=(row,index)=>{
  if(!row)return null;
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
  return {scanIndex:index,role:row.role,eventType:row.eventType||null,
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
 };
 return issues.map(({scanIndex,error,unavailableReason})=>({
  scanIndex,error,
  cascadePossible:primary!==null&&scanIndex!==null&&scanIndex>primary,
  cascadeExplanation:primary!==null&&scanIndex>primary?
   '前方第 '+(primary+1)+' 則已經失敗；本訊息配對可能是連鎖異常':null,
  unavailableReason:unavailableReason||null,
  message:scanIndex!==null&&rows[scanIndex]?serialize(rows[scanIndex],scanIndex):null,
  context:scanIndex===null?[]:
   rows.slice(Math.max(0,scanIndex-3),Math.min(rows.length,scanIndex+4))
    .map((row,j)=>serialize(row,Math.max(0,scanIndex-3)+j))
 }));
}

async function saveProgressSnapshot(){
 if(!activeScanRows?.length){
  status('目前沒有已讀掃描資料，禁止輸出空白或偽造的正史');return false;
 }
 const run=activeRun;
 const data=unverifiedEvidence(activeScanRows,run,'人工保全已讀進度',diagnostic||{});
 if(run?.scanRunId&&run?.batchFolder){
  try{
   const result=await chrome.runtime.sendMessage({type:'gal-run-manual-save',
    scanRunId:run.scanRunId,cycleId:run.cycleId,unverified:JSON.stringify(data)});
   if(result?.ok){
    status('🧷 '+(target?.cycleTitle||'輪迴')+' 已保全 '+
     activeScanRows.length+' 則。\\n'+
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
 downloadJson('Gal_AI_緊急未驗證保全_',data);
 return true;
}
function downloadJson(prefix,data){
 const a=document.createElement('a');
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 a.href=url;
 a.download=prefix+(target?.cycleTitle||'輪迴').replace(/[\\/:*?"<>|]/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.json';
 document.documentElement.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
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
function boundaryHeaders(root){
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
  candidates.push({node:n,kind});
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
function readNativeNode(node,evidenceOnly=false){
 const response='gal-archive-native-reply-response-v1';
 let source={reason:'native-reader-unavailable'};
 const receive=event=>{
  if(event.target!==node||typeof event.detail!=='string')return;
  try{
   const data=JSON.parse(event.detail);
   if(evidenceOnly&&data?.reason==='evidence'&&data.eventEvidence)source=data;
   else if(!evidenceOnly&&data?.reason==='available'&&typeof data.text==='string'&&data.text.length<=30000)source=data;
   else if(data?.reason==='message-content-unavailable')source={reason:data.reason};
  }catch{ /* An unreadable bridge response leaves the source unavailable. */ }
 };
 node.addEventListener(response,receive);
 try{node.dispatchEvent(new CustomEvent('gal-archive-native-reply-request-v1',{
  bubbles:true,detail:evidenceOnly?'event-evidence':null
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
 const text=core.markdownFromDom(holder,{role,trace,metadata,event}).trim().replace(/^(?:回到最初|前往最新訊息|前往最新消息)\s*$/gm,'').trim();
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
function nativePlayerSourcesBetween(start,end){
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
  let proof=nativePlayerTextCache.get(item.id);
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
function boundaryRead(root,traceFirst=false,captureNative=false){
 const headings=boundaryHeaders(root),tools=boundaryToolbars(root);
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
  const strips=tools.filter(t=>boundaryFollows(start,t)&&(!next||boundaryFollows(t,next)));
  if(!strips.length){
   if(eventHeadersByNode.has(start))eventHeadersByNode.get(start).reason='action-toolbar-not-found';
   debug.incompleteAI++;break;
  }
  const trace=traceFirst&&!firstTimedTrace&&heading.kind==='reply'?{}:undefined;
  const metadata=captureNative?{}:undefined;
  const end=strips[0],text=boundaryFragmentText(start,end,'ai',trace,metadata,heading.kind==='event');
  if(trace&&core.parseGameTime(text)&&!core.isEvent(text))firstTimedTrace=trace;
  if(text.length<8||text.length>25000){
   if(eventHeadersByNode.has(start))eventHeadersByNode.get(start).reason='event-body-incomplete';
   debug.incompleteAI++;break;
  }
  if(eventHeadersByNode.has(start))eventHeadersByNode.get(start).reason='serialized';
  pairs.push({start,end,text,kind:heading.kind,metadata});
 }
 for(let i=0;i<pairs.length;i++){
  const item=pairs[i];
  if(i){
   const gap=boundaryFragmentText(pairs[i-1].end,item.start,'me');
   // A complete AI event is not itself a user turn.
   // A player can answer with one character. Controls and navigation
   // labels have already been removed from this bounded DOM range.
   if(gap){
    const playerSources=captureNative?
      nativePlayerSourcesBetween(pairs[i-1].end,item.start):[];
    const playerGapHasMedia=captureNative&&playerSources.length>1?(()=>{
     const range=document.createRange();
     range.setStartAfter(pairs[i-1].end);range.setEndBefore(item.start);
     const base=range.commonAncestorContainer;
     return [...(base.querySelectorAll?.('img,video,audio,[data-attachment-id]')||[])]
      .some(node=>range.intersectsNode(node)&&
       !node.closest('#'+PANEL+',button,[role="button"],[role="toolbar"]'));
    })():false;
    rows.push({role:'me',text:gap,id:'',top:item.start.getBoundingClientRect().top-1,
     formatSource:captureNative?{playerSources,playerGapHasMedia}:undefined});
    debug.playerGaps++;
   }else if(item.metadata&&item.kind==='reply'&&pairs[i-1].kind==='reply'){
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
 const text=core.markdownFromDom(body,{role,trace,metadata,event}).replace(/\n(?:複製訊息|編輯訊息|新增書籤|點讚|點踩)\s*$/gm,'').trim();
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
  format:'gal-ai-authoritative-scan',version:1,generatedAt:new Date().toISOString(),
  scope:preview?'opening-first-pair-preview':'entire-opening-to-bottom',source:{url:location.origin+location.pathname,origin:location.origin,
    path:location.pathname,gameClockOnly:true},target:{cycleId:target.cycleId,worldName:target.worldName,
    cycleTitle:target.cycleTitle,uid:target.uid||'',manager:target.managerNames.join('、'),managerNames:target.managerNames},
  opening:valid.opening,messages,events,validation:{ok:valid.ok,pairs:valid.pairs,events:events.length,
    ...(valid.autoContinues?{autoContinues:valid.autoContinues}:{}),
    openingChars:valid.opening.length,gameTimeCount:messages.filter(m=>!!m.gameTime).length,
    unknownGameTimeCount:valid.unknownGameTimeCount||0,verifiedUntimedCount:valid.verifiedUntimedCount||0,
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
   source:nativeCopy?'native-copy':event?'whif-event-content':'whif-message-content',
   statusText:metadata?.statusText,codeBlocks:metadata?.codeBlocks,
   chapterTitle:nativeCopy?undefined:source?.chapterTitle,event,opening,
   verifiedUntimedNative:entry.verifiedUntimedNative===true,eventTitle:event?entry.title:undefined
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
   scope:'position-seven',scannerVersion:SCANNER_VERSION};
  const managed=['whif.io','www.whif.io'].includes(location.hostname);
  if(!managed)throw Error('指定位置測試僅支援正式 WHIF 分頁');
  const reg=await chrome.runtime.sendMessage({type:'gal-run-start',...run});
  if(!reg?.ok)throw Error(reg?.error||'無法建立獨立指定位置測試批次');
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
   errorContexts:failureContexts(rows,{errors:['第 '+(index+1)+' 則指定位置來源核對']},null)
  };
  const finished=await chrome.runtime.sendMessage({type:'gal-run-finish',...run,
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
    errorContexts:failureContexts(probeRows,null,message)};
   let unverified=null;
   if(probeRows.length){
    const data=unverifiedEvidence(probeRows,run,message,report);
    // The original whole-scan indices must not be replaced by slice ordinals.
    data.rows.forEach((row,i)=>{row.scanIndex=rows.indexOf(probeRows[i])});
    unverified=JSON.stringify(data);
   }
   const saved=await chrome.runtime.sendMessage({type:'gal-run-finish',...run,
    state:'failed',scanned:probeRows.length,reason:message,
    unverified,diagnostic:JSON.stringify(report)}).catch(e=>({error:String(e)}));
   status('指定位置測試失敗：'+message+'\n批次：'+(run.batchFolder||'未知')+
    '\n'+(saved?.ok?'已送出診斷與未驗證保全':'未能確認下載：'+(saved?.error||'未知')));
  }else status('指定位置測試未通過：'+message);
 }
}

async function eventThreeRowProbe(profile){
 if(busy)return {ok:false,error:'正在掃描中'};
 if(core?.version!==SCANNER_VERSION)return {ok:false,error:'掃描器與核心版本不一致，請重新整理 Gal AI 頁面'};
 busy=true;cancelled=false;paused=false;target=profile;mount();localDifferences.clear();
 const run={scanRunId:crypto.randomUUID(),cycleId:profile.cycleId,scope:'event-three',scannerVersion:SCANNER_VERSION};
 let registered=false,localRows=[];
 $('gal-scan-difference').hidden=true;$('gal-scan-difference-label').hidden=true;
 try{
  await fetchCurrentBinding(profile);
  const response=await chrome.runtime.sendMessage({type:'gal-run-start',...run});
  if(!response?.ok)throw Error(response?.error||'無法建立事件測試批次');
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
   note:'局部事件三則測試：只讀目前畫面附近的上一則 Gal AI、事件、下一則玩家回應；不匯入、不覆蓋正式正史。'
  };
  diagnostic={...diagnostic,...run,scannerVersion:SCANNER_VERSION,coreVersion:core.version,
   eventThreeRowTest:{eventTestId,selection:result.selection,
    previousAi:previousFormat.check,event:eventFormat.check,
    localDifferences:{previousAi:previousFormat.localContext||null,event:eventFormat.localContext||null}}};
  const saved=await chrome.runtime.sendMessage({type:'gal-run-finish',...run,
   state:'completed',scanned:3,result:JSON.stringify(result),
   diagnostic:JSON.stringify(diagnostic)});
  if(!saved?.ok)throw Error(saved?.error||'事件測試下載尚未完成');
  const diff=eventFormat.localContext;
  status('✅ 事件三則測試完成，不會修改正式正史。\n'+
   '上一則 Gal AI：'+previousFormat.check.reason+'\n事件：'+eventFormat.check.reason+
   '\n下一則玩家回應：已擷取'+
   (diff?'\n事件首個差異：掃描「'+diff.scanned+'」／native「'+diff.native+'」':'')+
   '\n已建立事件測試批次：'+(run.batchFolder||'未知')+
   '\n下載狀態：'+(saved.status?.state==='completed'?'已核對完成':'等待 Chrome 實際下載')+'。');
  return {ok:true,eventTestId,eventReason:eventFormat.check.reason};
 }catch(error){
  const message=String(error?.message||error);
  diagnostic={...(diagnostic||inspect()),...run,scannerVersion:SCANNER_VERSION,
   coreVersion:core.version,eventThreeRowError:message,
   errorContexts:failureContexts(localRows,null,message)};
  if(registered){
   const saved=await chrome.runtime.sendMessage({type:'gal-run-finish',...run,state:'failed',
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
 if(core?.version!==SCANNER_VERSION)return {ok:false,error:'掃描器與核心版本不一致，請重新整理 Gal AI 頁面'};
 const run={scanRunId,cycleId:profile.cycleId,scope:preview?'preview':'full'};
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
 const recoveryLog=[];
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
   const response=await chrome.runtime.sendMessage({type:'gal-run-start',...run,
    scannerVersion:SCANNER_VERSION});
   if(!response?.ok)throw Error(response?.error||'背景程式未登記掃描工作');
   run.batchFolder=response.status?.batchFolder||null;
   run.statusPath=response.status?.statusPath||null;
   registered=true;
  }
  const first=snapshot();diagnostic=inspect();
  if(!first.rows.length)throw Error('找不到完整訊息。世界觀界線與舊版泡泡辨識都沒有結果；請複製版面診斷。');
  scanMode=first.method==='world-header-reaction-bar'?'bounded':'legacy';
  if(!core.isAllowedOpeningRow(first.rows[0]))
   throw Error('第一則不是左側輪迴開場：只有無時間開場或 2026年8月22日 18:42 的舊式開場可通過');
  root=first.root;lastGoodY=root.scrollTop;
  const nominal=Math.max(12,Math.min(MAX_SCROLL_PX,Math.floor(root.clientHeight*SCROLL_RATIO)));
  stepPx=nominal;
  while(!cancelled&&!paused&&stepCount<12000){
   if(!root.isConnected)throw Error('頁面替換了原捲動容器，為避免漏掃已停止');
   const shot=snapshot(root,scanMode,!firstTimedTrace,true);
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
    root.scrollTop=lastGoodY;
    await sleep(WAIT_MS+STABLE_MS);
    if(Math.abs(root.scrollTop-lastGoodY)>4)
     throw Error('無法退回上一可信捲動位置，拒絕猜測中間訊息');
    stepPx=Math.max(12,Math.floor(stepPx/2));
    const next=Math.min(root.scrollHeight-root.clientHeight,lastGoodY+stepPx);
    if(next<=lastGoodY)throw Error('縮小步距後無法前進，停止避免死循環');
    root.scrollTop=next;
    status('⚠ 第 '+stepCount+' 步找不到重疊訊息，已返回上個可信位置並改為 '+stepPx+
     'px 微捲動（重試 '+recovery+'/9）。目前保留 '+collected.length+' 則。');
    await sleep(WAIT_MS+STABLE_MS);
    continue;
   }
   observeEventAudit(eventAudit,shot,collected,info);
   recovery=0;lastGoodY=root.scrollTop;
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
    // This updates one status file in the same batch. A connection error
    // must not interrupt a valid ongoing WHIF scan.
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
      row.formatSource?.nativeReply?.messageId||row.formatSource?.eventEvidence?.messageId||
      row.role+'|'+hash(row.text)).join('|');
     const proofSignature=tailSignature(shot.rows);
     let changed=false,reason='stable';
     status('⏳ 已到目前頁面底部；等待 '+Math.round(BOTTOM_CONFIRM_MS/1000)+
      ' 秒確認 WHIF 是否仍在補載後續歷史。\n目前可信 '+collected.length+' 則，尚未匯出。');
     while(Date.now()-proofStarted<BOTTOM_CONFIRM_MS){
      await sleep(BOTTOM_POLL_MS);
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
      collected:collected.length,initialScrollHeight:proofHeight,finalScrollHeight:root.scrollHeight};
     diagnostic={...(diagnostic||inspect()),bottomProof};
     if(!changed)break;
     bottomFrames=0;
     status('↻ WHIF 在底部確認期間又載入了內容；繼續掃描，不判定完成。');
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
     beginsWithDateStatus:/^[｜|│]\s*(?:\d{4}年|\d{4}[-/]|日期不詳)/u.test(firstLine),
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
  const openingFormat=applyNativeFormat(openingEntry,collected,sourceCounts,scanMode,'',false,true);
  validation.opening=openingEntry.text;
  const replies=validation.messages.filter(row=>row.role==='ai').map((row,i)=>
   applyNativeFormat(row,collected,sourceCounts,scanMode,i===0?nativeCopy:''));
  paragraphCheck=replies[0].check;
  const events=validation.events.map(row=>applyNativeFormat(row,collected,sourceCounts,scanMode,'',true));
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
  lastResult=canonical(collected,validation,preview);
  lastResult.scanRunId=run.scanRunId;
  // Three-row test exports MUST include the opening's independent audit.
  // Otherwise paragraphCheck only describes the first ordinary AI reply,
  // which can misleadingly pass while opening remains flattened.
  lastResult.openingCheck=openingFormat.check;
  lastResult.paragraphAudit=paragraphAudit;
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
    firstReplyBlankLines:paragraphCheck.exportedBlankLines},paragraphCheck,paragraphAudit,eventAudit:lastResult.eventAudit};
  Object.assign(diagnostic,run);
  if(!managed&&$('gal-scan-export'))$('gal-scan-export').disabled=false;
  status(managed?'掃描資料已產生，正在等待 Chrome 完成寫入兩份 JSON。':preview?'✅ 三則測試完成：世界觀開場 × 1、我 × 1、他 × 1。\n'+
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
   const response=await chrome.runtime.sendMessage({type:'gal-run-finish',...run,state:'completed',
    scanned:collected.length,result:JSON.stringify(lastResult,null,2),diagnostic:JSON.stringify(diagnostic,null,2)});
   if(!response?.ok)throw Error(response?.error||'背景程式未接收掃描結果');
   if(response.status?.state==='failed'||response.status?.state==='cancelled'){
    status('⚠ 掃描與正史驗證已完成，但背景工作狀態為 '+
     response.status.state+'。請按「下載原生正史 JSON」保全本頁完成結果，再用診斷核對；不要重載頁面。');
   }
  }
 }catch(err){
  failure=String(err?.message||err);
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
  diagnostic.errorContexts=failureContexts(collected,failedValidation,failure);
  status((cancelled?'已取消：':paused?'已暫停：':'⛔ 安全停止：')+failure+'\n可信訊息 '+collected.length+
   ' 則，未輸出半份正史；可按「📋 複製版面診斷」。');
  if(registered){
   const unverified=collected.length?
    JSON.stringify(unverifiedEvidence(collected,run,failure,diagnostic)):null;
   const response=await chrome.runtime.sendMessage({type:'gal-run-finish',...run,
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
   }else status('⚠ '+failure+'\n背景保全未確認：'+
    (response?.error||'正在等待 Chrome 下載')+
    '\n可按「保全已讀進度（不可匯入）」立即本機保存。');
  }
 }finally{
  busy=false;
  // A valid in-page canonical result survives a stale background run.
  // Make the local export control available even when browser downloads
  // have timed out, without changing the archive or Firebase.
  if(lastResult?.validation?.ok)exportButton.disabled=false;
 }
 return {ok:!failure,error:failure||null,pairs:lastResult?.validation?.pairs||0};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type==='gal-scan-emergency-snapshot'&&sender.id===chrome.runtime.id){
  const run=activeRun,rows=activeScanRows||[];
  if(!run?.scanRunId){respond({ok:false,reason:'沒有進行中工作'});return false}
  const diag={...(diagnostic||{}),scanRunId:run.scanRunId,
   cycleId:run.cycleId,scannerVersion:SCANNER_VERSION,coreVersion:core.version,
   error:'Chrome 中斷／到期緊急保全：'+String(msg.reason||'未知'),
   trustedCount:rows.length};
  diag.errorContexts=failureContexts(rows,null,diag.error);
  respond({ok:true,scanRunId:run.scanRunId,scanned:rows.length,
   diagnostic:JSON.stringify(diag),
   unverified:rows.length?
    JSON.stringify(unverifiedEvidence(rows,run,diag.error,diag)):null});
  return false;
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
  if(core?.version!==SCANNER_VERSION){respond({ok:false,error:'掃描器與核心版本不一致，請重新整理 Gal AI 頁面'});return false}
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
  target={uid:String(p.uid||''),worldName:p.worldName,cycleId:p.cycleId,
    cycleTitle:String(p.cycleTitle||''),managerNames:managerNames.map(name=>name.trim())};
  mount();
  status('✅ 已從 WHIF 頁面開啟掃描助手。\n目標：'+(target.cycleTitle||target.cycleId)+
   '\n尚未開始掃描；Browser Use 可直接操作本頁助手。');
  respond({ok:true,opened:true});return false;
 }
 if(msg?.type==='gal-scan-ping'){respond({ok:true,version:SCANNER_VERSION,coreVersion:core?.version,busy,hasResult:!!lastResult,
  scanRunId:activeRun?.scanRunId||null});return false}
 if(msg?.type==='gal-scan-event-probe'){
  if(busy){respond({ok:false,error:'掃描進行中'});return false}
  if(core?.version!==SCANNER_VERSION){respond({ok:false,error:'掃描器與核心版本不一致，請重新整理 Gal AI 頁面'});return false}
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
  if(core?.version!==SCANNER_VERSION){respond({ok:false,error:'掃描器與核心版本不一致，請重新整理 Gal AI 頁面'});return false}
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