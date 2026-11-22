/* Independent Gal AI page scanner. Only loads on a user-selected active tab. v0.7.1 */
(() => {
'use strict';
if(globalThis.GalArchivePageScanner)return;
const core=globalThis.GalArchiveCore;
if(!core)throw Error('Gal AI scanner requires gal-core.js');
const STOP='gal-scanner-stop',STYLE='gal-scanner-style',PANEL='gal-scanner-panel';
const SCROLL_RATIO=.20,MAX_SCROLL_PX=350,WAIT_MS=400,STABLE_MS=350;
let busy=false,cancelled=false,lastResult=null,target=null,calibration=null,picking=false,diagnostic=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const $=id=>document.getElementById(id);
function mount(){
 if($(PANEL))return $(PANEL);
 const css=document.createElement('style');css.id=STYLE;css.textContent=
  '#'+PANEL+'{position:fixed!important;z-index:2147483646!important;right:12px!important;top:12px!important;width:min(390px,calc(100vw - 24px))!important;max-height:75vh!important;overflow:auto!important;padding:14px!important;border-radius:13px!important;background:#132039!important;color:#f7eaff!important;font:13px/1.5 system-ui!important;box-shadow:0 10px 50px #000a!important;border:1px solid #9574d2!important;text-align:left!important}'+
  '#'+PANEL+' button{font:inherit;padding:7px 9px;margin:4px;border:1px solid #a28adf;background:#5a468c;color:white;border-radius:7px;cursor:pointer}'+
  '#'+PANEL+' button:disabled{opacity:.5}#'+PANEL+' pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}';
 document.documentElement.append(css);
 const p=document.createElement('aside');p.id=PANEL;p.setAttribute('role','status');
 p.innerHTML='<strong>📚 Gal AI 原生正史掃描器 V0.7.1</strong>'+
 '<div id="gal-scan-info" style="white-space:pre-wrap;margin:9px 0">準備中…</div>'+
 '<div><button id="gal-scan-export" disabled>下載原生正史 JSON</button>'+
 '<button id="gal-scan-pick">🎯 點選開場校準</button><button id="gal-scan-retry">🔁 重新掃描</button></div>'+
 '<div><button id="gal-scan-diagnostics">📋 複製版面診斷</button><button id="gal-scan-cancel">停止掃描</button><button id="gal-scan-close">關閉</button></div>';
 document.documentElement.append(p);
 $('gal-scan-cancel').onclick=()=>{cancelled=true;status('已要求停止。未下載、未修改任何歸檔資料。')};
 $('gal-scan-pick').onclick=()=>chooseOpening();
 $('gal-scan-retry').onclick=()=>{if(!busy&&target)scan(target);else status('請先從擴充功能設定輪迴，或等目前掃描結束')};
 $('gal-scan-diagnostics').onclick=()=>{const report=diagnostic||inspect();
   const sanitized=JSON.stringify(report,null,2);
   if(navigator.clipboard?.writeText){navigator.clipboard.writeText(sanitized).then(()=>status('已複製版面診斷（僅 DOM 類別／數量，不包含對話原文）：\n'+sanitized)).catch(()=>status(sanitized))}
   else status(sanitized)};
 $('gal-scan-close').onclick=()=>{if(busy)cancelled=true;p.remove();css.remove()};
 $('gal-scan-export').onclick=()=>{if(!lastResult||!lastResult.validation?.ok)return;
   const a=document.createElement('a');
   const blob=new Blob([JSON.stringify(lastResult,null,2)],{type:'application/json;charset=utf-8'});
   a.href=URL.createObjectURL(blob);
   a.download='Gal_AI_原生正史_'+(target?.cycleTitle||'輪迴').replace(/[\\/:*?"<>|]/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.json';
   document.documentElement.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
   status('已請瀏覽器下載原生正史 JSON。這一步不會修改檔案館或 Firebase；請到輪迴檔案館「Gal AI 原生匯入」核對後套用。');
 };
 return p;
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
 // Scan generic *blocks* rather than the old site-specific message classes.
 // Select block containers with enough readable text; choose leaf-ish message wrappers.
 const all=[...root.querySelectorAll('article,li,[role="listitem"],[role="article"],[class*="bubble"],[class*="Bubble"],p,div,section')];
 const pool=all.filter(node=>{
  if(!isVisible(node,root)||node.matches('button,input,textarea,[role="toolbar"],nav,header,footer'))return false;
  const text=core.clean(node.innerText||'');
  if(text.length<8||text.length>25000)return false;
  if(!roleOf(node,root))return false;
  const bigChildren=[...node.children].filter(c=>core.clean(c.innerText||'').length>8&&isVisible(c,root));
  // Reject parents that clearly contain several independent conversation bubbles.
  return bigChildren.length<3||node.matches('article,li,[role="article"],[role="listitem"]');
 });
 return pool.filter(node=>!pool.some(child=>child!==node&&node.contains(child)));
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
 let out=byRole.filter(n=>!byRole.some(ch=>ch!==n&&n.contains(ch)));
 if(!out.length)out=genericRows(root);
 if(calibration?.node?.isConnected){
  const picked=calibratedRows(root);
  const merged=new Set([...picked,...out]);
  out=[...merged].filter(n=>!out.some(ch=>ch!==n&&n.contains(ch)&&ch!==calibration.node));
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
  version:'0.7.1',pageOrigin:location.origin,
  root:{tag:root.tagName,className:String(root.className||'').slice(0,150),
    scrollTop:root.scrollTop,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight,
    width:Math.round(r.width),height:Math.round(r.height)},
  scrollableCount:candidates.length,
  scrollableSample:candidates.slice(0,5).map(n=>({tag:n.tagName,cls:String(n.className||'').slice(0,90),
    sh:n.scrollHeight,ch:n.clientHeight,w:Math.round(n.getBoundingClientRect().width)})),
  knownSelectors:common.length,
  genericCandidates:genericRows(root).length,
  recognizedRows:candidateRows(root).length,
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
  const semantic=/message|bubble|reply|chat|turn|response/i.test(String(n.className||''));
  const score=(siblings.length?28:0)+(semantic?14:0)+(r.width>250?3:0)
    +(r.height>55?5:0)+Math.min(t.length/1000,6)
    -(parent===document.body?60:0);
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
function messageText(node){
 // Prefer the rendered message body; remove menu/action chrome from copy.
 const body=node.querySelector('[data-message-content],[data-testid*="message-content"],.markdown,.prose,.message-content,.bubble-content')
  ||node;
 return core.markdownFromDom(body).replace(/\n(?:複製訊息|編輯訊息|新增書籤|點讚|點踩)\s*$/gm,'').trim();
}
function snapshot(){
 const root=scroller(),rs=candidateRows(root);
 return {root,rows:rs.map(({node,role,rect})=>{
  const text=messageText(node);
  const id=node.getAttribute('data-message-id')||node.getAttribute('data-id')||node.getAttribute('data-testid')||'';
  return {role,text,id,top:rect.top};
 }).filter(r=>r.text.length>5),method:rs.length?'message-dom':'no-message-container'};
}
/* Repeated literal text is common ("嗯", "..."). Never globally deduplicate
 * by text: merge overlapping windows as an ORDERED sequence instead. */
function sameRow(a,b){return a.role===b.role&&(a.id&&b.id&&a.id===b.id||a.text===b.text)}
function appendSample(sample,all){
 const incoming=sample.rows.map(r=>({role:r.role,text:r.text,domId:r.id||null,id:r.id||null}));
 if(!incoming.length)throw Error('當前視窗沒有可比對的訊息');
 if(all.length===0){all.push(...incoming.map(({id,...rest})=>rest));return {repeated:0,added:incoming.length}}
 let overlap=0;
 for(let k=Math.min(incoming.length,all.length);k>=1;k--){
  if(incoming.slice(0,k).every((entry,i)=>sameRow(entry,all[all.length-k+i]))){overlap=k;break}
 }
 if(!overlap)throw Error('目前畫面與上一視窗無法找到順序重疊，已停止以免漏掉對話');
 if(overlap===1){
  const last=all[all.length-1],first=incoming[0];
  if(!last.domId&&!first.domId&&all.filter(x=>sameRow(x,last)).length>1)
   throw Error('重複短句造成單則重疊位置不唯一；無穩定 DOM ID，拒絕可能漏掃的歸檔');
 }
 const extra=incoming.slice(overlap).map(({id,...rest})=>rest);
 all.push(...extra);
 return {repeated:overlap,added:extra.length};
}
function isBottom(root){
 const y=root===document.scrollingElement||root===document.documentElement?root.scrollTop:root.scrollTop;
 return y+root.clientHeight>=root.scrollHeight-5;
}
function hash(str){let h1=2166136261,h2=0x811c9dc5;for(let i=0;i<str.length;i++){
 h1=Math.imul(h1^str.charCodeAt(i),16777619)>>>0;h2=Math.imul(h2^str.charCodeAt(i),2246822519)>>>0;
 }return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');}
function canonical(rows,valid){
 const path=location.origin+location.pathname;
 const chatKey=(hash(path)+hash(path+'|Gal AI')).slice(0,32);
 const build=(entry,i,kind)=>({
  id:'galnative-'+hash(path+'|'+i+'|'+kind+'|'+entry.text),
  role:entry.role,text:entry.text,gameTime:entry.gameTime||null,
  sourceEventId:'galnative-'+hash(path+'|'+i+'|'+kind),
  sourcePartIndex:0,chatKey,messageOrder:i,
  sourceKind:'gal-ai-native',sourceSite:location.origin
 });
 const messages=valid.messages.map((m,i)=>build(m,i,'message'));
 const events=valid.events.map((e,i)=>({...build(e,e.scanIndex,'event'),role:'me',
  status:'pending',title:e.title,worldName:e.worldName||null,scanIndex:e.scanIndex}));
 return {
  format:'gal-ai-authoritative-scan',version:1,generatedAt:new Date().toISOString(),
  scope:'entire-opening-to-bottom',source:{url:location.origin+location.pathname,origin:location.origin,
    path:location.pathname,gameClockOnly:true},target:{cycleId:target.cycleId,worldName:target.worldName,
    cycleTitle:target.cycleTitle,uid:target.uid||'',manager:target.manager||''},
  opening:valid.opening,messages,events,validation:{ok:valid.ok,pairs:valid.pairs,events:events.length,
    openingChars:valid.opening.length,gameTimeCount:messages.filter(m=>!!m.gameTime).length,
    warnings:valid.warnings,errors:valid.errors},rawRows:rows.length,
  readOnlyUntilImported:true,note:'原生來源對完整對話及事件具有優先權；不會更動副駕駛聊天、世界觀或補充筆記。覆蓋前需在檔案館確認備份。'
 };
}
async function scan(profile){
 if(busy)return {ok:false,error:'Gal AI 掃描已經在進行'};
 busy=true;cancelled=false;lastResult=null;target=profile;mount();
 if($('gal-scan-export'))$('gal-scan-export').disabled=true;
 const collected=[];
 let bottomFrames=0,stepCount=0,failure='';
 try {
  const first=snapshot();
  diagnostic=inspect();
  if(!first.rows.length){diagnostic=inspect();throw Error('目前找不到可辨識的訊息泡泡。請按「🎯 點選開場校準」選取左側第一則正文，再按「🔁 重新掃描」；若仍失敗，按「📋 複製版面診斷」。已辨識候選：'+diagnostic.recognizedRows+'。')}
  if(first.rows[0].role!=='ai'||core.parseGameTime(first.rows[0].text))
   throw Error('目前畫面第一則不是「左側無時間的開場」。請先捲到輪迴開場，從那裡開始，不能用中途片段覆蓋全部正史。');
  while(!cancelled&&stepCount<5000){
   const shot=snapshot();
   if(!shot.rows.length)throw Error('第 '+stepCount+' 步找不到訊息泡泡，停止以免漏掉正史');
   const info=appendSample(shot,collected);
   if(shot.rows.some(row=>row.text.length>25000))
    throw Error('單則訊息超過25,000字，請不要將截斷版本當正史');
   if(collected.length>20000)throw Error('已掃超過20,000則，為避免異常終止');
   const root=shot.root;
   status('掃描中：已收取 '+collected.length+' 則，步數 '+stepCount+'。'
    +'\n捲動：每步20%（最多350px），400ms等待＋固定350ms穩定。'
    +'\n目前 '+(info.added?'新增 '+info.added+' 則':'與前一畫面重疊')+'。'
    +'\n⚠ 不開啟時間選單／不點展開；只讀取遊戲回覆中的時間。');
   if(isBottom(root)){bottomFrames++;if(bottomFrames>=3)break}
   else bottomFrames=0;
   const before=root.scrollTop;
   root.scrollTop=Math.min(root.scrollTop+Math.max(45,Math.min(MAX_SCROLL_PX,Math.floor(root.clientHeight*SCROLL_RATIO))),root.scrollHeight);
   await sleep(WAIT_MS);await sleep(STABLE_MS);
   if(root.scrollTop===before&&!isBottom(root))throw Error('畫面無法向下捲動，可能選到錯誤捲動容器');
   stepCount++;
  }
  if(cancelled)throw Error('使用者停止掃描，未產生可匯入檔案');
  if(stepCount>=5000)throw Error('捲動步數達上限，未確認掃描到底');
  const validation=core.validate(collected,target.worldName);
  if(!validation.ok)throw Error('完整性驗證不通過：\n'+validation.errors.slice(0,12).join('\n'));
  lastResult=canonical(collected,validation);
  if($('gal-scan-export'))$('gal-scan-export').disabled=false;
  status('✅ 掃描完成，**尚未修改任何正史**。'
    +'\n開場：'+validation.opening.length+'字'
    +'\n「我／他」完整回合：'+validation.pairs+'組，劇情訊息：'+lastResult.messages.length+'則'
    +'\n事件：'+validation.events.length+'件（新事件預設待接取；匯入時保留舊事件已接取狀態）'
    +'\n劇情時間：完全取自 Gal AI 回覆；玩家共用同回合時間。'
    +(validation.warnings.length?'\n需核對：'+validation.warnings.slice(0,5).join('；'):'')
    +'\n按「下載原生正史 JSON」，再到檔案館確認有優先權的覆蓋。');
 }catch(err){failure=String(err?.message||err);status('⛔ 已停止：'+failure+'\n沒有改動輪迴正史，沒有上傳半份資料。');}
 finally{busy=false}
 return {ok:!failure,error:failure||null,pairs:lastResult?.validation?.pairs||0};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type==='gal-scan-ping'){respond({ok:true,version:'0.7.1',busy,hasResult:!!lastResult});return false}
 if(msg?.type==='gal-scan-start'){
  if(busy){respond({ok:false,error:'掃描進行中'});return false}
  const p=msg.profile||{};
  if(typeof p.cycleId!=='string'||!p.cycleId||typeof p.worldName!=='string'||!p.worldName){
   respond({ok:false,error:'必須先選擇目標輪迴與世界觀'});return false;
  }
  scan({uid:String(p.uid||''),worldName:p.worldName,cycleId:p.cycleId,
    cycleTitle:String(p.cycleTitle||''),manager:String(p.manager||'')});
  respond({ok:true,started:true});return false;
 }
 return false;
});
globalThis.GalArchivePageScanner={scan,version:'0.7.1'};
})();
