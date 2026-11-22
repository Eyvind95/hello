/* Independent Gal AI page scanner. Only loads on a user-selected active tab. v0.7.2 */
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
 p.innerHTML='<strong>📚 Gal AI 原生正史掃描器 V0.7.2</strong>'+
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
  version:'0.7.2',pageOrigin:location.origin,
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
function messageText(node){
 // Prefer the rendered message body; remove menu/action chrome from copy.
 const body=node.querySelector('[data-message-content],[data-testid*="message-content"],.markdown,.prose,.message-content,.bubble-content')
  ||node;
 return core.markdownFromDom(body).replace(/\n(?:複製訊息|編輯訊息|新增書籤|點讚|點踩)\s*$/gm,'').trim();
}
function snapshot(fixedRoot=null){
 const root=fixedRoot?.isConnected?fixedRoot:scroller(),rs=candidateRows(root);
 const rows=rs.map(({node,role,rect})=>{
  const text=messageText(node);
  const id=node.getAttribute('data-message-id')||node.getAttribute('data-id')||node.getAttribute('data-testid')||'';
  return {role,text,id,top:rect.top,node};
 }).filter(r=>r.text.length>5);
 const start=calibration?.node?.isConnected?rows.findIndex(r=>r.node===calibration.node):-1;
 return {root,rows:(start>=0?rows.slice(start):rows).map(({node,...rest})=>rest),
   method:rs.length?'message-dom':'no-message-container'};
}
/* Repeated literal text is common ("嗯", "..."). Never globally deduplicate
 * by text: merge overlapping windows as an ORDERED sequence instead. */
function sameRow(a,b){return a.role===b.role&&(a.id&&b.id&&a.id===b.id||a.text===b.text)}
function appendSample(sample,all){
 const incoming=sample.rows.map(r=>({role:r.role,text:r.text,domId:r.id||null,id:r.id||null}));
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
 const extra=incoming.slice(start+size).map(({id,...rest})=>rest);
 all.push(...extra);
 return {repeated:size,added:extra.length,anchorPosition:start};
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
 if(busy)return {ok:false,error:'正在掃描中'};
 busy=true;cancelled=false;lastResult=null;target=profile;mount();
 if($('gal-scan-export'))$('gal-scan-export').disabled=true;
 const collected=[];let bottomFrames=0,stepCount=0,failure='',recovery=0,root=null,lastGoodY=0,stepPx=0,noProgress=0;
 const recoveryLog=[];
 try{
  const first=snapshot();diagnostic=inspect();
  if(!first.rows.length)throw Error('找不到訊息泡泡，請按「🎯 點選開場校準」後重新掃描。');
  if(first.rows[0].role!=='ai'||core.parseGameTime(first.rows[0].text))
   throw Error('第一則不是左側無時間開場，請校準真正的開場訊息');
  root=first.root;lastGoodY=root.scrollTop;
  const nominal=Math.max(12,Math.min(MAX_SCROLL_PX,Math.floor(root.clientHeight*SCROLL_RATIO)));
  stepPx=nominal;
  while(!cancelled&&stepCount<12000){
   if(!root.isConnected)throw Error('頁面替換了原捲動容器，為避免漏掃已停止');
   const shot=snapshot(root);
   let info;
   try{info=appendSample(shot,collected)}
   catch(err){
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
   recovery=0;lastGoodY=root.scrollTop;
   if(shot.rows.some(x=>x.text.length>25000))throw Error('訊息超長，禁止存入截斷正史');
   if(collected.length>20000)throw Error('已達20,000則安全上限');
   noProgress=info.added?0:noProgress+1;
   if(noProgress>180)throw Error('連續180次沒有新訊息，可能捲動區錯誤');
   status('掃描中：已讀 '+collected.length+' 則，步數 '+stepCount+
    '。\n目前步距 '+stepPx+'px，20%／350px上限；400ms＋350ms等待。'+
    '\n'+(info.added?'新增 '+info.added+' 則':'前後畫面重疊')+'；尚未匯出或覆蓋。');
   if(isBottom(root)){bottomFrames++;if(bottomFrames>=3)break}else bottomFrames=0;
   if(info.added&&stepPx<nominal)stepPx=Math.min(nominal,Math.max(stepPx+12,Math.floor(stepPx*1.2)));
   const before=root.scrollTop;
   root.scrollTop=Math.min(root.scrollHeight-root.clientHeight,before+stepPx);
   await sleep(WAIT_MS+STABLE_MS);
   if(root.scrollTop<=before&&!isBottom(root))throw Error('畫面無法向下捲動，請複製版面診斷');
   stepCount++;
  }
  if(cancelled)throw Error('使用者停止掃描');
  if(stepCount>=12000)throw Error('未確認掃描到底，達到安全上限');
  const validation=core.validate(collected,target.worldName);
  if(!validation.ok)throw Error('完整性檢查失敗：\n'+validation.errors.slice(0,12).join('\n'));
  lastResult=canonical(collected,validation);
  if($('gal-scan-export'))$('gal-scan-export').disabled=false;
  status('✅ 已掃描完畢，未修改正史。\n開場：'+validation.opening.length+'字，完整回合：'+validation.pairs+
   '組，事件：'+validation.events.length+'件。'+(recoveryLog.length?'\n曾縮小步距修復 '+recoveryLog.length+' 次。':'')+
   '\n請下載 JSON 後到檔案館核對並備份。');
 }catch(err){
  failure=String(err?.message||err);
  if(root?.isConnected)root.scrollTop=lastGoodY;
  diagnostic={...(diagnostic||inspect()),error:failure,trustedCount:collected.length,
   recoveryLog:recoveryLog.slice(-12),lastTrustedScrollTop:lastGoodY};
  status('⛔ 安全停止：'+failure+'\n可信訊息 '+collected.length+
   ' 則，未輸出半份正史；可按「📋 複製版面診斷」。');
 }finally{busy=false}
 return {ok:!failure,error:failure||null,pairs:lastResult?.validation?.pairs||0};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type==='gal-scan-ping'){respond({ok:true,version:'0.7.2',busy,hasResult:!!lastResult});return false}
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
globalThis.GalArchivePageScanner={scan,version:'0.7.2'};
})();
