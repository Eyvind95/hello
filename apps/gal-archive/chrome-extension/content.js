'use strict';
(() => {
  if (window.__galArchiveObserverLoaded) return;
  window.__galArchiveObserverLoaded = true;

  const CHAT_PATTERN = /^\/(?:c\/[a-zA-Z0-9-]+|g\/[^/]+\/c\/[a-zA-Z0-9-]+)\/?$/;
  const USER_SELECTOR = '[class~="group/user-message"]';
  const USER_BUBBLE_SELECTOR = '[class~="bg-user-message"]';
  // Observed light-mode player bubble rgb(232, 243, 254) = #E8F3FE.
  // CSS classes are primary; this shade is supporting evidence, never a standalone role guess.
  const USER_BUBBLE_COLOR = 'rgb(232, 243, 254)';
  const AI_SELECTOR = '[data-markdown-copy="contents"]';
  const LEGACY_SELECTOR = '[data-message-author-role]';
  const path = () => location.pathname.replace(/\/$/, '');
  const valid = () => CHAT_PATTERN.test(location.pathname);

  const state = { enabled: false, watchedPath: null, previousPath: null, scanning: false, activeSends: 0, autoTime: false, timeBusy: false, bulk: null };
  const baselineIds = new Set();
  const delivered = new Set();
  const candidates = new Map();
  // Session observation is NOT the original authored timestamp.
  const firstSeenAt = new Map();
  const sourceTimeCache = new Map();
  const messageElements = new Map();
  // Fallback bodies are paired to the real turn, not a guessed "ChatGPT" phrase
  // occurring inside somebody's message.
  const assistantFallbackTexts = new WeakMap();
  // Both roles in one exchange share ONE timeline minute. This is a time
  // approximation requested by the owner, NOT proof of identical send times.



  // V0.6.6: Advisory scene-time hints only. Never rewrite ChatGPT authored times,
  // Firebase event identities, scan order, or the original payload text.
  function galArchiveHintSummary(messages){
    let storyTimeCount=0,skipCueCount=0;
    const previews=[];
    for(const m of messages){
      if(m?.role!=='me'||typeof m.text!=='string')continue;
      if(/made\s+in\s+heaven|做\s*愛\s*跳\s*過/i.test(m.text))skipCueCount++;
      const segments=m.text.replace(/\r\n?/g,'\n').split(/(?:^|\n)\s*他\s*[：:；”]\s*/u).slice(1);
      for(const segment of segments){
        const head=segment.split(/\n\s*(?:我|他)\s*[：:；”]\s*/u)[0].split('\n').slice(0,12).join('\n').slice(0,950);
        const date=head.match(/(?:^|\n)\s*[｜|│]?\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u)
          ||head.match(/(?:^|\n)\s*[｜|│]?\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?=\D|$)/u);
        const time=head.match(/(?:^|\n)\s*[｜|│]?\s*(?:⏰|⌚|🕒|[\u{1F550}-\u{1F567}]|時間\s*[：:]?)\s*(\d{1,2})\s*[：:]\s*(\d{2})(?:[.:：](\d{1,2}))?/u);
        if(!date||!time)continue;
        const [year,month,day]=date.slice(1).map(Number);
        const hour=+time[1],minute=+time[2],second=+(time[3]||0);
        if(year<100||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)continue;
        const ms=Date.UTC(year,month-1,day,hour-8,minute,second);
        const check=new Date(ms+8*3600000);
        if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month
          ||check.getUTCDate()!==day||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute)continue;
        storyTimeCount++;
        if(previews.length<3)previews.push(year+'/'+String(month).padStart(2,'0')+'/'+String(day).padStart(2,'0')
          +' '+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'));
      }
    }
    return {storyTimeCount,skipCueCount,storyTimePreview:previews.join('、')};
  }

  const diagnostics = { lastCapture: null, lastUpload: null, nodeCount: 0, userCount: 0, aiCount: 0, latest: '', enabled: false, path: '', updatedAt: 0, mode: '', error: '', timeResults: '', autoTime: false, storyTimeCount: 0, skipCueCount: 0, storyTimePreview: '' };

  // Expanded ChatGPT bubbles can expose a UI-only '顯示較少' control
  // as the final text line. Strip that standalone label, never a real '...'.
  function cleanArchiveLessTail(text) {
    const raw=String(text||'').trim();
    const cleaned=raw.replace(/(?:^|\r?\n)[ \t]*顯示較少[ \t]*$/, '').trimEnd();
    return cleaned.trim()?cleaned:raw;
  }
  function cleanText(el) {
    return (el?.innerText || '').trim();
  }
  function outerUsers() {
    // The current UI nests two group/user-message elements for every user turn.
    const direct=[...document.querySelectorAll(USER_SELECTOR)]
      .filter(el => !el.parentElement?.closest(USER_SELECTOR));
    // Some ChatGPT layouts retain the bubble class but drop the wrapper.
    // A real bubble AND a conversation-turn owner are required; the screenshot
    // color alone is never enough to classify arbitrary page elements.
    const fallback=[...document.querySelectorAll(USER_BUBBLE_SELECTOR)]
      .filter(el => !el.closest(USER_SELECTOR) && !!el.closest('[data-turn-key], [data-testid^="conversation-turn-"], [data-message-author-role="user"]'))
      .filter(el => !el.parentElement?.closest(USER_BUBBLE_SELECTOR));
    const all=[...direct,...fallback];
    return all.sort((a,b)=>{
      const cmp=a.compareDocumentPosition(b);
      return cmp & Node.DOCUMENT_POSITION_FOLLOWING?-1:cmp & Node.DOCUMENT_POSITION_PRECEDING?1:0;
    });
  }
  function isUserDescendant(el){return !!el?.closest?.(`${USER_SELECTOR}, ${USER_BUBBLE_SELECTOR}`);}
  function userText(el) {
    const inner=el.matches(USER_BUBBLE_SELECTOR)?el:el.querySelector(USER_BUBBLE_SELECTOR);
    return cleanText(inner||el);
  }
  function userId(el, index) {
    const own = el.closest('[data-turn-key]');
    // data-turn-key is a stable per-turn identifier in the observed layout.
    const turnKey = own?.getAttribute('data-turn-key');
    if (turnKey) return 'user-turn:' + turnKey;
    return 'user-position:' + index;
  }
  function aiId(el, index) {
    const id = el.querySelector('[data-dil-message-id]')?.getAttribute('data-dil-message-id')
      || el.getAttribute('data-dil-message-id')
      || el.closest('[data-source-message-id]')?.getAttribute('data-source-message-id');
    if(id)return 'ai-message:' + id;
    // Older captured Markdown messages used positional IDs; preserve those
    // identities so re-backfill does not duplicate previously accepted replies.
    // Prefer stable turn IDs before DOM positions. A virtualized chat can
    // recycle the same position for DIFFERENT assistant messages when scrolling.
    const owner=el.closest('[data-turn-key]') || el.closest('[data-testid^="conversation-turn-"]');
    const stable=owner?.getAttribute('data-turn-key') || owner?.getAttribute('data-testid');
    if(stable)return 'ai-turn:' + stable;
    return 'ai-position:' + index;
  }
  function getVisibleSourceTime(el) {
    // Explicit machine-readable timestamps only. Do not infer from display order
    // or the clock at which an older message is backfilled.
    // Only read machine timestamps from this role's own message subtree.
    // A data-turn-key may hold both user AND assistant; searching the whole
    // turn would silently attach one role's timestamp to the other.
    const scope=el;
    const node=scope.querySelector('time[datetime], [data-message-created-at], [data-created-at]');
    const raw=node?.getAttribute('datetime') || node?.getAttribute('data-message-created-at') || node?.getAttribute('data-created-at');
    if(!raw || !(/\d{4}-\d{2}-\d{2}/).test(raw))return null;
    const t=Date.parse(raw);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  function withObservedTime(m,el) {
    const k=m.role+'|'+m.id;
    if(!firstSeenAt.has(k))firstSeenAt.set(k,new Date().toISOString());
    messageElements.set(k,el);
    // A composite turn may contain *both* user and assistant. Its time node
    // must not be misassigned to the fallback assistant response.
    const direct=m.fallbackComposite?null:getVisibleSourceTime(el), cached=sourceTimeCache.get(k);
    return {...m, sourceCreatedAt:cached?.value||direct||null,
      sourceTimeOrigin:cached?.origin||(direct?'dom':null),
      sourceTimePrecision:cached?.precision||(direct?'source':null),
      capturedAt:firstSeenAt.get(k)};
  }
  // Menu timestamps are rendered as text (e.g. 今天，上午5:21) only when the
  // per-message menu is open. Read them only while the associated trigger is
  // provably the same turn. Never guess seconds or use time-of-capture as source.
  const TIME_RE = /(?:今天|昨天|前天|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)[，,\s]*[上下午凌晨中午晚上早上]*\s*\d{1,2}[:：]\d{2}/;
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  function taiwanToday() {
    const parts=Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date());
    const n=type=>Number(parts.find(p=>p.type===type)?.value);
    return {y:n('year'),m:n('month'),d:n('day')};
  }
  function parseMenuTime(label) {
    if(typeof label!=='string')return null;
    const compact=label.replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/\s+/g,'').replace(/[：]/g,':');
    let y,m,d,rest;
    const now=taiwanToday();
    const rel=compact.match(/^(今天|昨天|前天)[，,]?(.*)$/);
    const full=compact.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日[，,]?(.*)$/);
    const month=compact.match(/^(\d{1,2})月(\d{1,2})日[，,]?(.*)$/);
    if(rel){
      const diff=rel[1]==='今天'?0:rel[1]==='昨天'?1:2;
      const t=new Date(Date.UTC(now.y,now.m-1,now.d-diff,12));
      y=t.getUTCFullYear();m=t.getUTCMonth()+1;d=t.getUTCDate();rest=rel[2];
    }else if(full){y=+full[1];m=+full[2];d=+full[3];rest=full[4];}
    else if(month){y=now.y;m=+month[1];d=+month[2];rest=month[3];
      if(m>now.m||(m===now.m&&d>now.d))y--;
    }else return null;
    const tm=rest.match(/^(上午|下午|凌晨|中午|晚上|早上)?(\d{1,2}):(\d{2})$/);
    if(!tm)return null;
    const period=tm[1]||'',hh=+tm[2],mi=+tm[3];
    if(mi>59||hh>23)return null;
    if(period&&hh>12)return null;
    let hour=hh;
    if(period==='下午'||period==='晚上'||period==='中午')hour=(hh%12)+12;
    if(period==='上午'||period==='凌晨'||period==='早上')hour=hh===12?0:hh;
    const utc=Date.UTC(y,m-1,d,hour-8,mi,0);
    const check=new Date(utc+8*3600000);
    if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==m||check.getUTCDate()!==d||check.getUTCHours()!==hour)return null;
    if(utc>Date.now()+5*60000||utc<Date.now()-5*365*86400000)return null;
    return new Date(utc).toISOString(); // precise to the minute, NOT the second
  }
  function currentTimeItem() {
    const options=[...document.querySelectorAll('[role="menuitem"]')]
      .filter(e=>TIME_RE.test((e.innerText||'').trim()));
    return options.length===1?options[0]:null;
  }
  function openMenuTriggers() {
    return [...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .filter(e=>e.getAttribute('data-state')==='open'||e.getAttribute('aria-expanded')==='true');
  }
  async function waitForMenu(button,limit=750) {
    const deadline=Date.now()+limit;
    while(Date.now()<deadline){
      if(button.getAttribute('data-state')==='open'||button.getAttribute('aria-expanded')==='true')return true;
      await sleep(35);
    }
    return false;
  }
  function pointerDown(button) {
    if(typeof PointerEvent!=='undefined')button.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,cancelable:true,pointerType:'mouse',isPrimary:true,button:0,buttons:1
    }));
  }
  async function closeCapturedMenu(button) {
    const opened=openMenuTriggers().includes(button);
    if(!opened)return;
    const focused=document.activeElement;
    const target=document.querySelector('[role="menu"][data-state="open"]')||focused||button;
    target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
    await sleep(100);
    if(openMenuTriggers().includes(button))pointerDown(button);
  }
  function chooseMessageMenuTrigger(owner, m) {
    // A turn may contain several menu buttons (e.g. the user's edit menu,
    // assistant action menus or embedded tools). Never pick the first blindly.
    const all=[...owner.querySelectorAll('button[aria-haspopup="menu"]')]
      .filter(b=>b.closest('[data-turn-key]')===owner);
    if(!all.length)return {reason:'沒有找到訊息選單按鈕'};
    const isVisible=b=>b.getClientRects().length>0;
    const visible=all.filter(isVisible);
    const pool=visible.length?visible:all;
    const isMore=b=>/^(more|more options|更多|更多選項|其他選項|其他操作|⋯|\.\.\.)$/i.test(
      [b.getAttribute('aria-label'),b.getAttribute('title'),b.getAttribute('data-testid'),b.innerText]
        .filter(Boolean).join(' ').trim()
    ) || /more|更多|ellipsis/i.test(
      [b.getAttribute('aria-label'),b.getAttribute('title'),b.getAttribute('data-testid')]
        .filter(Boolean).join(' ')
    );
    const actionRows=[...owner.querySelectorAll('.turn-action-controls, [class*="turn-action-controls"]')];
    const inAction=pool.filter(b=>actionRows.some(row=>row.contains(b)));
    const narrowed=inAction.length?inAction:pool;
    // An already open trigger is the strongest available association.
    const opened=narrowed.filter(b=>b.getAttribute('data-state')==='open'||b.getAttribute('aria-expanded')==='true');
    if(opened.length===1)return {button:opened[0]};
    if(opened.length>1)return {reason:'目標回合有多個已開啟選單'};
    const more=narrowed.filter(isMore);
    if(more.length===1)return {button:more[0]};
    if(narrowed.length===1)return {button:narrowed[0]};
    // For a composite user+GPT turn, two message-action triggers appear in
    // chronological order. Prefer GPT's later trigger. Still reject 3+.
    if(narrowed.length===2 && owner.querySelector(USER_SELECTOR))
      return {button:m.role==='ai'?narrowed[1]:narrowed[0]};
    return {reason:`目標回合有 ${all.length} 個選單按鈕，無法安全辨識訊息選單（動作列 ${inAction.length} 個）`};
  }
  async function captureMenuTime(m,{preserveOpened=false}={}) {
    if(state.timeBusy)return {ok:false,reason:'正在擷取另一則'};
    const k=keyOf(m),el=messageElements.get(k),owner=el?.closest('[data-turn-key]');
    if(!owner)return {ok:false,reason:'找不到所屬回合'};
    // Composite turn is not an error: once a valid per-turn menu time is read,
    // it is shared with the paired player/GPT entry with clear provenance.
    const choice=chooseMessageMenuTrigger(owner,m);
    if(!choice.button)return {ok:false,reason:choice.reason};
    const button=choice.button;
    const previouslyOpen=openMenuTriggers();
    if(previouslyOpen.length&&!(previouslyOpen.length===1&&previouslyOpen[0]===button))return {ok:false,reason:'使用者正在操作其他選單'};
    const owned=previouslyOpen.includes(button);
    state.timeBusy=true;
    try{
      if(!owned){
        // Radix menu triggers may listen to pointerdown rather than click.
        pointerDown(button);
        if(!await waitForMenu(button,450)){
          button.click();
          if(!await waitForMenu(button,600))return {ok:false,reason:'自動打開選單失敗'};
        }
      }
      await sleep(100);
      const active=openMenuTriggers();
      if(active.length!==1||active[0]!==button)return {ok:false,reason:'無法確認開啟的是目標訊息'};
      const item=currentTimeItem();
      if(!item)return {ok:false,reason:'選單沒有可辨識的時間'};
      const text=item.innerText.trim();
      const iso=parseMenuTime(text);
      if(!iso)return {ok:false,reason:'日期格式不支援：'+text.slice(0,48)};
      // This turn key was verified with the trigger and opened menu.
      sourceTimeCache.set(k,{value:iso,origin:'menu',precision:'minute',turnKey:owner.getAttribute('data-turn-key')});
      const partner=pairForMessage(m);
      if(partner){
        const pk=keyOf(partner);
        sourceTimeCache.set(pk,{value:iso,origin:'reply-inferred',precision:'minute-estimated',
          pairedWith:k,turnKey:owner.getAttribute('data-turn-key')});
      }
      recordCapture({status:'success',role:m.role,preview:m.text.slice(0,65),sourceCreatedAt:iso,sourceTimeOrigin:'menu',sourceTimePrecision:'minute',paired:!!partner,detail:text+(partner?'；同一回合的另一方共用此分鐘（推定）':'')});
      return {ok:true,iso,text,turnKey:owner.getAttribute('data-turn-key'),preview:m.text.slice(0,65),paired:!!partner};
    }finally{
      if(!owned&&!preserveOpened)await closeCapturedMenu(button);
      state.timeBusy=false;
    }
  }
  function saveTimeEvent(globalKey,byChatKey,result){
    // Keep each conversation's latest timestamp independent from other cycles.
    const chat=result.chat;
    chrome.storage.local.get([byChatKey], data=>{
      const map=data[byChatKey]||{};
      map[chat]=result;
      const recent=Object.entries(map).sort((a,b)=>String(b[1]?.at||'').localeCompare(String(a[1]?.at||''))).slice(0,150);
      chrome.storage.local.set({[globalKey]:result,[byChatKey]:Object.fromEntries(recent)});
    });
  }
  function recordCapture(result) {
    diagnostics.lastCapture={...result,chat:path(),at:new Date().toISOString()};
    saveTimeEvent('lastTimeCapture','lastTimeCaptureByChat',diagnostics.lastCapture);
  }
  function pairedIndex(messages,index){
    if(index<0 || index>=messages.length)return -1;
    const m=messages[index];
    const j=m.role==='me'?index+1:index-1;
    if(j<0||j>=messages.length)return -1;
    const partner=messages[j];
    if(!partner || partner.role===m.role || (m.role==='me'&&partner.role!=='ai') ||
       (m.role==='ai'&&partner.role!=='me'))return -1;
    // They must be an adjacent user→assistant exchange; a shared turn owner
    // is even stronger evidence. Never pair across any intervening message.
    return j;
  }
  function sharedCapturedMinute(messages){
    // If the original date is unknown, both sides of the exchange use exactly
    // the same first-observed time for sorting; it remains capturedAt, not a
    // fictitious original message timestamp.
    for(let i=0;i<messages.length-1;i++){
      const u=messages[i],a=messages[i+1];
      if(u.role!=='me'||a.role!=='ai')continue;
      const uk=keyOf(u),ak=keyOf(a);
      const both=[Date.parse(u.capturedAt),Date.parse(a.capturedAt)].filter(Number.isFinite);
      if(both.length){
        const shared=new Date(Math.min(...both)).toISOString();
        firstSeenAt.set(uk,shared); firstSeenAt.set(ak,shared);
        u.capturedAt=shared;a.capturedAt=shared;
      }
      const uc=sourceTimeCache.get(uk),ac=sourceTimeCache.get(ak);
      // Explicit menu time > shared guess. GPT's own menu wins if both are
      // independently known; otherwise use the available side.
      const sources=[
        {role:'ai',item:ac},{role:'me',item:uc},
        {role:'ai',item:a.sourceCreatedAt?{value:a.sourceCreatedAt,origin:a.sourceTimeOrigin||'dom',precision:a.sourceTimePrecision||'source'}:null},
        {role:'me',item:u.sourceCreatedAt?{value:u.sourceCreatedAt,origin:u.sourceTimeOrigin||'dom',precision:u.sourceTimePrecision||'source'}:null}
      ].filter(x=>x.item?.value);
      sources.sort((x,y)=>{
        const grade=x=>(x.item.origin==='menu'||x.item.origin==='dom'?3:
          x.item.origin==='reply-inferred'?1:2)*10+(x.role==='ai'?1:0);
        return grade(y)-grade(x);
      });
      const chosen=sources[0];
      if(!chosen)continue;
      const item=chosen.item;
      for(const member of [u,a]){
        const k=keyOf(member);
        const same=member.role===chosen.role;
        const origin=same?item.origin:'reply-inferred';
        const precision=same?item.precision:'minute-estimated';
        const next={value:item.value,origin,precision,
          pairedWith:member.role==='me'?ak:uk};
        sourceTimeCache.set(k,next);
        member.sourceCreatedAt=next.value;member.sourceTimeOrigin=next.origin;
        member.sourceTimePrecision=next.precision;
      }
    }
    return messages;
  }
  function pairForMessage(m){
    const list=collect(),index=list.findIndex(x=>keyOf(x)===keyOf(m));
    const j=pairedIndex(list,index);
    return j>=0?list[j]:null;
  }
  // A reply may be plain Markdown, a DIL renderer, or an older assistant
  // container.  Finding one user bubble does NOT prove that all assistant
  // replies are marked with data-markdown-copy; never silently drop them.
  const AI_BODY_SELECTORS = [
    '[data-dil-message-id]',
    '[data-markdown-copy="contents"]',
    '[data-message-author-role="assistant"]',
    '[data-testid="assistant-message"]',
    '.markdown',
    '[class~="prose"]'
  ];
  const AI_CANDIDATE_SELECTOR = AI_BODY_SELECTORS.slice(0,4).join(',');
  const TURN_SELECTOR = '[data-turn-key], [data-testid^="conversation-turn-"]';
  function closestTurn(el) {
    return el.closest('[data-turn-key]') || el.closest('[data-testid^="conversation-turn-"]')
      || el.closest('[data-message-author-role="assistant"]') || el;
  }
  function isUserContainer(el) {
    return el.matches(USER_SELECTOR) || el.matches(USER_BUBBLE_SELECTOR) || !!el.querySelector(USER_SELECTOR+', '+USER_BUBBLE_SELECTOR);
  }
  function bestAssistantBody(container) {
    // Prefer a complete reply renderer over its nested individual text spans.
    // On legacy pages choose the Markdown subtree, not action buttons.
    for (const selector of AI_BODY_SELECTORS) {
      if (container.matches?.(selector)) {
        if(selector==='[data-message-author-role="assistant"]') {
          const inner=container.querySelector('[data-dil-message-id], [data-markdown-copy="contents"], .markdown, [class~="prose"]');
          return inner || container;
        }
        return container;
      }
      const candidate=container.querySelector(selector);
      if (candidate) {
        if(selector==='[data-message-author-role="assistant"]') {
          return candidate.querySelector('[data-dil-message-id], [data-markdown-copy="contents"], .markdown, [class~="prose"]') || candidate;
        }
        return candidate;
      }
    }
    return null; // Don't copy arbitrary action/control text as a GPT message.
  }
  // Some recent ChatGPT responses (especially DIL/plain text) have neither
  // data-markdown-copy nor a data-dil-message-id.  The turn, however, still
  // contains the *actual* user bubble plus assistant text later in the DOM.
  // Reconstruct the assistant part strictly from rendered text OUTSIDE the
  // user bubble. Never infer assistant status merely from the words it says.
  const FALLBACK_SKIP = 'button, [role="button"], [role="menu"], nav, footer, script, style, textarea, input, select, svg, [aria-hidden="true"], [hidden], [contenteditable="true"], .sr-only, [class*="sr-only"], .turn-action-controls, [class*="turn-action-controls"]';
  const RESPONSE_LABEL = /^(?:ChatGPT\s*(?:說|said)|你說|You said|Assistant)\s*[:：]?$/i;
  function assistantTextWithoutUser(owner, userBoundary) {
    // Only visible DOM text *after* the user bubble may count as an answer.
    // This also works when the assistant and user share one data-turn-key.
    // A different-turn fallback is intentionally conservative.
    const walker=document.createTreeWalker(owner,NodeFilter.SHOW_TEXT);
    let node, chunks=[],lastBlock=null,total=0;
    while((node=walker.nextNode())!==null){
      const parent=node.parentElement,raw=node.nodeValue||'';
      if(!parent||!raw.trim())continue;
      if(userBoundary && !(userBoundary.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
      if(isUserDescendant(parent) || parent.closest(FALLBACK_SKIP))continue;
      if(parent.closest('[data-testid="conversation-turn-tools"], [data-testid="turn-actions"]'))continue;
      if(RESPONSE_LABEL.test(raw.trim()))continue;
      // Hidden/portal menu labels are not assistant content.
      if(parent.closest('[data-radix-popper-content-wrapper]'))continue;
      if(parent.getClientRects().length===0)continue;
      const block=parent.closest('p, pre, li, blockquote, h1, h2, h3, h4, h5, h6, tr, article, section')||parent.closest('div');
      if(lastBlock&&block&&lastBlock!==block)chunks.push('\n');
      chunks.push(raw);lastBlock=block||parent;total+=raw.length;
      if(total>30000)break;
    }
    let text=chunks.join('').replace(/\n[ \t]+/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();
    // Controls from truncated replies may be hidden from the text walk, but
    // expandButtons(owner) / isCollapsed will still stop premature archiving.
    return text;
  }
  function assistantElements() {
    const replies=new Map();
    const add=el=>{
      if(!el || isUserDescendant(el))return;
      const owner=closestTurn(el);
      // Do not reject an explicit GPT body just because the turn also has a user.
      // The marker itself must be outside the user's bubble.
      let body=bestAssistantBody(el);
      if(!body || isUserDescendant(body)) {
        body=AI_BODY_SELECTORS.flatMap(selector=>[...owner.querySelectorAll(selector)])
          .find(x=>!isUserDescendant(x))||null;
      }
      if(!body||isUserDescendant(body)||!cleanText(body))return;
      const previous=replies.get(owner);
      if(!previous || cleanText(body).length>cleanText(previous).length)replies.set(owner,body);
    };
    const owners=[...document.querySelectorAll(TURN_SELECTOR)]
      .filter(owner=>!owner.parentElement?.closest(TURN_SELECTOR));
    for(const owner of owners)add(owner);
    for(const el of document.querySelectorAll(AI_CANDIDATE_SELECTOR))add(el);
    let fallbackCount=0, ambiguousCount=0;
    for(const owner of owners){
      if(replies.has(owner))continue;
      const userBubbles=outerUsers().filter(el=>owner.contains(el));
      if(userBubbles.length!==1){
        // Without exactly one marked user bubble, we cannot safely split a
        // composite turn; don't let other page UI become a reply.
        if(userBubbles.length>1)ambiguousCount++;
        continue;
      }
      const text=assistantTextWithoutUser(owner,userBubbles[0]);
      if(!text || text.length<2){ambiguousCount++;continue;}
      // Ensure this was not just a toolbar/time label or a collapsed preview.
      if(/^(?:Copy|Share|Retry|複製|分享|重試|編輯|更多選項|顯示較多|顯示更多|你說|ChatGPT 說|\d{1,2}:\d{2})$/i.test(text)){
        ambiguousCount++;continue;
      }
      assistantFallbackTexts.set(owner,text);
      replies.set(owner,owner);fallbackCount++;
    }
    diagnostics.fallbackAiCount=fallbackCount;
    diagnostics.ambiguousTurns=ambiguousCount;
    return [...replies.values()];
  }
  // ChatGPT folds lengthy bubbles behind "... / 顯示較多".  That is a UI
  // control, not part of a story. Never upload the truncated preview as canon.
  const EXPAND_LABEL=/^(?:顯示較多|顯示更多|顯示全部|展開全文|Show more|Read more)$/i;
  const TRUNCATED_TAIL=/(?:^|\n)\s*(?:(?:\.{3}|…|⋯)\s*(?:\n\s*)?)?(?:顯示較多|顯示更多|顯示全部|展開全文|Show more|Read more)\s*$/i;
  const attempts=new WeakSet();
  function turnForMessage(m) {
    const el=messageElements.get(keyOf(m));
    return el?.closest('[data-turn-key], [data-testid^="conversation-turn-"]') || el?.closest(USER_SELECTOR) || el;
  }
  function expandButtons(owner) {
    if(!owner)return [];
    const hits=[...owner.querySelectorAll('button, [role="button"], a, [tabindex]')].filter(el=>{
      const label=(el.innerText||el.textContent||el.getAttribute('aria-label')||'').trim();
      return EXPAND_LABEL.test(label);
    });
    if(hits.length)return hits;
    // Older ChatGPT builds use a cursor-pointer span/div instead of a button.
    return [...owner.querySelectorAll('span, div')].filter(el=>{
      if(el.children.length && [...el.children].some(x=>(x.innerText||'').trim()===(el.innerText||'').trim()))return false;
      if(!EXPAND_LABEL.test((el.innerText||'').trim()))return false;
      return el.matches('[class*="cursor-pointer"], [class*="cursor-interaction"]');
    });
  }
  function isCollapsed(m) {
    return TRUNCATED_TAIL.test((m.text||'').replace(/\r\n?/g,'\n')) || expandButtons(turnForMessage(m)).length>0;
  }
  async function expandCollapsed(maxClicks=4) {
    let opened=0,failed=0;
    for(const m of collect()){
      if(opened>=maxClicks)break;
      const buttons=expandButtons(turnForMessage(m));
      if(!buttons.length)continue;
      const button=buttons.find(el=>!attempts.has(el));
      if(!button)continue;
      attempts.add(button);
      try{
        button.click();
        opened++;
        await sleep(120);
      }catch(e){failed++;console.warn('輪迴歸檔：展開長訊息失敗',e)}
    }
    if(opened||failed)diagnostics.expansionStatus=`已嘗試展開 ${opened} 則長訊息${failed?'；失敗 '+failed+' 則':''}`;
    return opened;
  }
  function newLayout() {
    const users=outerUsers();
    const assistant=assistantElements();
    const tagged=new Map();
    for(const el of users)tagged.set(el,'me');
    for(const el of assistant)tagged.set(el,'ai');
    const els=[...tagged.keys()].sort((a,b)=>{
      if(a===b)return 0;
      // When one data-turn-key owns both messages, the fallback assistant
      // points at the ancestor turn. It must still follow the user message.
      const aOwner=a.closest('[data-turn-key]'),bOwner=b.closest('[data-turn-key]');
      if(aOwner && aOwner===bOwner && tagged.get(a)!==tagged.get(b))
        return tagged.get(a)==='me'?-1:1;
      const cmp=a.compareDocumentPosition(b);
      return cmp & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : cmp & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
    });
    const output=[];
    let ui=0,ai=0;
    for(const el of els){
      const user=tagged.get(el)==='me', index=user?ui++:ai++;
      const fallback=!user&&assistantFallbackTexts.has(el);
      const text=cleanArchiveLessTail(user?userText(el):fallback?assistantFallbackTexts.get(el):cleanText(el));
      if(!text)continue;
      output.push(withObservedTime({id:user?userId(el,index):aiId(el,index),role:user?'me':'ai',text,order:output.length,fallbackComposite:fallback},el));
    }
    return sharedCapturedMinute(output);
  }
  function oldLayout() {
    const nodes = [...document.querySelectorAll(LEGACY_SELECTOR)]
      .filter(el => ['user','assistant'].includes(el.getAttribute('data-message-author-role')))
      .filter(el => !el.parentElement?.closest(LEGACY_SELECTOR));
    return sharedCapturedMinute(nodes.map((el, i) => {
      const user = el.getAttribute('data-message-author-role') === 'user';
      const body = user ? (el.querySelector('.whitespace-pre-wrap') || el) : (el.querySelector('.markdown') || el);
      return withObservedTime({
        id: 'legacy:' + (el.getAttribute('data-message-id') || el.closest('[data-message-id]')?.getAttribute('data-message-id') || i),
        role: user ? 'me' : 'ai',
        text: cleanArchiveLessTail(cleanText(body)),
        order: i
      },el);
    }));
  }
  function collect() {
    const newer = newLayout();
    if(newer.length){
      const legacy=oldLayout();
      // When only the user side is marked in the new layout, collect legacy
      // assistant nodes too.  Prefer the new turn-key record if both exist.
      const included=new Set(newer.filter(x=>x.role==='ai').map(x=>x.text));
      const missing=legacy.filter(m=>m.role==='ai' && !included.has(m.text));
      if(missing.length){
        const combined=[...newer,...missing].sort((a,b)=>{
          const x=messageElements.get(keyOf(a)),y=messageElements.get(keyOf(b));
          if(x===y)return a.role==='me'?-1:1;
          const tx=x?.closest?.('[data-turn-key], [data-testid^="conversation-turn-"]');
          const ty=y?.closest?.('[data-turn-key], [data-testid^="conversation-turn-"]');
          if(tx && tx===ty && a.role!==b.role)return a.role==='me'?-1:1;
          const relation=x?.compareDocumentPosition?.(y)||0;
          return relation & Node.DOCUMENT_POSITION_FOLLOWING?-1:relation & Node.DOCUMENT_POSITION_PRECEDING?1:0;
        });
        combined.forEach((m,i)=>{m.order=i});
        diagnostics.mode='混合新版／舊版 GPT 相容';
        return combined;
      }
      diagnostics.mode='新版 ChatGPT（含 DIL／Markdown／無標記文字備援）';
      return newer;
    }
    diagnostics.mode='舊版相容模式';
    return oldLayout();
  }
  function keyOf(m) { return m.role + '|' + m.id; }
  function noteStatus() {
    const messages = collect();
    diagnostics.nodeCount = messages.length;
    diagnostics.userCount = messages.filter(m => m.role === 'me').length;
    diagnostics.aiCount = messages.filter(m => m.role === 'ai').length;
    diagnostics.assistantMarkers = document.querySelectorAll(AI_CANDIDATE_SELECTOR).length;
    diagnostics.turnCount = document.querySelectorAll('[data-turn-key]').length;
    diagnostics.collapsedCount=messages.filter(isCollapsed).length;
    // Counts refer only to currently rendered ChatGPT bubbles, not full history.
    Object.assign(diagnostics,galArchiveHintSummary(messages));
    diagnostics.detectWarning = diagnostics.userCount>=2 && diagnostics.aiCount===0
      ?'⚠ 偵測到多則玩家訊息，卻沒有辨識到 GPT 回覆。暫停回補及發送，請確認頁面結構。':'';
    diagnostics.enabled = state.enabled;
    diagnostics.path = path();
    diagnostics.updatedAt = Date.now();
    diagnostics.latest = messages.length ? messages[messages.length-1].role + ': ' + messages[messages.length-1].text.slice(0,42) : '找不到可辨認的訊息';
    return messages;
  }
  function baseline() {
    baselineIds.clear();
    firstSeenAt.clear();
    delivered.clear();
    candidates.clear();
    sourceTimeCache.clear();
    messageElements.clear();
    for (const m of noteStatus()) baselineIds.add(keyOf(m));
  }
  async function syncWatch() {
    const p = path();
    if (p !== state.previousPath) {
      state.previousPath = p;
      state.watchedPath = null;
      state.enabled = false;
      baseline();
    }
    if (!valid()) return;
    const { watch = {}, autoTimeCapture = false } = await chrome.storage.local.get(['watch','autoTimeCapture']);
    state.autoTime=autoTimeCapture===true;
    diagnostics.autoTime=state.autoTime;
    const enabled = watch[p] === true;
    if (enabled && state.watchedPath !== p) {
      baseline();
      state.watchedPath = p;
    }
    state.enabled = enabled;
    if (!enabled) { state.watchedPath = null; candidates.clear(); }
  }
  function isGenerating() {
    return !!document.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="停止產生"]');
  }
  function sendMessage(m, k, current) {
    const messageChat=path();
    current.sending = true;
    state.activeSends++;
    chrome.runtime.sendMessage({ type: 'queue-message', identity: m.id, role: m.role, text: m.text, order: m.order, sourceCreatedAt: m.sourceCreatedAt, sourceTimeOrigin: m.sourceTimeOrigin, sourceTimePrecision: m.sourceTimePrecision, capturedAt: m.capturedAt }, result => {
      state.activeSends = Math.max(0, state.activeSends - 1);
      const err = chrome.runtime.lastError?.message;
      if (err || !result?.ok) {
        diagnostics.error = err || result?.error || '無法寫入 Firebase';
        diagnostics.lastUpload={ok:false,chat:messageChat,role:m.role,preview:m.text.slice(0,48),sourceCreatedAt:m.sourceCreatedAt,sourceTimeOrigin:m.sourceTimeOrigin,error:diagnostics.error,at:new Date().toISOString()};
        saveTimeEvent('lastTimeUpload','lastTimeUploadByChat',diagnostics.lastUpload);
        current.sending = false;
        current.retryAfter = Date.now() + 15000;
        return;
      }
      diagnostics.error = '';
      diagnostics.lastUpload={ok:true,chat:messageChat,role:m.role,preview:m.text.slice(0,48),sourceCreatedAt:m.sourceCreatedAt,sourceTimeOrigin:m.sourceTimeOrigin,at:new Date().toISOString(),duplicate:!!result?.duplicate};
      saveTimeEvent('lastTimeUpload','lastTimeUploadByChat',diagnostics.lastUpload);
      delivered.add(k);
      candidates.delete(k);
    });
  }
  async function scan() {
    // Historical range import has a separate, sequential uploader. Do not let
    // the ordinary observer race it or secretly upload outside its boundaries.
    if (state.bulk || !valid() || !state.enabled || state.watchedPath !== path()) return;
    const now = Date.now();
    await expandCollapsed(4);
    const messages = noteStatus();
    if(diagnostics.detectWarning){diagnostics.error=diagnostics.detectWarning;return}
    const streaming = isGenerating();
    for (const m of messages) {
      const k = keyOf(m);
      if (baselineIds.has(k) || delivered.has(k) || !m.text) continue;
      // A player turn is only safe to archive together with a recognized GPT
      // response. Do not write an unanswered player turn, including mid-stream.
      const pairAt=messages.findIndex(x=>keyOf(x)===k);
      if (pairedIndex(messages,pairAt)<0 || streaming) continue;
      if(isCollapsed(m)){diagnostics.error='有未展開的長訊息，禁止寫入不完整內容。請檢查「顯示較多」並再次回補。';continue}
      // Avoid uploading a message while its text is still changing.
      if (m.text.length > 25000) { diagnostics.error = '訊息超過 25000 字元，暫不歸檔'; continue; }
      let candidate = candidates.get(k);
      if (!candidate || candidate.text !== m.text) {
        candidate = {text:m.text, lastChanged:now, sending:false, retryAfter:0};
        candidates.set(k, candidate);
        continue;
      }
      if (candidate.sending || now < candidate.retryAfter) continue;
      if (streaming && m.role === 'ai') continue;
      if (now - candidate.lastChanged < (m.role === 'ai' ? 6000 : 2000)) continue;
      if (state.activeSends >= 1) continue; // Keep import ordering and avoid burst requests.
      if(state.autoTime&&!candidate.timeAttempted&&!sourceTimeCache.has(k)){
        if(streaming)continue; // Avoid opening menus during generation.
        const pos=messages.findIndex(x=>keyOf(x)===k);
        const paired=pairedIndex(messages,pos);
        const preferred=paired>=0&&m.role==='me'?messages[paired]:m;
        // If the matching GPT reply exists and is still settling, don't grab
        // the player's menu instead of its newer reply time.
        if(preferred.role==='ai'&&Date.now()-Date.parse(preferred.capturedAt)<6000)continue;
        candidate.timeAttempted=true;
        let stamp=await captureMenuTime(preferred);
        if(!stamp.ok && preferred!==m)stamp=await captureMenuTime(m);
        diagnostics.timeResults=stamp.ok?`取得 ${stamp.preview}：${stamp.text}${stamp.paired?'（已套用同回合雙方）':''}`:`未取得 ${m.text.slice(0,18)}：${stamp.reason}`;
        if(!stamp.ok)recordCapture({status:'failed',role:m.role,preview:m.text.slice(0,65),detail:stamp.reason});
        if(!stamp.ok && /使用者正在操作|正在擷取另一則/.test(stamp.reason)){
          candidate.timeAttempted=false;
          candidate.retryAfter=Date.now()+1800;
          continue;
        }
      }
      // If no menu timestamp was readable, wait briefly for the next GPT
      // response so both parts share one first-observed ordering timestamp.
      if(state.autoTime && m.role==='me' && !sourceTimeCache.has(k)
          && Date.now()-candidate.lastChanged<90000)continue;
      if(!valid()||!state.enabled||state.watchedPath!==path()||candidate.text!==m.text)continue;
      const newer=collect().find(x=>keyOf(x)===k);
      if(newer&&isCollapsed(newer)){diagnostics.error='長訊息仍未展開，略過本則以保護正史';continue}
      if(!newer || newer.text!==candidate.text){
        candidate.lastChanged=Date.now();
        candidate.text=newer?.text||'';
        candidate.timeAttempted=false;
        continue;
      }
      sendMessage(newer, k, candidate);
    }
  }

  // V0.6.0: gap-proof slow traversal and bidirectional pair verification.
  // No remote ChatGPT history API is used. Only actual rendered message DOM is
  // read, and we never send a player turn until its GPT partner is present.
  const BULK_LIMIT=4000;             // explicit stop, never silently truncate
  const BULK_MAX_DURATION=1500000;    // slow scans need time; still have an upper bound
  const BULK_SCROLL_RATIO=0.27;       // <=27% viewport each step; keep overlap checks
  const BULK_SCROLL_DELAY=477;       // let virtualized turns render before continuing
  const BULK_SETTLE_DELAY=340;       // stabilization after expanding/time popovers
  const BULK_SELECTOR='[data-turn-key], [data-testid^="conversation-turn-"]';
  const BULK_STYLE_ID='ga-archive-range-style';
  let bulkLastStoredAt=0;
  const isBulkLive=b=>state.bulk===b&&!b.cancelled&&valid()&&state.enabled&&state.watchedPath===b.chat&&path()===b.chat;
  function bulkNode(m) {return messageElements.get(keyOf(m))||null;}
  function bulkTurn(m) {return bulkNode(m)?.closest(BULK_SELECTOR)||null;}
  function bulkIdentity(m) {
    const owner=bulkTurn(m);
    const stable=owner?.getAttribute('data-turn-key')||owner?.getAttribute('data-testid');
    if(stable)return m.role+'|turn:'+stable;
    if(/^(?:ai-message:|user-turn:|legacy:|ai-turn:)/.test(m.id))return m.role+'|'+m.id;
    return null; // recycled positional DOM IDs are unsafe for historical scans
  }
  function bulkSendIdentity(m) {
    if(!/^(ai-position:|user-position:)/.test(m.id))return m.id;
    return m.role==='ai'?'ai-turn:'+m.bulkKey.split('|turn:').at(-1):'user-turn:'+m.bulkKey.split('|turn:').at(-1);
  }
  function bulkHost() {
    const first=outerUsers()[0]||document.querySelector(BULK_SELECTOR);
    for(let p=first;p&&p!==document.body;p=p.parentElement){
      const css=getComputedStyle(p);
      if(p.clientHeight>180&&p.scrollHeight>p.clientHeight+80&&/(auto|scroll|overlay)/.test(css.overflowY))return p;
    }
    const alternatives=[...document.querySelectorAll('main, [class*="overflow-y-auto"], [class*="overflow-auto"], [data-scroll-root]')]
      .filter(p=>p.contains(first)&&p.clientHeight>180&&p.scrollHeight>p.clientHeight+80)
      .sort((a,b)=>a.clientHeight-b.clientHeight);
    return alternatives[0]||document.scrollingElement||document.documentElement;
  }
  function bulkPosition(host){return host.scrollTop||0;}
  function bulkViewport(host){
    if(host===document.scrollingElement||host===document.documentElement||host===document.body)return {top:0,bottom:innerHeight};
    const r=host.getBoundingClientRect();
    return {top:Math.max(0,r.top),bottom:Math.min(innerHeight,r.bottom)};
  }
  function bulkVisible(m,host){
    const el=bulkNode(m);if(!el)return false;
    const r=el.getBoundingClientRect(),v=bulkViewport(host);
    return r.height>0&&r.bottom>v.top+5&&r.top<v.bottom-5;
  }
  function bulkFirstAtViewport(host){
    const list=collect();
    const visible=list.find(m=>bulkVisible(m,host)&&bulkIdentity(m));
    if(!visible)return null;
    const i=list.findIndex(x=>bulkIdentity(x)===bulkIdentity(visible));
    // If the visible message is GPT, bring its immediately preceding player
    // turn into the selected range (a complete exchange). If inaccessible,
    // begin at the next rendered player turn instead.
    if(visible.role==='ai') {
      const prior=pairedIndex(list,i);
      if(prior>=0)return list[prior];
      return list.slice(i+1).find(m=>m.role==='me'&&bulkIdentity(m))||null;
    }
    return visible;
  }
  function bulkStatus(b,message,{error=false,force=false}={}){
    b.message=message;
    const pane=b.pane;
    if(pane){
      const info=pane.querySelector('[data-ga-status]');
      if(info){info.textContent=message;info.style.color=error?'#ffc2cc':'#e9eeff';}
    }
    diagnostics.bulkStatus={mode:b.mode,phase:b.phase,progress:message,count:b.rows.length,uploaded:b.uploaded,at:new Date().toISOString(),error};
    if(force||Date.now()-bulkLastStoredAt>1000){
      bulkLastStoredAt=Date.now();
      chrome.storage.local.get(['bulkByChat'],data=>{
        const map=data.bulkByChat||{};
        map[b.chat]=diagnostics.bulkStatus;
        chrome.storage.local.set({bulkByChat:map});
      });
    }
  }
  function bulkFinish(b,message,error=false){
    b.phase='finished';
    bulkDetachSelection(b);
    bulkStatus(b,message,{error,force:true});
    if(b.pane){
      b.pane.querySelector('[data-ga-cancel]').textContent='關閉';
      b.pane.querySelector('[data-ga-submit]').hidden=true;
      b.pane.querySelector('[data-ga-caption]').textContent='已結束。原本的訊息監看仍維持原設定。';
    }
    if(state.bulk===b)state.bulk=null;
  }
  function bulkPanel(b){
    document.getElementById(BULK_STYLE_ID)?.remove();
    document.getElementById('ga-archive-batch')?.remove();
    const style=document.createElement('style');style.id=BULK_STYLE_ID;
    style.textContent=`
      #ga-archive-batch {position:fixed!important;z-index:2147483646!important;top:12px;right:12px;
        width:min(375px,calc(100vw - 24px));padding:14px;border:2px solid #a29bfe;border-radius:13px;
        background:#10182a!important;color:#f3f4ff!important;font:13px/1.65 system-ui,sans-serif!important;
        box-shadow:0 14px 50px #0009!important}
      #ga-archive-batch * {box-sizing:border-box}
      #ga-archive-batch button{font:inherit!important;cursor:pointer!important;border-radius:8px!important;
        border:1px solid #6873ac!important;background:#34486e!important;color:white!important;
        padding:7px 10px!important;margin:5px 5px 0 0!important}
      #ga-archive-batch button[data-ga-submit]{background:#4d50cb!important}
      [data-ga-archive-hover="true"]{outline:3px solid #ffdb73!important;outline-offset:3px!important}
      [data-ga-archive-selected="true"]{outline:3px solid #9b93ff!important;outline-offset:3px!important}
    `;
    document.documentElement.appendChild(style);
    const pane=document.createElement('section');pane.id='ga-archive-batch';pane.setAttribute('role','status');
    const title=document.createElement('div');title.style.fontWeight='750';title.style.fontSize='15px';
    title.textContent=b.mode==='down'?'📥 從目前位置向下掃描':'🖱️ 拖曳／點選對話範圍';
    const caption=document.createElement('div');caption.dataset.gaCaption='';
    caption.textContent=b.mode==='down'?'正在沿頁面向下收集完整的玩家＋副駕駛回合。':'先點選起點，再捲動或拖動畫面，點選終點；也可按住訊息向下拖曳選取。';
    const status=document.createElement('div');status.dataset.gaStatus='';status.style.marginTop='6px';status.textContent='準備中……';
    const send=document.createElement('button');send.dataset.gaSubmit='';send.textContent='確認上傳這個範圍';send.hidden=true;
    send.addEventListener('click',()=>bulkSubmitRange(b));
    const cancel=document.createElement('button');cancel.dataset.gaCancel='';cancel.textContent='取消／停止';
    cancel.addEventListener('click',()=>{
      if(b.phase==='finished'){pane.remove();style.remove();return;}
      b.cancelled=true;bulkDetachSelection(b);
      if(b.phase==='choosing'||b.phase==='selected')bulkFinish(b,'已取消範圍選取，未上傳任何訊息。');
      else bulkStatus(b,'正在停止；已經成功上傳的訊息不會被撤回。',{force:true});
    });
    pane.append(title,caption,status,send,cancel);
    document.body.appendChild(pane);
    b.pane=pane;
  }
  function bulkClearHighlights(){
    document.querySelectorAll('[data-ga-archive-hover],[data-ga-archive-selected]').forEach(n=>{
      n.removeAttribute('data-ga-archive-hover');n.removeAttribute('data-ga-archive-selected');
    });
  }
  function bulkDetachSelection(b,clear=true){
    if(b.selectionHandlers){
      for(const [type,handler,options] of b.selectionHandlers)document.removeEventListener(type,handler,options);
      b.selectionHandlers=[];
    }
    if(b.scrollHandler&&b.host){b.host.removeEventListener('scroll',b.scrollHandler);b.scrollHandler=null;}
    if(clear)bulkClearHighlights();
  }
  function bulkEntry(target,preferEnd){
    const turn=target?.closest?.(BULK_SELECTOR);
    if(!turn)return null;
    const candidates=collect().filter(m=>bulkTurn(m)===turn&&bulkIdentity(m));
    // The owner can contain the player and GPT; select the entire exchange.
    if(!candidates.length)return null;
    return (preferEnd?candidates.findLast(m=>m.role==='ai'):candidates.find(m=>m.role==='me'))
       ||(preferEnd?candidates.at(-1):candidates[0]);
  }
  // In continuous downward mode, the viewport gives the initial direction,
  // not a persistent DOM anchor. ChatGPT may virtualize/recycle earlier turns
  // as soon as the page scrolls or a timestamp menu opens.
  function bulkDownFirstIndex(live,host){
    // Sort visible messages by their REAL viewport position. DOM fallback
    // ancestors may otherwise make the apparent first message be GPT.
    const visible=live.map((m,i)=>({m,i,node:bulkNode(m)}))
      .filter(x=>x.node&&bulkVisible(x.m,host))
      .sort((a,b)=>a.node.getBoundingClientRect().top-b.node.getBoundingClientRect().top || a.i-b.i);
    if(!visible.length)return -1;
    const first=visible[0];
    if(first.m.role==='ai'){
      const partner=pairedIndex(live,first.i);
      if(partner>=0 && live[partner].role==='me' && bulkIdentity(live[partner]))return partner;
      return -2; // Do not skip a GPT turn or silently start at later user text.
    }
    return bulkIdentity(first.m)?first.i:-1;
  }
  // Cross-window continuity is mandatory. A virtualized ChatGPT page may
  // unload all prior turns while scrolling; accepting the next DOM batch as
  // a continuation silently drops entire user+GPT pairs.
  function bulkCheckContinuity(b,live){
    if(!b.started||!b.rows.length)return {ok:true,lastKnown:-1};
    const known=[];
    for(let i=0;i<live.length;i++){
      const key=bulkIdentity(live[i]);
      if(key&&b.byKey.has(key))known.push(i);
    }
    if(!known.length)return {ok:false,error:'新畫面與上一批沒有共同訊息；可能已跳過整段對話'};
    const first=known[0],last=known.at(-1);
    // New DOM turns before an old anchor signal missed text, not history to skip.
    if(live.slice(0,first).some(m=>{const k=bulkIdentity(m);return k&&!b.byKey.has(k)}))
      return {ok:false,error:'有未記錄的訊息出現在接續錨點之前，可能漏掃'};
    const tail=b.rows.at(-1)?.bulkKey;
    const newAfter=live.slice(last+1).some(m=>{const k=bulkIdentity(m);return k&&!b.byKey.has(k)});
    if(newAfter&&!live.some(m=>bulkIdentity(m)===tail))
      return {ok:false,error:'上一批最後一則已離開畫面，無法確認新訊息緊接在後'};
    return {ok:true,lastKnown:last};
  }
  function bulkRoleIssue(rows){
    for(let i=0;i<rows.length;i++){
      const expected=i%2===0?'me':'ai';
      if(rows[i].role!==expected)return i%2===0
        ?'第 '+(i+1)+' 則是 GPT，但前面沒有對應皮卡發言'
        :'第 '+(i+1)+' 則是皮卡，但前面一則皮卡尚未有 GPT 回覆';
    }
    return '';
  }
  function bulkHarvest(b){
    const live=collect();
    let idx=-1;
    if(b.mode==='down'){
      if(!b.started){
        idx=bulkDownFirstIndex(live,b.host);
        if(idx===-2){b.startProblem='目前畫面第一則是 GPT 回覆，但沒有能驗證的前置皮卡訊息；請往上捲到這組皮卡發言再開始，禁止從 GPT 開頭';return false;}
        if(idx>=0){
          if(live[idx].role!=='me'){b.startProblem='起點未通過角色驗證：第一則必須是皮卡，不允許 GPT 先出現';return false;}
          b.started=true;
          // This is a one-time order hint, NOT an anchor we must find again.
          b.baseOrder=Math.max(0,idx);
        }
      }else{
        const check=bulkCheckContinuity(b,live);
        if(!check.ok){b.gapError=check.error;return false;}
        b.gapError='';
        idx=check.lastKnown+1;
      }
    }else{
      // Manual range mode alone must retain and re-find its chosen start.
      const anchor=live.findIndex(m=>bulkIdentity(m)===b.startKey);
      idx=anchor;
      if(idx<0&&b.started){
        const check=bulkCheckContinuity(b,live);
        if(!check.ok){b.gapError=check.error;return false;}
        b.gapError='';
        idx=check.lastKnown+1;
      }
    }
    if(idx<0)return false;
    b.started=true;
    if(!b.rows.length && live[idx]?.role!=='me'){b.startProblem='掃描的第一則不是皮卡，已中止且本批不傳送';return false;}
    for(let i=0;i<live.length;i++){
      const m=live[i],key=bulkIdentity(m);
      const previous=key?b.byKey.get(key):null;
      // Refresh earlier seen messages (expanded text or captured menu time),
      // but NEVER introduce new items before the starting/continuation index.
      if(i<idx&&!previous)continue;
      if(!key){
        if(i>=idx)b.badIdentity=true;
        continue;
      }
      const collapsed=isCollapsed(m);
      const snapshot={...m,bulkKey:key,id:bulkSendIdentity({...m,bulkKey:key}),collapsed};
      if(previous){
        // Stable message keys must not be recycled for a different message.
        // Expanding folded text may grow a prefix, but unrelated text is a
        // conflict and must halt the entire upload.
        if(!previous.collapsed&&!snapshot.collapsed&&previous.text!==snapshot.text&&
          !snapshot.text.startsWith(previous.text)&&!previous.text.startsWith(snapshot.text)){
          b.identityConflict='相同訊息 ID 讀到不同內容（'+key+'），可能遇到虛擬列表重用；禁止上傳';
          return false;
        }
        if(!collapsed&&(previous.collapsed||snapshot.text.length>=previous.text.length)){
          previous.text=snapshot.text;previous.collapsed=false;
        }
        if(snapshot.sourceCreatedAt&&(!previous.sourceCreatedAt||
          (snapshot.sourceTimeOrigin==='menu'&&previous.sourceTimeOrigin!=='menu'))){
          previous.sourceCreatedAt=snapshot.sourceCreatedAt;
          previous.sourceTimeOrigin=snapshot.sourceTimeOrigin;
          previous.sourceTimePrecision=snapshot.sourceTimePrecision;
        }
      }else{
        b.byKey.set(key,snapshot);b.rows.push(snapshot);
      }
    }
    return true;
  }
  // Check text again after each click. In Chrome, controls can be rendered but
  // a click can fail to expand, or React can replace the node. Unlike the
  // ordinary observer, the historical scanner MUST retry a folded turn.
  // Never march past an unresolved folded message: after virtualized scrolling
  // it may disappear, making a complete second read impossible.
  function bulkFoldDescription(b,entry,detail){
    const i=b.rows.findIndex(m=>m.bulkKey===entry.bulkKey);
    const number=i>=0?i+1:'?';
    const role=entry.role==='me'?'皮卡':'GPT';
    const preview=String(entry.text||'').replace(/\s+/g,' ').slice(0,56);
    return `第 ${number} 則（${role}：「${preview}」）${detail}`;
  }
  function bulkRefreshVisibleFolds(b,live){
    const byKey=new Map(live.map(m=>[bulkIdentity(m),m]).filter(([key])=>!!key));
    for(const entry of b.rows){
      if(!entry.collapsed)continue;
      const current=byKey.get(entry.bulkKey);
      if(current&&!isCollapsed(current)){
        entry.text=current.text;
        entry.collapsed=false;
        if(current.sourceCreatedAt&&(!entry.sourceCreatedAt||current.sourceTimeOrigin==='menu')){
          entry.sourceCreatedAt=current.sourceCreatedAt;
          entry.sourceTimeOrigin=current.sourceTimeOrigin;
          entry.sourceTimePrecision=current.sourceTimePrecision;
        }
      }
    }
  }
  async function bulkExpandView(b){
    // An entire message can be much taller than the viewport; its expand
    // control might be offscreen while its body is visible. Click the actual
    // control from any mounted captured turn, not only from visible bubbles.
    // Each pass verifies success from a fresh DOM read; retries are bounded.
    const maxRounds=4;
    for(let round=0;round<maxRounds&&isBulkLive(b);round++){
      const live=collect();
      bulkRefreshVisibleFolds(b,live);
      const pending=b.rows.filter(m=>m.collapsed);
      if(!pending.length)return;
      const byKey=new Map(live.map(m=>[bulkIdentity(m),m]).filter(([key])=>!!key));
      const missing=pending.find(entry=>!byKey.has(entry.bulkKey));
      if(missing)throw Error(bulkFoldDescription(b,missing,
        '仍有「顯示較多」，但訊息已離開可讀畫面。為避免遺漏已停止；請從較上方重新掃描'));
      const clickedOwners=new Set();
      let clicked=0;
      for(const entry of pending){
        if(!isBulkLive(b))return;
        const m=byKey.get(entry.bulkKey),owner=turnForMessage(m);
        if(!owner||clickedOwners.has(owner))continue;
        const controls=expandButtons(owner);
        const control=controls.find(el=>typeof el.click==='function'&&!el.disabled);
        if(!control)throw Error(bulkFoldDescription(b,entry,
          '仍然折疊，但找不到可點擊的「顯示較多」。請手動展開後重新掃描；本批不會上傳'));
        // Do not use the global attempts WeakSet. That is only suitable for
        // the passive observer, not a correctness-critical history scan.
        try{control.click();clicked++;clickedOwners.add(owner)}
        catch(e){
          throw Error(bulkFoldDescription(b,entry,'點擊展開失敗：'+String(e?.message||e)));
        }
        await sleep(140);
      }
      if(!clicked)throw Error(bulkFoldDescription(b,pending[0],
        '找不到可以重試的展開控制項；本批不會上傳'));
      await sleep(360+round*170);
      // Expand state is re-read and cached rows updated before moving the
      // viewport. Later passes should never depend on stale collapsed flags.
      const after=collect();
      bulkRefreshVisibleFolds(b,after);
      if(!b.rows.some(m=>m.collapsed))return;
    }
    const unresolved=b.rows.find(m=>m.collapsed);
    if(unresolved)throw Error(bulkFoldDescription(b,unresolved,
      '已自動重試展開 4 輪，仍有「顯示較多」。請手動點開再重掃；本批 0 則上傳'));
  }
  async function bulkCaptureViewTimes(b){
    if(!state.autoTime||isGenerating())return;
    const live=collect();
    for(let i=1;i<live.length&&isBulkLive(b);i++){
      const m=live[i];
      if(m.role!=='ai'||live[i-1].role!=='me'||!bulkVisible(m,b.host))continue;
      const k=keyOf(m);
      if(b.timeTried.has(bulkIdentity(m))||m.sourceCreatedAt)continue;
      b.timeTried.add(bulkIdentity(m));
      try {await captureMenuTime(m);}catch(_){/* retain first-observed time if menu unavailable */}
    }
  }
  function bulkPairPrefix(b){
    const rows=b.endKey?b.rows.slice(0,b.rows.findIndex(m=>m.bulkKey===b.endKey)+1):b.rows;
    const result=[];
    let stop='';
    const structural=bulkRoleIssue(rows);
    if(structural)return {rows:[],stop:structural};
    for(let i=0;i<rows.length;i+=2){
      const me=rows[i],ai=rows[i+1];
      if(isGenerating()&&i>=rows.length-2){stop='副駕駛仍在生成最後一則，最後這組未收錄';break;}
      if(!me||me.role!=='me') {stop='GPT 回應沒有對應皮卡發言，雙向配對失敗';break;}
      if(!ai||ai.role!=='ai') {stop='皮卡發言沒有對應副駕駛回覆，雙向配對失敗';break;}
      if(me.collapsed||ai.collapsed||TRUNCATED_TAIL.test(me.text)||TRUNCATED_TAIL.test(ai.text)){
        const bad=me.collapsed||TRUNCATED_TAIL.test(me.text)?me:ai;
        stop=bulkFoldDescription(b,bad,'仍有未展開的「顯示較多」，本批不可上傳');break;
      }
      if(me.text.length>25000||ai.text.length>25000){
        stop='有超過 25,000 字的訊息，在這一組之前停止，請分段處理';break;
      }
      result.push(me,ai);
    }
    return {rows:result,stop};
  }
  function bulkNormalizePairs(rows){
    // Both messages share one captured minute when neither has true source
    // metadata. When one has a menu time the other is explicitly inferred.
    for(let i=0;i+1<rows.length;i+=2){
      const me=rows[i],ai=rows[i+1];
      const a=Date.parse(me.capturedAt),b=Date.parse(ai.capturedAt);
      const ts=[a,b].filter(Number.isFinite);
      if(ts.length){me.capturedAt=ai.capturedAt=new Date(Math.min(...ts)).toISOString();}
      const stronger=[ai,me].find(x=>x.sourceCreatedAt&&['menu','dom'].includes(x.sourceTimeOrigin))||
        [ai,me].find(x=>x.sourceCreatedAt);
      if(stronger){
        for(const m of [me,ai])if(m!==stronger && (!m.sourceCreatedAt||m.sourceTimeOrigin==='reply-inferred')){
          m.sourceCreatedAt=stronger.sourceCreatedAt;
          m.sourceTimeOrigin='reply-inferred';m.sourceTimePrecision='minute-estimated';
        }
      }
    }
    return rows;
  }
  async function bulkUpload(b){
    if(!isBulkLive(b))return bulkFinish(b,'已取消，沒有開始傳送。');
    const paired=bulkPairPrefix(b);
    // No upload of a "valid prefix" if anything was missing later. The
    // operator can retry a smaller range after fixing the page, rather than
    // unknowingly accepting a hole in their archive.
    if(paired.stop||paired.rows.length!==b.rows.length||b.gapError||b.identityConflict||b.badIdentity)
      return bulkFinish(b,'完整性檢查未通過，這一批 0 則上傳。原因：'+(b.identityConflict||b.gapError||paired.stop||'有無法辨識的訊息／數量不符'),true);
    if(!paired.rows.length)return bulkFinish(b,'沒有可驗證的完整皮卡＋GPT 回合，本批 0 則上傳。',true);
    if(paired.rows[0].role!=='me'||paired.rows[1]?.role!=='ai')return bulkFinish(b,'掃描起點不是皮卡→GPT，拒絕上傳整批。',true);
    const rows=bulkNormalizePairs(paired.rows);
    const hints=galArchiveHintSummary(rows);
    const hintLabel='\nGal AI 劇情時間 '+hints.storyTimeCount+' 處（網站負責同回合排序）／疑似做愛跳過 '+hints.skipCueCount+' 則（不等於缺漏）';
    b.phase='uploading';b.uploaded=0;
    bulkStatus(b,'共辨識 '+rows.length/2+' 組完整回合，開始依序傳送。'+hintLabel+(paired.stop?'\n停止原因：'+paired.stop:''),{force:true});
    let duplicates=0;
    for(let i=0;i<rows.length;i++){
      if(!isBulkLive(b))return bulkFinish(b,`已停止：成功送出 ${b.uploaded}／${rows.length} 則（重複 ${duplicates} 則）。`,true);
      const m=rows[i];
      // Preserve visible conversation order when starting in the middle.
      // During virtualized scrolling the imported sequence is still monotonic.
      const order=Math.min(1000000,(b.baseOrder||0)+i);
      // One source at a time. If any network write fails, STOP rather than
      // proceeding to later turns and creating holes in conversation history.
      const result=await new Promise(resolve=>{
        chrome.runtime.sendMessage({type:'queue-message',identity:m.id,role:m.role,text:m.text,
          order,sourceCreatedAt:m.sourceCreatedAt||null,sourceTimeOrigin:m.sourceTimeOrigin||null,
          sourceTimePrecision:m.sourceTimePrecision||null,capturedAt:m.capturedAt||null,forceResend:b.replay===true},r=>{
            const error=chrome.runtime.lastError?.message;
            resolve(error?{ok:false,error}:r||{ok:false,error:'無法取得上傳結果'});
          });
      });
      if(!result?.ok)return bulkFinish(b,`第 ${i+1}／${rows.length} 則傳送失敗：${result?.error||'未知錯誤'}。\n前面已寫入的 ${b.uploaded} 則保留，重新掃描可接續去重。`,true);
      b.uploaded++;if(result.duplicate)duplicates++;
      delivered.add(keyOf(m));baselineIds.add(keyOf(m));
      diagnostics.lastUpload={ok:true,chat:b.chat,role:m.role,preview:m.text.slice(0,48),
        sourceCreatedAt:m.sourceCreatedAt,sourceTimeOrigin:m.sourceTimeOrigin,at:new Date().toISOString(),duplicate:!!result.duplicate};
      saveTimeEvent('lastTimeUpload','lastTimeUploadByChat',diagnostics.lastUpload);
      if(i%3===0||i===rows.length-1)bulkStatus(b,`正在上傳 ${i+1}／${rows.length} 則（${rows.length/2} 組完整回合）…`);
    }
    bulkFinish(b,`完成：共 ${rows.length/2} 組、${rows.length} 則（已存在 ${duplicates} 則）。${hintLabel}${paired.stop?'\n已於未配對／不完整訊息前停止：'+paired.stop:''}`);
  }
  async function bulkRecoverOverlap(b){
    const at=bulkPosition(b.host);
    for(let retry=1;retry<=4&&isBulkLive(b);retry++){
      const back=Math.max(90,Math.floor(Math.min(b.host.clientHeight||innerHeight,innerHeight)*0.12));
      b.host.scrollTop=Math.max(0,bulkPosition(b.host)-back);
      await sleep(BULK_SCROLL_DELAY+250);
      b.gapError='';
      bulkHarvest(b);
      if(!b.gapError){
        bulkStatus(b,'已回捲重新連上先前訊息（第 '+retry+' 次），將從這裡小步繼續。');
        return true;
      }
    }
    b.host.scrollTop=at;
    return false;
  }
  async function bulkTraverse(b){
    if(b.mode==='range'){
      b.host.scrollTop=b.startPos;
      await sleep(950);
      b.rows=[];b.byKey.clear();b.started=false;
    }
    const begin=Date.now();let passes=0,atBottom=0,stuck=0,lastY=-1;
    b.phase='scanning';
    while(isBulkLive(b)&&passes<5500&&Date.now()-begin<BULK_MAX_DURATION){
      // Do not scan a moving virtual list. Allow time to render between steps.
      await sleep(passes?BULK_SETTLE_DELAY:800);
      const before=bulkHarvest(b);
      if(b.startProblem)throw Error(b.startProblem+'；本批沒有上傳');
      if(b.gapError){
        if(!await bulkRecoverOverlap(b))throw Error('跨畫面連續性無法確認：'+b.gapError+'。已停止且本批 0 則上傳；請重新定位並選較小範圍');
        continue;
      }
      await bulkExpandView(b);
      await sleep(BULK_SETTLE_DELAY);
      await bulkCaptureViewTimes(b);
      await sleep(BULK_SETTLE_DELAY);
      const found=bulkHarvest(b)||before;
      // Timestamp popovers may rerender conversation turns. Check again while
      // their text is still mounted, before scrolling it out of reach.
      await bulkExpandView(b);
      bulkHarvest(b);
      if(b.gapError){
        if(!await bulkRecoverOverlap(b))throw Error('選單／展開後失去訊息接續：'+b.gapError+'。本批 0 則上傳');
        continue;
      }
      if(b.identityConflict)throw Error(b.identityConflict+'；本批 0 則上傳');
      if(!found&&!b.started&&passes>2)throw Error('起點仍未載入完整訊息，尚未上傳；請移到明確的皮卡發言開始');
      if(b.badIdentity)throw Error('有訊息缺少穩定回合識別碼，為避免漏掃已停止；本批 0 則上傳');
      if(b.rows.length>=BULK_LIMIT)throw Error('超過安全上限 '+BULK_LIMIT+' 則，請分段掃描；本批 0 則上傳');
      const issue=bulkRoleIssue(b.rows);
      if(issue)throw Error('雙向配對檢查失敗：'+issue+'。未掃完／缺訊息，本批 0 則上傳；請檢查缺少哪一方');
      const reachedEnd=b.endKey&&b.rows.some(m=>m.bulkKey===b.endKey);
      const players=b.rows.filter(m=>m.role==='me').length;
      const replies=b.rows.filter(m=>m.role==='ai').length;
      bulkStatus(b,'慢速掃描第 '+(passes+1)+' 步：皮卡 '+players+' 則／GPT '+replies+' 則。逐段確認連續性…');
      if(reachedEnd)break;
      const y=bulkPosition(b.host),max=Math.max(0,b.host.scrollHeight-b.host.clientHeight);
      const bottom=y>=max-4;
      if(bottom){
        await sleep(BULK_SCROLL_DELAY);
        const newMax=Math.max(0,b.host.scrollHeight-b.host.clientHeight);
        if(newMax<=max+3){atBottom++;if(atBottom>=4)break;}else atBottom=0;
      }else atBottom=0;
      const viewHeight=Math.min(b.host.clientHeight||innerHeight,innerHeight);
      const delta=Math.max(80,Math.min(324,Math.floor(viewHeight*BULK_SCROLL_RATIO)));
      b.host.scrollTop=Math.min(b.host.scrollHeight,b.host.scrollTop+delta);
      await sleep(BULK_SCROLL_DELAY);
      if(Math.abs(b.host.scrollTop-lastY)<3&&!bottom)stuck++;else stuck=0;
      lastY=b.host.scrollTop;
      if(stuck>12)throw Error('掃描頁面未能繼續捲動，已停止且本批 0 則上傳');
      passes++;
    }
    if(!isBulkLive(b))return bulkFinish(b,'已停止，本批尚未送出。');
    if(b.endKey&&!b.rows.some(m=>m.bulkKey===b.endKey))throw Error('沒找到指定終點，已停止且本批 0 則上傳');
    if(passes>=5500||Date.now()-begin>=BULK_MAX_DURATION)throw Error('掃描超出單次限制，尚未上傳；請縮小範圍');
    const audit=bulkPairPrefix(b);
    if(b.rows[0]?.role!=='me')throw Error('最終起點不是皮卡發言，拒絕上傳整批');
    if(audit.stop||audit.rows.length!==b.rows.length)throw Error('最後雙向核對失敗：'+(audit.stop||'收錄數量與完整配對數不符')+'，本批 0 則上傳');
    bulkStatus(b,'完成慢速完整性檢查：'+b.rows.length/2+' 組／'+b.rows.length+' 則，皮卡與 GPT 數量一致。準備依序上傳。',{force:true});
    await bulkUpload(b);
  }
  function bulkNew(mode,replay=false){
    const host=bulkHost();
    const b={mode,replay,chat:path(),host,phase:'new',cancelled:false,rows:[],byKey:new Map(),
      started:false,badIdentity:false,gapError:'',identityConflict:'',startProblem:'',uploaded:0,timeTried:new Set(),selectionHandlers:[]};
    state.bulk=b;bulkPanel(b);
    return b;
  }
  async function bulkBeginDown(replay=false){
    if(state.bulk)return {ok:false,error:'已經有一個掃描或選取任務，請先關閉'};
    if(!valid()||!state.enabled||state.watchedPath!==path())return {ok:false,error:'請先綁定輪迴並啟用監看'};
    if(isGenerating())return {ok:false,error:'副駕駛正在生成回覆，請完成後再開始歷史掃描'};
    const b=bulkNew('down',replay);
    // No startKey, no fixed DOM anchor: just scan forward from the viewport.
    // If only GPT text is visible, continue to the next paired player turn.
    bulkStatus(b,'慢速向下掃描；每步保留重疊訊息核對接續，雙向檢查每一則皮卡與 GPT；有缺口立即停止，整批不傳送。',{force:true});
    bulkTraverse(b).catch(e=>bulkFinish(b,'掃描失敗：'+String(e?.message||e)+'。尚未傳送本次掃描結果。',true));
    return {ok:true,preview:'目前畫面（自動向下，不固定起點）'};
  }
  function bulkPreviewRange(b){
    const start=b.rows.findIndex(m=>m.bulkKey===b.startKey);
    const end=b.rows.findIndex(m=>m.bulkKey===b.endKey);
    if(start<0||end<start)return {ok:false,reason:'終點必須在起點之後；請重新選取終點'};
    const temp={rows:b.rows.slice(start,end+1),endKey:null};
    const {rows,stop}=bulkPairPrefix(temp);
    return {ok:true,total:end-start+1,complete:rows.length,stop};
  }
  function bulkHighlightRange(b,hoverTurn=null){
    bulkClearHighlights();
    if(hoverTurn)hoverTurn.setAttribute('data-ga-archive-hover','true');
    if(!b.startKey)return;
    const start=b.rows.findIndex(m=>m.bulkKey===b.startKey);
    const end=b.endKey?b.rows.findIndex(m=>m.bulkKey===b.endKey):start;
    if(start<0)return;
    for(const m of b.rows.slice(start,end+1))bulkTurn(m)?.setAttribute('data-ga-archive-selected','true');
  }
  function bulkChoose(b,entry){
    // A click on the GPT bubble should include its preceding player;
    // a click on the player as the end should include its following GPT.
    const live=collect(),position=live.findIndex(m=>bulkIdentity(m)===bulkIdentity(entry));
    if(position>=0){
      const pair=pairedIndex(live,position);
      if(pair>=0){
        if(!b.startKey && entry.role==='ai')entry=live[pair];
        if(b.startKey && entry.role==='me')entry=live[pair];
      }
    }
    const key=bulkIdentity(entry);if(!key)return;
    if(!b.startKey){
      b.startKey=key;b.startPos=bulkPosition(b.host);b.started=false;
      b.baseOrder=Math.max(0,live.findIndex(m=>bulkIdentity(m)===key));
      bulkHarvest(b);
      bulkStatus(b,'已標記起點。現在可以捲動／拖動畫面，找到終點後再點選。',{force:true});
    }else{
      b.endKey=key;b.endPos=bulkPosition(b.host);
      bulkHarvest(b);
      const preview=bulkPreviewRange(b);
      if(!preview.ok){b.endKey=null;bulkStatus(b,preview.reason,{error:true,force:true});return;}
      b.phase='selected';
      bulkHighlightRange(b);
      bulkDetachSelection(b,false);
      b.pane.querySelector('[data-ga-submit]').hidden=false;
      b.pane.querySelector('[data-ga-caption]').textContent='範圍已選定。確認後會重新逐段向下掃描、檢查配對，再上傳完整回合。';
      bulkStatus(b,`已選擇約 ${preview.total} 則，目前可確認 ${preview.complete/2} 組完整回合。${preview.stop?'\n注意：'+preview.stop:''}`,{force:true});
    }
  }
  function bulkBeginRange(replay=false){
    if(state.bulk)return {ok:false,error:'已有掃描或範圍選取正在進行'};
    if(!valid()||!state.enabled||state.watchedPath!==path())return {ok:false,error:'請先綁定輪迴並啟用監看'};
    const b=bulkNew('range',replay);b.phase='choosing';
    const onClick=e=>{
      if(!isBulkLive(b)||b.phase!=='choosing')return;
      if(b.pane.contains(e.target))return;
      if(b.skipClick){b.skipClick=false;e.preventDefault();e.stopImmediatePropagation();return;}
      const entry=bulkEntry(e.target,!!b.startKey);
      if(!entry)return;
      e.preventDefault();e.stopImmediatePropagation();
      bulkChoose(b,entry);
    };
    const onMove=e=>{
      if(!isBulkLive(b)||b.phase!=='choosing')return;
      if(b.dragStart && Math.hypot(e.clientX-b.dragStart.x,e.clientY-b.dragStart.y)>15)b.dragStart.moved=true;
      const turn=e.target?.closest?.(BULK_SELECTOR);
      if(turn&&!b.pane.contains(e.target))bulkHighlightRange(b,turn);
    };
    const onDown=e=>{
      if(e.button!==0||b.pane.contains(e.target))return;
      const entry=bulkEntry(e.target,false);
      if(entry)b.dragStart={entry,x:e.clientX,y:e.clientY,moved:false};
    };
    const onUp=e=>{
      if(!b.dragStart)return;
      const drag=b.dragStart;b.dragStart=null;
      if(!drag.moved)return;
      const dest=bulkEntry(e.target,true);
      if(!dest)return;
      if(!b.startKey)bulkChoose(b,drag.entry);
      if(b.phase==='choosing'&&bulkIdentity(dest)!==b.startKey)bulkChoose(b,dest);
      b.skipClick=true;
      e.preventDefault();e.stopImmediatePropagation();
    };
    let scrollTimer=null;
    const onScroll=()=>{
      if(scrollTimer)clearTimeout(scrollTimer);
      scrollTimer=setTimeout(()=>{
        if(b.phase==='choosing'&&b.startKey){bulkHarvest(b);bulkHighlightRange(b);}
      },110);
    };
    for(const [type,handler] of [['click',onClick],['pointermove',onMove],['pointerdown',onDown],['pointerup',onUp]]){
      document.addEventListener(type,handler,true);b.selectionHandlers.push([type,handler,true]);
    }
    b.scrollHandler=onScroll;b.host.addEventListener('scroll',onScroll,{passive:true});
    bulkStatus(b,'點選第一個訊息作為起點；可以捲動頁面找到終點。',{force:true});
    return {ok:true};
  }
  async function bulkSubmitRange(b){
    if(!isBulkLive(b)||b.phase!=='selected')return;
    const p=bulkPreviewRange(b);
    if(!p.ok){bulkStatus(b,p.reason,{error:true,force:true});return}
    const {profilesByChat={}}=await chrome.storage.local.get(['profilesByChat']);
    const target=profilesByChat[b.chat];
    const targetName=[target?.worldName,target?.cycleTitle,target?.manager].filter(Boolean).join('／')||target?.cycleId||'未綁定';
    if(isGenerating()){bulkStatus(b,'GPT 仍在生成訊息，請完成後再開始上傳，以免擷取不完整內容。',{error:true,force:true});return;}
    if(!confirm(`確定上傳所選的對話範圍？\n目標：${targetName}\n已確認完整：${p.complete/2} 組\n\n皮卡與 GPT 必須雙向一對一，前後掃描須確認連續，任一方缺漏就拒絕上傳整批。${b.replay?'\n\n注意：本次將重傳已標記傳送的來源，雲端已存在者會去重。':''}`))return;
    b.pane.querySelector('[data-ga-submit]').hidden=true;
    bulkTraverse(b).catch(e=>bulkFinish(b,'範圍掃描失敗：'+String(e?.message||e)+'。尚未傳送本次掃描結果。',true));
  }


  // V0.10.09: independent predecessor conversation capture, no Firebase upload.
  // Source is rendered ChatGPT DOM; not a native/server-side history API.
  const pc=globalThis.GalPredecessorChat;
  const HISTORY_PANEL='ga-predecessor-history-panel';
  function historyRoot(host){return host===document.scrollingElement||host===document.documentElement?document.body:host}
  function historyVisible(el){return !!el?.isConnected&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[aria-hidden="true"],[hidden]')}
  function historyOwner(el){return el.closest('[data-turn-key]')||el.closest('[data-testid^="conversation-turn-"]')||el.closest('[data-message-author-role]')||el}
  function historyLoading(host){
    const root=historyRoot(host),v=bulkViewport(host);
    return [...root.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-testid*="loading"],[class~="animate-spin"]')].some(el=>{
      if(el.closest('#'+HISTORY_PANEL+', [data-message-author-role]'))return false;
      const r=el.getBoundingClientRect();return historyVisible(el)&&r.bottom>=v.top&&r.top<=v.bottom;
    })||isGenerating();
  }

  // The legacy assistantElements() fallback is a *locator*, not the archive
  // source: its text walk has a 30k cutoff. Read the complete rendered suffix
  // of a structurally confirmed composite turn instead, with no length cap.
  const HISTORY_STRUCT='pre,blockquote,table,h1,h2,h3,h4,h5,h6,ul,ol,em,strong,code,del';
  const HISTORY_ATTACHMENT='img,a[href],[data-testid*="attachment"],[data-testid*="file-chip"]';
  const HISTORY_SKIP=FALLBACK_SKIP+', [data-testid="conversation-turn-tools"], [data-testid="turn-actions"], [data-radix-popper-content-wrapper]';
  function historyAttachment(n){
    const src=n.tagName==='IMG'?n.getAttribute('src'):n.tagName==='A'?n.getAttribute('href'):null;
    return {kind:n.tagName==='IMG'?'image-reference':n.tagName==='A'?'link':'attachment-reference',label:n.getAttribute('alt')||n.getAttribute('aria-label')||n.innerText||'',url:src||null};
  }
  function historyIssue(message,owner,details={}){
    const error=Error(message);
    if(owner){
      // Local failure evidence only, never sent to Firebase. Retain enough
      // structure to distinguish an unmarked renderer from a missing turn.
      const text=String(owner.innerText||'');
      error.historyEvidence={turnKey:owner.getAttribute('data-turn-key'),testId:owner.getAttribute('data-testid'),role:owner.getAttribute('data-message-author-role'),tag:owner.tagName,visibleTextLength:text.length,visibleText:text.slice(0,200000),textEvidenceTruncated:text.length>200000,children:[...owner.children].slice(0,60).map(n=>({tag:n.tagName,testId:n.getAttribute('data-testid'),role:n.getAttribute('data-message-author-role'),turnKey:n.getAttribute('data-turn-key'),textLength:String(n.innerText||'').length})),...details};
    }
    return error;
  }
  function historyCompositeRead(owner,users){
    const turn=owner.getAttribute('data-turn-key');
    if(!turn||users.length!==1||!owner.contains(users[0])||users[0]===owner)throw historyIssue('無標記 GPT 回覆缺少唯一玩家邊界或穩定回合 ID',owner,{userBoundaries:users.length});
    const user=users[0],following=Node.DOCUMENT_POSITION_FOLLOWING;
    const after=n=>!user.contains(n)&&!!(user.compareDocumentPosition(n)&following);
    const eligible=n=>{
      if(n.nodeType!==Node.ELEMENT_NODE)return false;
      if(n===user||user.contains(n)||n.closest(HISTORY_SKIP)||isUserDescendant(n))return false;
      const css=getComputedStyle(n);
      return historyVisible(n)||(css.display==='contents'&&css.visibility!=='hidden'&&!n.closest('[aria-hidden="true"],[hidden]'));
    };
    const pieces=[],structures=[],attachments=[],segments=[],textNodes=[];
    let anchor=null,lastBlock=null;
    const blockFor=n=>{
      for(let x=n;x&&x!==owner;x=x.parentElement){
        const display=getComputedStyle(x).display;
        if(/^(block|list-item|table|table-row|flex|grid|flow-root|table-cell)/.test(display)&&display!=='inline-block')return x;
        if(x.matches('p,pre,li,blockquote,h1,h2,h3,h4,h5,h6,tr'))return x;
      }
      return owner;
    };
    const emit=(n,value,hardBreak=false)=>{
      const parent=n.nodeType===Node.TEXT_NODE?n.parentElement:n;
      if(!parent||!value)return;
      if(!anchor&&value.trim())anchor=parent;
      const block=blockFor(parent);
      if(lastBlock&&lastBlock!==block&&pieces.length&&!pieces.at(-1).endsWith('\n'))pieces.push('\n');
      pieces.push(value);lastBlock=block;
      if(!hardBreak){textNodes.push(value);segments.push({tag:parent.tagName.toLowerCase(),text:value})}
    };
    const visit=n=>{
      if(n.nodeType===Node.TEXT_NODE){
        if(after(n)&&eligible(n.parentElement)){
          // Preserve exact text-node characters; indentation-only DOM nodes
          // are not rendered prose unless inside pre/code or inline siblings.
          const v=n.nodeValue||'';
          if(v.trim()||n.parentElement.closest('pre,code')||(!/[\r\n]/.test(v)&&v.length))emit(n,v);
        }
        return;
      }
      if(n.nodeType!==Node.ELEMENT_NODE||n===user||user.contains(n))return;
      if(n===owner||n.contains(user)){
        for(const ch of n.childNodes)visit(ch);
        return;
      }
      if(!after(n)||!eligible(n))return;
      // Only remove explicit role headings outside an actual prose block;
      // literal "ChatGPT 說" inside p/pre/code remains ordinary content.
      if(n.matches('h1,h2,h3,h4,h5,h6,[data-testid="message-author-label"]')&&RESPONSE_LABEL.test(String(n.innerText||'').trim()))return;
      if(n.matches('br')){emit(n,'\n',true);return}
      if(n.matches(HISTORY_STRUCT))structures.push({tag:n.tagName.toLowerCase(),text:n.innerText||n.textContent||''});
      if(n.matches(HISTORY_ATTACHMENT)){attachments.push(historyAttachment(n));if(!anchor)anchor=n}
      for(const ch of n.childNodes)visit(ch);
    };
    visit(owner);
    const text=pieces.join('');
    if(!anchor||(!text.trim()&&!attachments.length))throw historyIssue('玩家之後未找到可證明的 GPT 渲染內容',owner,{userBoundaries:users.length});
    if(!text.trim()&&attachments.every(x=>x.kind==='link'))throw historyIssue('玩家之後只有連結，無法確認 GPT 正文',owner);
    return {anchor,text,structure:structures,attachments,segments,sourceTextNodes:textNodes.length,sourceTextCharacters:textNodes.reduce((n,v)=>n+v.length,0)};
  }

  function historyRead(host){
    const root=historyRoot(host),entries=[],owners=new Map(),explicit=[];
    const add=(role,el,body,identityHint,fallback=false)=>{
      if(!el||!body||!root.contains(el)||!historyVisible(el))return;
      const owner=historyOwner(el),native=el.closest('[data-message-id]')?.getAttribute('data-message-id')||el.getAttribute('data-message-id')||body.getAttribute('data-dil-message-id')||el.closest('[data-source-message-id]')?.getAttribute('data-source-message-id');
      const turn=owner.getAttribute('data-turn-key'); // data-testid ordinal alone is not a source ID
      if(fallback){
        if(role!=='assistant'||el!==owner)throw historyIssue('備援 GPT 容器與回合不符',owner);
        const proof=historyCompositeRead(owner,outerUsers().filter(u=>owner.contains(u)&&historyVisible(u)));
        const stable='assistant|turn:'+turn;
        const row={id:stable,role:'assistant',text:proof.text,identityBasis:'turn-key',sourceCreatedAt:null,structure:proof.structure,attachments:proof.attachments,contentBasis:'composite-after-user-dom',sourceTextNodes:proof.sourceTextNodes,sourceTextCharacters:proof.sourceTextCharacters,domTextSegments:proof.segments};
        const sameOwner=owners.get(owner)||[];
        if(sameOwner.some(x=>x.row.id===stable))throw historyIssue('重複備援 GPT 回合 ID',owner);
        const item={row,el:proof.anchor,owner};sameOwner.push(item);owners.set(owner,sameOwner);entries.push(item);
        return;
      }
      if(!native&&!turn)throw historyIssue('訊息缺少穩定來源 ID（禁止使用畫面位置）',owner,{role});
      const roleMarker=el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role');
      if(roleMarker&&roleMarker!==role)throw historyIssue('角色標記衝突',owner,{role,roleMarker});
      const stable=role+'|'+(native?'message:'+native:'turn:'+turn);
      const text=body.innerText||''; // preserve literal text; do not strip an apparent UI label
      if(TRUNCATED_TAIL.test(text)&&expandButtons(owner).length)throw Error('原始訊息仍折疊');
      const structure=[...body.querySelectorAll(HISTORY_STRUCT)].filter(historyVisible).map(n=>({tag:n.tagName.toLowerCase(),text:n.innerText||n.textContent||''}));
      const attachments=[...el.querySelectorAll(HISTORY_ATTACHMENT)].filter(historyVisible).map(historyAttachment);
      if(!text&&!attachments.length)throw Error('空白回合未能確認內容／附件');
      const row={id:stable,role,text,identityBasis:native?'native-dom-id':'turn-key',sourceCreatedAt:getVisibleSourceTime(el),structure,attachments};
      const sameOwner=owners.get(owner)||[];
      if(sameOwner.some(x=>x.row.id===stable))throw Error('重複原生訊息 ID');
      sameOwner.push({row,el,owner});owners.set(owner,sameOwner);entries.push({row,el,owner});
    };
    // Explicit author-role roots take precedence, including attachment-only messages.
    for(const el of root.querySelectorAll('[data-message-author-role]')){
      if(el.parentElement?.closest('[data-message-author-role]')||!historyVisible(el))continue;
      const role=el.getAttribute('data-message-author-role');
      if(!['user','assistant'].includes(role))throw Error('遇到未支援的明確訊息角色：'+role);
      const candidates=role==='user'?[...el.querySelectorAll(USER_BUBBLE_SELECTOR+', .whitespace-pre-wrap')]:[...el.querySelectorAll('[data-markdown-copy="contents"],.markdown,[data-dil-message-id]')];
      const roots=candidates.filter(n=>!candidates.some(other=>other!==n&&other.contains(n)));
      // A role root with multiple separate content bodies must be preserved
      // in full rather than selecting just the first Markdown/DIL segment.
      const body=roots.length===1?roots[0]:el;
      add(role,el,body,null);explicit.push({el,role,owner:historyOwner(el)});
    }
    // Existing known ChatGPT layouts, but no text-based deduplication or
    // fallback text extraction (the legacy fallback truncates at 30k).
    for(const el of [...outerUsers(),...assistantElements()]){
      const role=isUserDescendant(el)?'user':'assistant',owner=historyOwner(el);
      if(!root.contains(el)||!historyVisible(el))continue;
      const matching=explicit.filter(x=>x.role===role&&(x.el.contains(el)||el.contains(x.el)||x.owner===owner));
      if(matching.length){if(matching.length>1&&!matching.some(x=>x.el.contains(el)))throw Error('回合內多個同角色來源無法唯一核對');continue}
      const body=role==='user'?(el.querySelector(USER_BUBBLE_SELECTOR)||el):el;
      add(role,el,body,null,role==='assistant'&&assistantFallbackTexts.has(el));
    }
    // A mounted, visible turn with no captured role must never be silently skipped.
    const turns=[...root.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"]')].filter(el=>
      !el.parentElement?.closest('[data-turn-key],[data-testid^="conversation-turn-"]')&&historyVisible(el)&&
      (el.hasAttribute('data-turn-key')||/^conversation-turn-\d+$/.test(el.getAttribute('data-testid')||'')));
    for(const turn of turns)if(!entries.some(x=>turn.contains(x.el)||x.owner===turn))throw historyIssue('已掛載回合未辨識到完整訊息',turn);
    entries.sort((a,b)=>{
      // Direct text after a user may be anchored to the composite owner
      // itself; its ancestor DOM position must never reverse the two roles.
      if(a.owner===b.owner&&a.row.role!==b.row.role&&[a.row.contentBasis,b.row.contentBasis].includes('composite-after-user-dom'))return a.row.role==='user'?-1:1;
      if(a.el===b.el)return 0;
      return a.el.compareDocumentPosition(b.el)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;
    });
    for(const group of owners.values())if(group.some(x=>x.row.contentBasis==='composite-after-user-dom')&&(group.filter(x=>x.row.role==='user').length!==1||group.filter(x=>x.row.role==='assistant').length!==1))throw historyIssue('備援 GPT 與玩家來源無法形成唯一回合',group[0].owner);
    const rows=entries.map(x=>x.row);pc.validateRows(rows);
    if(!rows.length)throw Error('尚未讀到對話訊息');
    return rows;
  }
  function historyEdgeOrdinal(b,edge){
    // Only explicit accessibility list metadata is strong enough to reject
    // an apparent edge. Never infer total count from a testid or text length.
    const nodes=[...historyRoot(b.host).querySelectorAll('[aria-posinset][aria-setsize]')].filter(n=>historyVisible(n)&&(n.hasAttribute('data-turn-key')||n.hasAttribute('data-message-author-role')||/^conversation-turn-\d+$/.test(n.getAttribute('data-testid')||'')));
    if(!nodes.length)return {};
    const n=edge==='top'?nodes[0]:nodes.at(-1),position=Number(n.getAttribute('aria-posinset')),total=Number(n.getAttribute('aria-setsize'));
    return position>0&&total>=position&&Number.isInteger(position)&&Number.isInteger(total)?{position,total}:{};
  }
  async function historySettled(b){
    const until=Date.now()+60000;let last=null,lastAt=0,reason='';
    while(Date.now()<until){
      historyGuard(b);
      if(historyLoading(b.host)){last=null;reason='等待載入轉圈';}
      else{
        try{
          const root=historyRoot(b.host);
          const controls=[...root.querySelectorAll('[data-turn-key],[data-message-author-role]')].filter(historyVisible).flatMap(expandButtons);
          if(controls.length){for(const c of [...new Set(controls)].slice(0,12)){if(!c.disabled)c.click()}last=null;reason='等待長訊息展開';}
          else{
            const rows=historyRead(b.host),fingerprint=JSON.stringify(rows);
            if(last===fingerprint&&Date.now()-lastAt>=550)return rows;
            if(last!==fingerprint){last=fingerprint;lastAt=Date.now()}
            reason='等待原文與格式穩定';
          }
        }catch(e){last=null;reason=String(e.message||e);b.lastReadIssue={at:new Date().toISOString(),reason,scrollTop:b.host.scrollTop,scrollHeight:b.host.scrollHeight,evidence:e.historyEvidence||null}}
      }
      historyStatus(b,reason+'（最多等待60秒）');await sleep(650);
    }
    throw Error('等待逾時：'+reason);
  }
  function historyGuard(b){
    if(b.cancelled)throw Error('使用者停止');
    if(state.bulk!==b||!valid()||path()!==b.chat||!b.host.isConnected)throw Error('聊天來源或捲動容器已變更');
  }
  function historyStatus(b,msg){
    b.info.textContent=msg+'\n已保全 '+b.rows.length+' 則；不會上傳 Firebase。';
  }
  function historyAtBottom(host){return host.scrollHeight-host.clientHeight-host.scrollTop<=6}
  function historyScroll(host,at){host.scrollTo({top:Math.max(0,at),behavior:'instant'})}
  function historyPayload(b,status,error){
    const rows=b.rows.map((r,index)=>({...r,index})),warnings=[];
    for(let i=0;i<rows.length;i++)if((i===0&&rows[i].role!=='user')||(i>0&&rows[i].role===rows[i-1].role))warnings.push('角色序列需人工確認：原始索引 '+i+'（保留，不猜測配對）');
    if(rows.at(-1)?.role==='user')warnings.push('尾端玩家尚無 GPT 回覆；原樣保留');
    if(rows.some(r=>r.attachments.length))warnings.push('附件僅保留可見名稱／連結參照，未證明附件原始位元組已保存');
    if(rows.some(r=>r.contentBasis==='composite-after-user-dom'))warnings.push('無標記 GPT 回覆以唯一玩家邊界後的完整 DOM 文字節點讀取；保留分段證據，非伺服器原始 Markdown');
    return {format:pc.FORMAT,version:1,canonical:false,fidelity:'rendered-dom',status,runId:b.runId,title:b.title,chatId:b.chat.split('/').at(-1),sourceUrl:location.origin+b.chat,startedAt:b.startedAt,finishedAt:new Date().toISOString(),scannerVersion:chrome.runtime.getManifest().version,count:rows.length,rows,warnings,error:error||null,evidence:{bottomReached:b.bottomReached,topReached:b.topReached,bottomStableMs:b.bottomStableMs,topStableMs:b.topStableMs,continuity:status==='completed',firstId:rows[0]?.id||null,lastId:rows.at(-1)?.id||null,windows:b.windows,coverage:'rendered-branch-only; no independent server manifest',lastReadIssue:status==='completed'?null:b.lastReadIssue||null}};
  }
  function historyDownload(data){
    const file=(data.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').slice(0,95)||'未命名聊天')+'_'+data.chatId+'_'+data.runId+'_'+data.status+'.json';
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='前輩聊天_'+file;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return a.download;
  }
  async function historyRun(b){
    let status='failed',error=null;
    try{
      historyStatus(b,'定位聊天最底端');
      let stable=0,prev=null,bottomDeadline=Date.now()+60000;
      for(;;){
        historyGuard(b);if(Date.now()>bottomDeadline)throw Error('60秒內無法確認完整底端');
        historyScroll(b.host,b.host.scrollHeight);const rows=await historySettled(b);
        const sig=JSON.stringify([rows,b.host.scrollHeight]);
        if(historyAtBottom(b.host)&&sig===prev){if(!stable)stable=Date.now();if(pc.edgeProof(rows,rows,{edge:'bottom',atEdge:true,stableMs:Date.now()-stable,loading:historyLoading(b.host),...historyEdgeOrdinal(b,'bottom')})){b.bottomStableMs=Date.now()-stable;b.bottomReached=true;b.rows=pc.mergeUp([],rows);b.windows++;break}}
        else{stable=0;prev=sig}
        // Keep the most recent observed tail as emergency evidence only.
        b.rows=rows;await sleep(650);
      }
      let topSince=0,topSignature=null,stallAt=Date.now(),lastCount=b.rows.length,edgeAttempt=0;
      for(;;){
        historyGuard(b);
        const pos=b.host.scrollTop,step=Math.max(24,Math.floor(b.host.clientHeight*.27));
        let rows=null,lastError='';
        // Small upward steps, then return toward the last confirmed position
        // and retry with a smaller step if virtualized windows lose overlap.
        for(const ratio of [1,.5,.25,0]){
          historyGuard(b);historyScroll(b.host,pos-step*ratio);
          await sleep(480);
          rows=await historySettled(b);
          try{b.rows=pc.mergeUp(b.rows,rows);b.windows++;lastError='';break}catch(e){lastError=String(e.message||e);rows=null}
        }
        if(!rows)throw Error('無法核對前後視窗連續性：'+lastError);
        historyStatus(b,'向上掃描');
        const atTop=b.host.scrollTop<=2,sig=JSON.stringify([rows[0]?.id,b.rows.length,b.host.scrollHeight]);
        if(atTop){
          if(!edgeAttempt)edgeAttempt=Date.now();
          if(sig!==topSignature){topSignature=sig;topSince=Date.now()}
          if(pc.edgeProof(rows,b.rows,{edge:'top',atEdge:true,stableMs:Date.now()-topSince,loading:historyLoading(b.host),...historyEdgeOrdinal(b,'top')})){b.topReached=true;b.topStableMs=Date.now()-topSince;status='completed';break}
          if(Date.now()-edgeAttempt>60000)throw Error('頁面已在頂端，但首則訊息或頂端穩定證據不符');
        }else{topSince=0;topSignature=null;edgeAttempt=0}
        if(b.rows.length!==lastCount||Math.abs(pos-b.host.scrollTop)>2){lastCount=b.rows.length;stallAt=Date.now()}
        else if(!atTop&&Date.now()-stallAt>60000)throw Error('向上捲動超過60秒無進展');
        await sleep(480);
      }
    }catch(e){error=String(e.message||e);status=b.cancelled?'cancelled':'failed'}
    const data=historyPayload(b,status,error);
    try{pc.validateRaw(data)}catch(e){data.status='failed';data.error='輸出核對失敗：'+String(e.message||e);data.evidence.continuity=false}
    b.download.onclick=()=>{try{historyStatus(b,'已觸發下載：'+historyDownload(data))}catch(e){historyStatus(b,'下載觸發失敗，請重試：'+e.message)}};
    b.download.hidden=false;b.stop.textContent='關閉';b.stop.onclick=()=>b.pane.remove();
    if(state.bulk===b)state.bulk=null;
    try{historyStatus(b,(data.status==='completed'?'已抵達頂端；':'未完成：'+data.error+'；')+'已觸發下載 '+historyDownload(data)+'\n請核對下載檔，亦可按重新下載。')}
    catch(e){historyStatus(b,'保全已留在本頁，下載觸發失敗：'+e.message)}
  }
  async function historyBegin(requestedTitle){
    if(!pc||!valid())return {ok:false,error:'請開啟具體 ChatGPT 聊天並載入新版'};
    if(state.bulk||state.scanning||state.activeSends||state.timeBusy||isGenerating())return {ok:false,error:'此聊天正在監看擷取、掃描或生成，稍後再開始'};
    if(document.getElementById(HISTORY_PANEL))return {ok:false,error:'前一批保全仍在頁面，請確認下載並關閉面板後再開始'};
    const title=String(requestedTitle||document.title||'').replace(/\s*[-–|]\s*ChatGPT\s*$/i,'').trim();
    if(!title||title==='ChatGPT'||title.length>512)return {ok:false,error:'請輸入聊天的實際名稱'};
    const host=bulkHost();if(!host)return {ok:false,error:'找不到聊天捲動容器'};
    const b={mode:'predecessor-history',chat:path(),title,host,rows:[],runId:crypto.randomUUID(),startedAt:new Date().toISOString(),bottomReached:false,topReached:false,bottomStableMs:0,topStableMs:0,windows:0,cancelled:false};
    state.bulk=b;
    try{
      // Disable only this chat's existing automatic upload so scrolling over
      // historical messages cannot upload them after the scan ends.
      const {watch={}}=await chrome.storage.local.get(['watch']);
      if(watch[b.chat]===true){delete watch[b.chat];await chrome.storage.local.set({watch})}
      state.enabled=false;state.watchedPath=null;candidates.clear();
      historyGuard(b);
      document.getElementById(HISTORY_PANEL)?.remove();
      const pane=document.createElement('section');pane.id=HISTORY_PANEL;
      pane.style.cssText='position:fixed;z-index:2147483646;right:12px;top:12px;width:min(360px,90vw);background:#202840;color:#fff;border:1px solid #9ba9cb;padding:14px;border-radius:12px;font:14px system-ui;box-shadow:0 3px 20px #0006';
      const h=document.createElement('strong');h.textContent='前輩完整聊天・向上掃描';
      b.info=document.createElement('pre');b.info.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:10px 0';
      b.stop=document.createElement('button');b.stop.textContent='停止並保全';b.stop.onclick=()=>{b.cancelled=true};
      b.download=document.createElement('button');b.download.textContent='重新下載 JSON';b.download.hidden=true;
      pane.append(h,b.info,b.stop,b.download);document.body.append(pane);b.pane=pane;
      historyRun(b);return {ok:true,title};
    }catch(e){if(state.bulk===b)state.bulk=null;return {ok:false,error:String(e.message||e)}}
  }


  // In-page entry: browser automation need not access Chrome toolbar popups.
  const HISTORY_LAUNCHER='ga-predecessor-page-launcher',HISTORY_CONFIG='ga-predecessor-page-config';
  function historyLauncher(){
    const existing=document.getElementById(HISTORY_LAUNCHER);
    const config=document.getElementById(HISTORY_CONFIG);
    if(config&&config.dataset.chat!==path())config.remove();
    if(!valid()){
      existing?.remove();
      return;
    }
    if(existing)return;
    const button=document.createElement('button');
    button.id=HISTORY_LAUNCHER;button.type='button';
    button.textContent='📚 前輩聊天掃描';
    button.setAttribute('aria-label','開啟前輩聊天掃描助手');
    button.title='獨立 ChatGPT 完整聊天 JSON 掃描';
    button.style.cssText='position:fixed!important;right:18px!important;bottom:108px!important;z-index:2147483645!important;padding:10px 14px!important;min-height:42px!important;border:1px solid #c0afff!important;border-radius:12px!important;background:#5145a4!important;color:white!important;font:600 14px system-ui,sans-serif!important;box-shadow:0 3px 16px #0005!important;cursor:pointer!important;touch-action:manipulation!important';
    button.onclick=()=>{
      const active=document.getElementById(HISTORY_PANEL);
      if(active){active.scrollIntoView({block:'nearest'});return}
      if(document.getElementById(HISTORY_CONFIG)){document.getElementById(HISTORY_CONFIG).remove();return}
      const pane=document.createElement('section');pane.id=HISTORY_CONFIG;pane.dataset.chat=path();
      pane.setAttribute('role','dialog');pane.setAttribute('aria-label','前輩完整聊天掃描設定');
      pane.style.cssText='position:fixed!important;right:18px!important;bottom:160px!important;z-index:2147483646!important;width:min(360px,calc(100vw - 36px))!important;background:#202840!important;color:white!important;border:1px solid #9ba9cb!important;padding:14px!important;border-radius:12px!important;font:14px system-ui,sans-serif!important;box-shadow:0 3px 20px #0006!important';
      const heading=document.createElement('strong');heading.textContent='前輩完整聊天掃描';
      const version=document.createElement('p');version.textContent='V'+chrome.runtime.getManifest().version+'｜獨立 JSON，不上傳正史';
      const label=document.createElement('label');label.textContent='聊天名稱（請確認）';label.htmlFor='ga-predecessor-page-title';
      const input=document.createElement('input');input.id='ga-predecessor-page-title';input.type='text';input.maxLength=512;
      input.value=String(document.title||'').replace(/\s*[-–|]\s*ChatGPT\s*$/i,'').trim();
      if(input.value==='ChatGPT')input.value='';
      input.style.cssText='display:block;width:100%;margin:6px 0 12px;padding:8px;background:#111827;color:white;border:1px solid #9ba9cb;border-radius:7px';
      const note=document.createElement('p');note.textContent='先定位底端，向上掃描至頂端。載入最多等待60秒；本聊天的原監看將停止。不需要綁定輪迴。';
      const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.style.whiteSpace='pre-wrap';
      const start=document.createElement('button');start.type='button';start.id='ga-predecessor-page-start';start.textContent='↑ 從最底端向上完整掃描';
      start.style.cssText='display:block;width:100%;padding:10px;background:#6456b8;color:white;border:1px solid #c0afff;border-radius:8px;cursor:pointer';
      const close=document.createElement('button');close.type='button';close.textContent='關閉';close.style.cssText='margin-top:8px;padding:7px 12px;background:#374151;color:white;border-radius:7px;cursor:pointer';
      close.onclick=()=>pane.remove();
      start.onclick=async()=>{
        if(pane.dataset.chat!==path()){pane.remove();return}
        if(!input.value.trim()){feedback.textContent='請填寫聊天實際名稱';return}
        start.disabled=true;close.disabled=true;feedback.textContent='正在開啟掃描…';
        try{
          const result=await historyBegin(input.value.trim());
          if(result?.ok){pane.remove();return}
          feedback.textContent='⛔ '+(result?.error||'無法啟動掃描');
        }catch(e){feedback.textContent='⛔ '+String(e.message||e)}
        finally{start.disabled=false;close.disabled=false}
      };
      pane.append(heading,version,label,input,note,start,close,feedback);document.body.append(pane);
    };
    document.body.append(button);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if(message?.type==='predecessor-history-up'){historyBegin(message.title).then(respond,e=>respond({ok:false,error:String(e.message||e)}));return true}
    if(state.bulk?.mode==='predecessor-history'&&['bulk-down','bulk-range','backfill-visible','begin-watch','end-watch','test-last-time'].includes(message?.type)){respond({ok:false,error:'前輩聊天掃描中，不得開始其他操作'});return;}

    if(message?.type==='bulk-down'){
      bulkBeginDown(message.replay===true).then(respond,e=>respond({ok:false,error:String(e?.message||e)}));
      return true;
    }
    if(message?.type==='bulk-range'){
      respond(bulkBeginRange(message.replay===true));
      return;
    }
    if (message?.type === 'diagnostics') {
      noteStatus();
      respond({ ok: true, ...diagnostics });
      return;
    }
    if(message?.type==='test-last-time'){
      if(!valid()){respond({ok:false,reason:'請在 ChatGPT 對話中測試'});return;}
      const list=collect().filter(m=>m.text);
      const last=list.at(-1);
      if(!last){respond({ok:false,reason:'沒有可辨識的訊息'});return;}
      captureMenuTime(last).then(result=>{
        diagnostics.timeResults=result.ok?`抓取成功：${result.text}`:`擷取失敗：${result.reason}`;
        if(!result.ok)recordCapture({status:'failed',role:last.role,preview:last.text.slice(0,65),detail:result.reason});
        respond(result);
      }).catch(e=>respond({ok:false,reason:String(e)}));
      return true;
    }
    if (message?.type === 'backfill-visible') {
      if (!valid() || !state.enabled || state.watchedPath !== path()) {
        respond({ok:false,error:'請先在這個 ChatGPT 對話啟用監看'});return;
      }
      (async()=>{
        // Expand all currently-loaded lengthy bubbles BEFORE taking a snapshot.
        // Stop rather than importing a deceptively clean, cut-off excerpt.
        for(let pass=0;pass<25;pass++){
          const opened=await expandCollapsed(8);
          if(!opened)break;
        }
        const messages=noteStatus();
        if(diagnostics.detectWarning)return {ok:false,error:diagnostics.detectWarning};
        const collapsed=messages.filter(isCollapsed);
        if(collapsed.length)return {ok:false,error:`仍有 ${collapsed.length} 則長訊息尚未展開（...／顯示較多）。尚未開始回補；請手動展開後重試，以免遺失劇情。`,collapsedCount:collapsed.length};
        let queued=0,tooLong=0;
        for(const m of messages.slice(0,200)){
          const k=keyOf(m);
          if(!m.text)continue;
          if(m.text.length>25000){tooLong++;continue}
          if(delivered.has(k))continue;
          baselineIds.delete(k);
          candidates.set(k,{text:m.text,lastChanged:Date.now()-7000,sending:false,retryAfter:0});
          queued++;
        }
        scan();
        return {ok:true,queued,tooLong,limited:Math.max(0,messages.length-200),messageCount:messages.length,userCount:messages.filter(m=>m.role==='me').length,aiCount:messages.filter(m=>m.role==='ai').length,expanded:diagnostics.expansionStatus||''};
      })().then(respond,e=>respond({ok:false,error:'展開／回補失敗：'+String(e.message||e)}));
      return true;
    }
    if (message?.type === 'begin-watch') {
      state.previousPath = path();
      state.watchedPath = path();
      state.enabled = true;
      baseline();
      respond({ ok: true, baseline: baselineIds.size });
      return;
    }
    if (message?.type === 'end-watch') {
      state.enabled = false;
      state.watchedPath = null;
      baseline();
      respond({ ok: true });
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if(area==='local' && (changes.watch||changes.autoTimeCapture)) syncWatch().catch(err=>diagnostics.error=String(err));
  });
  setInterval(async () => {
    historyLauncher();
    if (state.scanning || state.bulk) return;
    state.scanning = true;
    try { await syncWatch(); await scan(); }
    catch (e) { diagnostics.error = String(e?.message || e); }
    finally { state.scanning = false; }
  }, 1200);
  historyLauncher();
  syncWatch().catch(e => diagnostics.error = String(e));
})();