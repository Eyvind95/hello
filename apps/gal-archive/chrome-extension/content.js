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
  // Unlike legacy bulkHost(), never accept the document fallback solely
  // because it exists. A virtualized chat may not have hydrated yet.
  function historyHost(){
    const turns=[...document.querySelectorAll('[data-turn-key],[data-message-author-role],[data-testid^="conversation-turn-"]')].filter(historyVisible);
    const anchors=turns.length?turns:outerUsers().filter(historyVisible);
    if(!anchors.length)return null;
    const first=anchors[0];
    for(let n=first.parentElement;n;n=n.parentElement){
      if(!anchors.every(x=>n.contains(x)))continue;
      const css=getComputedStyle(n);
      if(n.clientHeight>180&&pc.scrollRange(n.scrollHeight,n.clientHeight)>8&&(/(auto|scroll|overlay)/.test(css.overflowY)||n===document.scrollingElement))return n;
    }
    return null;
  }
  function historyHostObservation(b){
    const h=b.host,proof=b.hostProof;
    if(!h||!proof)return;
    proof.maxRange=Math.max(proof.maxRange,pc.scrollRange(h.scrollHeight,h.clientHeight));
    if(proof.lastTop!==null&&Math.abs(h.scrollTop-proof.lastTop)>2)proof.observedMovement=true;
    proof.lastTop=h.scrollTop;
    proof.lastHeight=h.scrollHeight;proof.clientHeight=h.clientHeight;
  }
  async function historyLocateHost(b){
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      if(b.cancelled)throw Error('使用者停止');
      if(state.bulk!==b||!valid()||path()!==b.chat)throw Error('聊天來源已變更');
      const host=historyHost();
      if(host){
        b.host=host;b.hostProof={maxRange:0,observedMovement:false,lastTop:null,tag:host.tagName||'',id:host.id||'',initialHeight:host.scrollHeight,clientHeight:host.clientHeight};
        historyHostObservation(b);historyTrace(b,'host-selected');return;
      }
      historyStatus(b,'等待有效聊天捲動容器（最多60秒）');await sleep(500);
    }
    // Read only the currently mounted tail for emergency evidence; never
    // certify a boundary from a non-scrollable or unverified container.
    try{b.rows=historyRead(b.host,observation=>historyFoldObservation(b,observation))}catch(e){b.lastReadIssue={reason:String(e.message||e)}}
    throw Error('60秒內找不到有效聊天捲動容器；禁止假完成');
  }
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
    // Images are outside the predecessor text archive. The transient marker
    // is used only to retain the native identity of an image-only turn.
    if(n.tagName==='IMG'||(n.querySelector?.('img')&&!n.querySelector?.('[data-testid*="file-chip"]')&&!String(n.innerText||'').trim()))return {kind:'image-reference',label:'',url:null};
    const src=n.tagName==='A'?n.getAttribute('href'):null;
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
    // Composite fallback also fails closed if its text walk missed code.
    const codeCounts=new Map();for(const z of structures)if(z.tag==='code'&&z.text.trim())codeCounts.set(z.text,(codeCounts.get(z.text)||0)+1);
    for(const [value,n] of codeCounts)if(text.split(value).length-1<n)throw historyIssue('備援 GPT 正文與程式碼框不一致',owner,{codeText:value,expectedOccurrences:n});
    if(!anchor||(!text.trim()&&!attachments.length))throw historyIssue('玩家之後未找到可證明的 GPT 渲染內容',owner,{userBoundaries:users.length});
    if(!text.trim()&&attachments.every(x=>x.kind==='link'))throw historyIssue('玩家之後只有連結，無法確認 GPT 正文',owner);
    return {anchor,text,structure:structures,attachments,segments,sourceTextNodes:textNodes.length,sourceTextCharacters:textNodes.reduce((n,v)=>n+v.length,0)};
  }

  // The predecessor scanner is read-only except for scrolling. A collapsed
  // preview is often a CSS clip; never click it to change the live layout.
  function historyReadText(body,owner,id,onFold){
    const raw=body.innerText||'';
    const controls=[...new Set([...expandButtons(owner),...owner.querySelectorAll('button,[role="button"],a,[tabindex],[class*="cursor-pointer"],[class*="cursor-interaction"]')].filter(c=>historyVisible(c)&&/^(?:顯示較少|顯示較多|顯示更多|顯示全部|展開全文|Show less|Show more|Read more)$/i.test(String(c.innerText||c.textContent||c.getAttribute('aria-label')||'').trim())))];
    let text=raw,removed=false;
    for(const control of controls){
      const label=String(control.innerText||control.textContent||control.getAttribute('aria-label')||'').trim();
      let removedSuffix='';
      // Strip only an actual trailing UI node in this body. Literal prose
      // with the same words, or a control outside the body, is preserved.
      if(!removed&&body!==control&&body.contains(control)){
        const range=document.createRange();
        range.setStartAfter(control);range.setEnd(body,body.childNodes.length);
        if(!range.toString().trim()&&text.endsWith('\n'+label)){
          removedSuffix='\n'+label;text=text.slice(0,-removedSuffix.length);removed=true;
        }
      }
      onFold({messageId:id,label,collapsed:EXPAND_LABEL.test(label),rawLength:raw.length,removedSuffix,fullTextVerified:false});
    }
    return text;
  }
  // Current ChatGPT fallback-turn renderer exposes a complete assistant
  // response body; nested copy-contents spans may merely be file citations.
  // Require corroborating role and ID evidence instead of choosing a citation.
  function historyResponseIdentity(body,owner,allowComposite=false){
    const id=body.getAttribute('data-response-body');
    const unit=body.closest('[data-chatgpt-search-unit-key]');
    const unitKey=unit?.getAttribute('data-chatgpt-search-unit-key')||'';
    const declaredIds=String(unit?.getAttribute('data-chatgpt-search-message-ids')||'').trim().split(/\s+/).filter(Boolean);
    const unitIds=[...new Set(declaredIds)];
    const selection=[...new Set([...body.querySelectorAll('[data-chatgpt-selection-message-id]')].map(n=>n.getAttribute('data-chatgpt-selection-message-id')).filter(Boolean))];
    const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]+$/.test(x);
    const diagnostic=()=>{
      const markers=owner.querySelectorAll?[...owner.querySelectorAll('[data-response-body],[data-chatgpt-search-unit-key],[data-chatgpt-selection-message-id],[data-message-id],[data-message-author-role]')]:[];
      const max=120000;
      const html=String(owner.outerHTML||'');
      return {responseBodyId:id,unitKey,unitIds,selection,identityMarkers:markers.slice(0,100).map(n=>({
        tag:n.tagName,bodyId:n.getAttribute('data-response-body'),unitKey:n.getAttribute('data-chatgpt-search-unit-key'),
        unitIds:n.getAttribute('data-chatgpt-search-message-ids'),selectionId:n.getAttribute('data-chatgpt-selection-message-id'),
        messageId:n.getAttribute('data-message-id'),role:n.getAttribute('data-message-author-role'),
        visible:historyVisible(n),textLength:String(n.innerText||'').length
      })),identityMarkerOverflow:Math.max(0,markers.length-100),ownerHtml:html.slice(0,max),ownerHtmlTruncated:html.length>max};
    };
    const fail=()=>{throw historyIssue('明確 GPT 正文的角色或原生訊息 ID 無法唯一核對',owner,diagnostic())};
    if(!validId(id)||!unit||!owner.contains(unit)||!unitKey.endsWith(':assistant')||!unitIds.includes(id)||unitIds.some(x=>!validId(x))||selection.some(x=>x!==id)||isUserDescendant(body))fail();
    if(unitIds.length===1)return id;
    // Multiple IDs are valid only if every ID has exactly one separate,
    // visible, non-nested response body in this same assistant unit.
    // Never treat a list of IDs as proof of separate content or branches.
    const bodies=unit.querySelectorAll?[...unit.querySelectorAll('[data-response-body]')]:[];
    const ids=bodies.map(n=>n.getAttribute('data-response-body'));
    // Observed CAT-0028 layout: a completed turn, two distinct declared IDs
    // (first duplicated), one assistant body and one markdown root. Keep the
    // rendered unit intact as evidence, never infer a native message boundary.
    if(allowComposite&&bodies.length===1&&bodies[0]===body&&unitIds.length===2&&
       declaredIds.length===3&&declaredIds[0]===id&&declaredIds[1]===id&&declaredIds[2]===unitIds[1]&&
       selection.length===0&&historyVisible(body)&&body.parentElement===unit&&
       unit.getAttribute('data-content-search-unit-key')===unitKey&&
       unit.querySelectorAll('[data-conversation-role]').length===1&&
       unit.querySelectorAll('[data-conversation-role]')[0].getAttribute('data-conversation-role')==='assistant'&&
       body.querySelectorAll('[data-markdown-text-style="assistant-message"]').length===1&&
       unit.querySelectorAll('[data-message-id],[data-source-message-id],[data-dil-message-id],[data-chatgpt-selection-message-id],[data-message-author-role]').length===0&&
       owner.querySelectorAll('[data-talvt-turn-state="complete"]').length===1){
      const turnId=owner.getAttribute('data-turn-key'),html=String(owner.outerHTML||'');
      if(validId(turnId)&&html.length>0&&html.length<=120000&&pc.compositeId(turnId,unitIds).length<=512)
        return {compositeNative:{turnId,ids:unitIds,declaredIds,bodyId:id,boundaryVerified:false},compositeHtml:html};
    }
    if(bodies.length!==unitIds.length||new Set(ids).size!==ids.length||!bodies.includes(body)||unitIds.some(x=>!ids.includes(x)))fail();
    for(const n of bodies){
      const nid=n.getAttribute('data-response-body');
      if(!historyVisible(n)||isUserDescendant(n)||n.closest('[data-chatgpt-search-unit-key]')!==unit||
         bodies.some(other=>other!==n&&(other.contains(n)||n.contains(other)))||
         [...n.querySelectorAll('[data-chatgpt-selection-message-id]')].some(marker=>marker.getAttribute('data-chatgpt-selection-message-id')!==nid))fail();
      const role=n.closest('[data-message-author-role]')?.getAttribute('data-message-author-role');
      if(role&&role!=='assistant')fail();
    }
    return id;
  }
  // A rendered assistant body can temporarily omit a code block even when
  // the code node itself is already present. Never accept missing code or
  // erase arbitrary text. Repair only a uniquely bounded DOM code group.

  // A native code block can be nested inside a blockquote. The quote is
  // semantic prose, but the native action bar is explicitly excluded from
  // Markdown copying. Prove this narrow topology before removing a label.
  function historyNativeQuotedCodeLabel(code,body){
    const quote=code.closest?.('blockquote');
    if(!quote||!body.contains?.(quote))return null;
    const source=code.parentElement,block=source?.parentElement;
    if(source?.getAttribute?.('data-code-block-source')!=='true'||
       block?.getAttribute?.('data-code-block')!=='true'||
       block.getAttribute('data-markdown-copy')!=='code-block'||
       !body.contains(block))return null;
    const white=n=>n.nodeType===8||(n.nodeType===3&&!String(n.nodeValue||'').trim());
    const only=(parent,children)=>[...parent.childNodes].filter(n=>!white(n)).length===children.length&&
      [...parent.childNodes].filter(n=>!white(n)).every((n,i)=>n===children[i]);
    if(!only(source,[code]))return null;
    const headers=[...block.children].filter(n=>n.getAttribute('data-markdown-copy')==='exclude'&&n.getAttribute('contenteditable')==='false');
    if(headers.length!==1)return null;
    const header=headers[0];
    if(!only(block,[header,source])||header.querySelectorAll('code,pre,p,blockquote,h1,h2,h3,h4,h5,h6,ul,ol,table').length)return null;
    const label=String(header.textContent||'').trim();
    if(!/^(程式碼|純文字)$/.test(label))return null;
    const copy=[...header.querySelectorAll('button,[role="button"]')].some(n=>/複製|copy/i.test([n.getAttribute('aria-label'),n.getAttribute('title'),n.getAttribute('data-testid')].filter(Boolean).join(' ')));
    if(!copy)return null;
    if(block.closest('blockquote')!==quote||quote.querySelectorAll('code').length!==1)return null;
    for(let n=block;n!==quote;n=n.parentElement){
      const parent=n.parentElement;
      if(!parent||!only(parent,[n])||(parent!==quote&&parent.tagName!=='DIV'))return null;
    }
    const value=code.innerText||code.textContent||'';
    if(!value.trim()||value!==String(code.textContent||''))return null;
    return {quote,header,label,value};
  }
  function historyAssistantStructureText(node,body){
    const raw=node.innerText||node.textContent||'';
    if(node.tagName!=='BLOCKQUOTE')return raw;
    const codes=[...node.querySelectorAll('code')];
    if(codes.length!==1)return raw;
    const proof=historyNativeQuotedCodeLabel(codes[0],body);
    return proof&&proof.quote===node&&raw===proof.label+'\n'+proof.value?proof.value:raw;
  }

  // Whitespace-only fenced code is sometimes omitted from body.innerText,
  // sometimes rendered with its native action-bar label. Keep the exact
  // whitespace in structure.code; normalize only a proven native block gap.
  function historyNativeBlankCodeBlock(code,body,value){
    if(!value||! /^[ \t\r\n\u3000]+$/.test(value)||String(code.textContent||'')!==value)return null;
    const source=code.parentElement,wrapper=source?.parentElement;
    if(source?.getAttribute?.('data-code-block-source')!=='true'||wrapper?.getAttribute?.('data-code-block')!=='true'||
       wrapper.getAttribute('data-markdown-copy')!=='code-block'||!body.contains(wrapper))return null;
    const whitespace=n=>n.nodeType===8||(n.nodeType===3&&!String(n.nodeValue||'').trim());
    const only=(parent,children)=>{const actual=[...parent.childNodes].filter(n=>!whitespace(n));return actual.length===children.length&&actual.every((n,i)=>n===children[i])};
    if(!only(source,[code])||wrapper.querySelectorAll('code').length!==1)return null;
    const headers=[...wrapper.children].filter(n=>n.getAttribute('data-markdown-copy')==='exclude'&&n.getAttribute('contenteditable')==='false');
    if(headers.length!==1||!only(wrapper,[headers[0],source]))return null;
    const header=headers[0],label=String(header.textContent||'').trim();
    if(!/^(純文字|程式碼)$/.test(label)||header.querySelectorAll('code,pre,p,blockquote,h1,h2,h3,h4,h5,h6,ul,ol,table').length)return null;
    const copies=[...header.querySelectorAll('button,[role="button"]')].filter(n=>/複製|copy/i.test([n.getAttribute('aria-label'),n.getAttribute('title'),n.getAttribute('data-testid')].filter(Boolean).join(' ')));
    if(copies.length!==1)return null;
    let group=wrapper;
    while(group.parentElement!==body&&group.parentElement?.tagName==='DIV'&&only(group.parentElement,[group]))group=group.parentElement;
    // Native fallback body contains a selection wrapper and a Markdown root.
    // Accept that exact, identity-bound sole-child path, not arbitrary DIVs.
    const root=group.parentElement;
    if(root!==body){
      const selection=root?.parentElement,nativeId=body.getAttribute('data-response-body');
      if(!nativeId||root?.getAttribute('data-markdown-text-style')!=='assistant-message'||
         root.tagName!=='DIV'||selection?.tagName!=='DIV'||selection.parentElement!==body||
         selection.getAttribute('data-chatgpt-selection-message-id')!==nativeId||
         !only(selection,[root])||!only(body,[selection])||!historyVisible(root)||!historyVisible(selection))return null;
    }
    // No inline, quoted, hidden, or ambiguous semantic ancestor.
    if(!historyVisible(group))return null;
    const before=group.previousElementSibling,after=group.nextElementSibling;
    if(!before||!after||!before.matches('p,blockquote,h1,h2,h3,h4,h5,h6,ul,ol,table,pre')||!after.matches('p,blockquote,h1,h2,h3,h4,h5,h6,ul,ol,table,pre')||!historyVisible(before)||!historyVisible(after))return null;
    const children=[...root.childNodes],at=children.indexOf(group),left=children.indexOf(before),right=children.indexOf(after);
    if(left<0||at<=left||right<=at||children.slice(left+1,at).some(n=>!whitespace(n))||children.slice(at+1,right).some(n=>!whitespace(n)))return null;
    return {before,after,label,value};
  }
  function historyAssistantCodeText(body,owner,id,raw,onBlank=()=>{}){
    const codes=[...body.querySelectorAll('code')].filter(historyVisible);
    let text=raw;
    // Match an entire line-delimited semantic anchor, not an incidental
    // substring. A repeated paragraph is allowed only if the ordered pair
    // and exact permissible gap identify one position.
    const positions=(s,v)=>{
      const out=[];if(!v)return out;
      for(let i=s.indexOf(v);i>=0;i=s.indexOf(v,i+1)){
        if((i===0||s[i-1]==='\n')&&(i+v.length===s.length||s[i+v.length]==='\n'))out.push(i);
        if(out.length>128)return null;
      }
      return out;
    };
    const padded=(s,v)=>{const at=s.indexOf(v);return at>=0&&!s.slice(0,at).trim()&&!s.slice(at+v.length).trim()};
    const block=n=>!!n&&n.matches('p,blockquote,h1,h2,h3,h4,h5,h6,ul,ol,table,pre');
    // HR has no rendered text. The native Markdown root can place it
    // directly after a code wrapper. Cross only verified empty separators,
    // never an arbitrary DIV, hidden node, or nonempty sibling.
    const boundary=(group,direction)=>{
      let n=group[direction];
      while(n?.tagName==='HR'&&historyVisible(n)&&!String(n.textContent||'').trim())n=n[direction];
      return n;
    };
    // A terminal code block has no right prose anchor. Prove its position
    // using native source/block markers and the entire child-node path,
    // including text nodes that nextElementSibling would otherwise miss.
    const whitespace=n=>n.nodeType===3&&!String(n.nodeValue||'').trim()||n.nodeType===8;
    const separator=n=>n.nodeType===1&&n.tagName==='HR'&&historyVisible(n)&&!String(n.textContent||'').trim();
    const terminalProof=(code,group)=>{
      const source=code.parentElement;
      if(source?.getAttribute?.('data-code-block-source')!=='true'||
         ![...source.childNodes].includes(code)||
         [...source.childNodes].some(n=>n!==code&&!whitespace(n)))return false;
      let native=false,found=false;
      for(let n=source;n&&n!==body;n=n.parentElement){
        if(n.getAttribute?.('data-code-block')==='true'||n.getAttribute?.('data-markdown-copy')==='code-block')native=true;
        if(n===group){found=true;break}
        const parent=n.parentElement,children=[...(parent?.childNodes||[])];
        if(!children.includes(n)||children.some(x=>x!==n&&!whitespace(x)&&
           !(x.nodeType===1&&x.getAttribute?.('data-markdown-copy')==='exclude'&&x.querySelectorAll('code').length===0)))return false;
      }
      if(!native||!found)return false;
      for(let n=group;n!==body;n=n.parentElement){
        const parent=n.parentElement,children=[...(parent?.childNodes||[])],at=children.indexOf(n);
        if(at<0||children.slice(at+1).some(x=>!whitespace(x)&&!separator(x)))return false;
      }
      return true;
    };
    const evidence=[];
    for(const code of codes){
      const value=code.innerText||code.textContent||'';
      if(!value.trim()){
        const proof=historyNativeBlankCodeBlock(code,body,value);
        if(proof){
          const a=proof.before.innerText||'',b=proof.after.innerText||'';
          const left=a.trim()?positions(text,a):null,right=b.trim()?positions(text,b):null;
          if(left?.length===1&&right?.length===1){
            const start=left[0]+a.length,end=right[0],gap=text.slice(start,end);
            const allowed=['\n\n','\n\n'+proof.label+'\n'+value+'\n\n','\n\n'+value+'\n\n'];
            if(end>=start&&allowed.includes(gap)&&gap!=='\n\n'){
              onBlank({offset:start,previousGap:gap,normalizedGap:'\n\n',codeText:value,label:proof.label,before:a,after:b});
              text=text.slice(0,start)+'\n\n'+text.slice(end);
            }
          }
        }
        continue;
      }
      let repaired=false,conflicting=false;
      for(let group=code.parentElement;group&&group!==body;group=group.parentElement){
        if(group.querySelectorAll('code').length!==1)break;
        const before=boundary(group,'previousElementSibling'),after=boundary(group,'nextElementSibling');
        const terminal=!after&&block(before)&&historyVisible(before)&&
          String(code.textContent||'')===value&&terminalProof(code,group);
        if(!block(before)||!historyVisible(before)||(!terminal&&(!block(after)||!historyVisible(after))))continue;
        if(group.closest('p,h1,h2,h3,h4,h5,h6'))continue;
        const a=before.innerText||'',b=after?.innerText||'';
        if(!a.trim()||(!terminal&&!b.trim()))continue;
        const left=positions(text,a),right=terminal?[text.length]:positions(text,b);
        if(!left||!right){conflicting=true;continue}
        if(!left.length||!right.length)continue;
        if(terminal&&left.length!==1){conflicting=true;continue}
        // Every non-code text node in the wrapper must be whitespace or one
        // standalone known renderer label. Button text is UI, never prose.
        // No removal based on a label string elsewhere in the answer.
        const extras=[];let copyControl=false;
        const quotedLabel=historyNativeQuotedCodeLabel(code,body);
        const visit=(n,prose=false)=>{
          if(n===code)return;
          if(n.nodeType===3){if((n.nodeValue||'').trim())extras.push({text:n.nodeValue.trim(),prose,node:n});return}
          if(n.nodeType!==1||n.matches('[hidden],[aria-hidden="true"]'))return;
          if(n.matches('button,[role="button"]')){
            const hint=[n.innerText,n.getAttribute?.('aria-label'),n.getAttribute?.('title'),n.getAttribute?.('data-testid')].filter(Boolean).join(' ');
            if(/複製|copy/i.test(hint))copyControl=true;
            return;
          }
          const semantic=prose||n.matches('p,blockquote,h1,h2,h3,h4,h5,h6,li,td,th');
          for(const child of n.childNodes)visit(child,semantic);
        };
        visit(group);
        const label=copyControl&&extras.length===1&&/^(純文字|程式碼)$/.test(extras[0].text)&&(!extras[0].prose||(quotedLabel?.quote===group&&quotedLabel.label===extras[0].text&&quotedLabel.header.contains(extras[0].node)))?extras[0].text:'';
        if(extras.length&&!label)continue;
        const candidates=[];
        for(const at of left)for(const end of right){
          const start=at+a.length;
          if(end<start||(!terminal&&end===start))continue;
          const gap=text.slice(start,end);
          if(terminal?gap.length&&!gap.startsWith('\n'):!gap.startsWith('\n')||!gap.endsWith('\n'))continue;
          if(!gap.trim()||padded(gap,value)||(label&&(padded(gap,label+'\n'+value)||padded(gap,label))))candidates.push({start,end});
        }
        if(candidates.length!==1){conflicting=true;continue}
        const {start,end}=candidates[0];
        // Exact same output when the renderer exposes only the code node,
        // or exposes the label plus its text in the enclosing innerText.
        text=text.slice(0,start)+'\n\n'+value+(terminal?'':'\n\n'+text.slice(end));
        repaired=true;break;
      }
      if(!repaired&&(conflicting||!text.includes(value))){
        const path=[];for(let n=code;n&&n!==body&&path.length<12;n=n.parentElement){
          const parent=n.parentElement,children=[...(parent?.childNodes||[])],at=children.indexOf(n);
          const brief=x=>({type:x.nodeType,tag:x.tagName||null,length:String(x.textContent||x.nodeValue||'').length,source:x.getAttribute?.('data-code-block-source')||null,block:x.getAttribute?.('data-code-block')||null,copy:x.getAttribute?.('data-markdown-copy')||null});
          path.push({node:brief(n),index:at,siblings:children.length,before:children.slice(Math.max(0,at-3),Math.max(0,at)).map(brief),after:children.slice(at+1,at+7).map(brief)});
        }
        evidence.push({codeText:value,codeHtml:String(code.outerHTML||'').slice(0,20000),parentHtml:String(code.parentElement?.outerHTML||'').slice(0,60000),renderedText:String(code.innerText||''),domText:String(code.textContent||''),ancestorPath:path,bodyHtml:String(body.outerHTML||'').slice(0,120000),bodyHtmlTruncated:String(body.outerHTML||'').length>120000});
      }
    }
    // Also reject a missing repeated code occurrence. Do not guess a placement.
    const counts=new Map();for(const code of codes){const v=code.innerText||code.textContent||'';if(v.trim())counts.set(v,(counts.get(v)||0)+1)}
    for(const [value,n] of counts)if(text.split(value).length-1<n)evidence.push({codeText:value,expectedOccurrences:n,observedOccurrences:text.split(value).length-1});
    if(evidence.length)throw historyIssue('GPT 正文與程式碼框不一致，無法安全確認完整正文',owner,{messageId:id,codeEvidence:evidence.slice(0,20),codeEvidenceOverflow:Math.max(0,evidence.length-20)});
    return text;
  }
  // Narrow exception for the observed native generated-image-only renderer.
  // Never treat arbitrary img, user uploads, captions, or tool UI as prose.
  function historyGeneratedImageProof(body,owner){
    const gallerySelector='[data-testid="generated-image-gallery"]',previewSelector='[data-testid="generated-image-preview"]';
    const galleries=[...body.querySelectorAll(gallerySelector)];
    if(!galleries.length)return null;
    const id=body.getAttribute('data-response-body');
    const valid=/^[a-zA-Z0-9_-]+$/;
    if(!valid.test(id||'')||body.getAttribute('data-chatgpt-search-message-ids')!==id||!owner.contains(body)||!historyVisible(body)||isUserDescendant(body))return null;
    const state=body.closest('[data-talvt-turn-state="complete"]');
    if(!state||!owner.contains(state))return null;
    const parent=body.parentElement,roles=[...parent.children].filter(n=>n.hasAttribute('data-conversation-role'));
    if(roles.length!==1||roles[0].getAttribute('data-conversation-role')!=='assistant'||!(roles[0].compareDocumentPosition(body)&Node.DOCUMENT_POSITION_FOLLOWING))return null;
    const conflicts=[...body.querySelectorAll('[data-message-id],[data-source-message-id],[data-dil-message-id],[data-chatgpt-selection-message-id],[data-message-author-role]')];
    if(conflicts.some(n=>['data-message-id','data-source-message-id','data-dil-message-id','data-chatgpt-selection-message-id'].some(a=>n.hasAttribute(a)&&n.getAttribute(a)!==id)||(n.hasAttribute('data-message-author-role')&&n.getAttribute('data-message-author-role')!=='assistant')))return null;
    if(galleries.length!==1||body.querySelectorAll('p,pre,code,blockquote,table,[data-markdown-text-style="assistant-message"]').length)return null;
    const gallery=galleries[0],images=[...gallery.querySelectorAll('img')],previews=[...gallery.querySelectorAll(previewSelector)];
    // Only single-image turns are proven by the real Iron Tomb evidence.
    // Multi-image carousels or other layouts remain subject to normal checks.
    if(images.length!==1||previews.length!==1||body.querySelectorAll('img').length!==1||!previews[0].contains(images[0])||!historyVisible(previews[0])||!historyVisible(images[0]))return null;
    if(!/^(?:產生的圖片|生成的圖片|Generated image)\s*1$/i.test(previews[0].getAttribute('aria-label')||''))return null;
    // A preview may not hide a caption or unrelated textual body.
    const onlyImage=n=>n===images[0]||n.nodeType===8||(n.nodeType===3&&!String(n.nodeValue||'').trim())||(n.nodeType===1&&['DIV','SPAN'].includes(n.tagName)&&[...n.childNodes].every(onlyImage));
    if(![...previews[0].childNodes].every(onlyImage))return null;
    const knownControl=n=>n===previews[0]||(n.tagName==='BUTTON'&&gallery.contains(n)&&/^(?:編輯生成的圖像|分享生成的圖像|Edit generated image|Share generated image)\s*1$/i.test(n.getAttribute('aria-label')||''));
    let unknown=false;
    const walk=n=>{
      if(n.nodeType===3){if(String(n.nodeValue||'').trim())unknown=true;return}
      if(n.nodeType===8)return;
      if(n.nodeType!==1){unknown=true;return}
      if(knownControl(n))return;
      // Nonempty hidden prose is not silently dropped either.
      if(n!==body&&n.tagName!=='DIV'&&n.tagName!=='SPAN'){unknown=true;return}
      for(const child of n.childNodes)walk(child);
    };
    // The image and its own edit/share controls are the only nonempty body.
    walk(body);
    if(unknown)return null;
    return {id:'assistant|message:'+id,image:images[0]};
  }
  const HISTORY_IMAGE_SINGLE_LIMIT=12*1024*1024,HISTORY_IMAGE_TOTAL_LIMIT=48*1024*1024,HISTORY_IMAGE_COUNT_LIMIT=100;
  function historyImageMime(bytes){
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x))return 'image/png';
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    return null;
  }
  async function historyCaptureGeneratedImages(b,entries){
    if(!entries?.length||b.sample||!['predecessor-history','predecessor-prefix-supplement'].includes(b.mode))return;
    const map=b.generatedImageAssets||(b.generatedImageAssets=new Map());
    for(const entry of entries){
      const proof=entry.generatedImage;if(!proof||entry.row.id!==proof.id||entry.row.role!=='assistant'||entry.row.text!==''||entry.row.nonTextOmitted!==true)continue;
      if(b.cancelled||state.bulk!==b||path()!==b.chat)return;
      const prior=map.get(proof.id);if(prior?.status==='captured'||prior?.attempts>=2)continue;
      if(!prior&&map.size>=HISTORY_IMAGE_COUNT_LIMIT){b.generatedImageOverflow=(b.generatedImageOverflow||0)+1;continue}
      const record={messageId:proof.id,ordinal:1,status:'unavailable',attempts:(prior?.attempts||0)+1,observedAt:new Date().toISOString()};
      try{
        const img=proof.image,src=img.currentSrc||img.src;
        if(!img.isConnected||!img.complete||!img.naturalWidth||!img.naturalHeight||!/^blob:https:\/\/chatgpt\.com\/[a-zA-Z0-9-]+$/.test(src||''))throw Error('已生成圖片未掛載可讀的同源 blob');
        const response=await fetch(src,{signal:AbortSignal.timeout(2500),credentials:'omit'});
        if(!response.ok)throw Error('圖片 blob 讀取失敗');
        const blob=await response.blob(),used=[...map.values()].reduce((n,x)=>n+(x.byteLength||0),0);
        if(!blob.size||blob.size>HISTORY_IMAGE_SINGLE_LIMIT||used+blob.size>HISTORY_IMAGE_TOTAL_LIMIT)throw Error('圖片保全大小上限');
        const bytes=new Uint8Array(await blob.arrayBuffer()),mime=historyImageMime(bytes);
        if(!mime||blob.type!==mime)throw Error('圖片格式無法核對');
        if(b.cancelled||state.bulk!==b||path()!==b.chat)throw Error('掃描狀態已變更');
        const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
        let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        Object.assign(record,{status:'captured',mime,byteLength:bytes.length,sha256,base64:btoa(binary),width:img.naturalWidth,height:img.naturalHeight,source:'rendered-blob; original-server-bytes-not-verified'});
      }catch(e){record.reason=String(e.message||e).slice(0,300)}
      map.set(proof.id,record);
    }
  }
  async function historyInheritGeneratedImages(b,data){
    const rows=data?.candidateRows||data?.rows||[],allowed=new Set(rows.filter(r=>r.role==='assistant'&&r.text===''&&r.nonTextOmitted===true).map(r=>r.id)),map=b.generatedImageAssets||(b.generatedImageAssets=new Map());
    const records=data?.evidence?.generatedImageAssets;
    for(const x of Array.isArray(records)?records:[]){
      if(!x||typeof x!=='object')continue;
      if(!allowed.has(x.messageId)||x.ordinal!==1||x.status!=='captured'||map.has(x.messageId)||map.size>=HISTORY_IMAGE_COUNT_LIMIT)continue;
      if(!Number.isSafeInteger(x.byteLength)||x.byteLength<1||x.byteLength>HISTORY_IMAGE_SINGLE_LIMIT||typeof x.base64!=='string'||x.base64.length!==4*Math.ceil(x.byteLength/3)||!(/^[a-f0-9]{64}$/.test(x.sha256||'')))continue;
      if([...map.values()].reduce((n,y)=>n+(y.byteLength||0),0)+x.byteLength>HISTORY_IMAGE_TOTAL_LIMIT)continue;
      try{
        const bytes=Uint8Array.from(atob(x.base64),ch=>ch.charCodeAt(0)),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        if(bytes.length!==x.byteLength||historyImageMime(bytes)!==x.mime||sha256!==x.sha256)continue;
        map.set(x.messageId,{messageId:x.messageId,ordinal:1,status:'captured',attempts:1,observedAt:x.observedAt,mime:x.mime,byteLength:x.byteLength,sha256,base64:x.base64,width:x.width,height:x.height,source:'inherited-rendered-blob; original-server-bytes-not-verified'});
      }catch(_){}
    }
  }
  function historyGeneratedImageExport(b,rows){
    const allowed=new Set(rows.filter(r=>r.role==='assistant'&&r.text===''&&r.nonTextOmitted===true).map(r=>r.id));
    return [...(b.generatedImageAssets?.values()||[])].filter(x=>allowed.has(x.messageId));
  }
  function historyRead(host,onFold=()=>{},onEntries=()=>{},allowComposite=false){
    const root=historyRoot(host),entries=[],owners=new Map(),explicit=[];
    const add=(role,el,body,identityHint,fallback=false)=>{
      if(!el||!body||!root.contains(el)||!historyVisible(el))return;
      const composite=typeof identityHint==='object'&&identityHint?.compositeNative?identityHint:null;
      const owner=historyOwner(el),native=(composite?null:identityHint)||el.closest('[data-message-id]')?.getAttribute('data-message-id')||el.getAttribute('data-message-id')||body.getAttribute('data-dil-message-id')||el.closest('[data-source-message-id]')?.getAttribute('data-source-message-id');
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
      const stable=composite?pc.compositeId(composite.compositeNative.turnId,composite.compositeNative.ids):role+'|'+(native?'message:'+native:'turn:'+turn);
      let text=historyReadText(body,identityHint?body:owner,stable,onFold);
      const blankCodeNormalizations=[];
      if(role==='assistant')text=historyAssistantCodeText(body,owner,stable,text,x=>{if(blankCodeNormalizations.length<8)blankCodeNormalizations.push(x)});
      const structure=[...body.querySelectorAll(HISTORY_STRUCT)].filter(historyVisible).map(n=>({tag:n.tagName.toLowerCase(),text:role==='assistant'?historyAssistantStructureText(n,body):n.innerText||n.textContent||''}));
      const attachments=[...el.querySelectorAll(HISTORY_ATTACHMENT)].filter(historyVisible).map(historyAttachment);
      if(!text&&!attachments.length)throw Error('空白回合未能確認內容／附件');
      const row={id:stable,role,text,identityBasis:composite?'unresolved-native-composite':native?'native-dom-id':'turn-key',sourceCreatedAt:getVisibleSourceTime(el),structure,attachments,...(composite||{})};
      const sameOwner=owners.get(owner)||[];
      if(sameOwner.some(x=>x.row.id===stable))throw Error('重複原生訊息 ID');
      const item={row,el,owner,body,blankCodeNormalizations};sameOwner.push(item);owners.set(owner,sameOwner);entries.push(item);
    };
    // Read the entire marked response before the legacy selector can pick
    // a nested PDF citation. Keep native message identity, not the user turn ID.
    for(const body of root.querySelectorAll('[data-response-body]')){
      if(body.parentElement?.closest('[data-response-body]'))continue;
      const owner=historyOwner(body);
      if(!historyVisible(owner))continue;
      const generated=historyGeneratedImageProof(body,owner);
      if(generated){
        const row={id:generated.id,role:'assistant',text:'',identityBasis:'native-dom-id',sourceCreatedAt:getVisibleSourceTime(body),structure:[],attachments:[],nonTextOmitted:true};
        const group=owners.get(owner)||[];
        if(group.some(x=>x.row.id===row.id))throw historyIssue('重複生成圖片原生訊息 ID',owner);
        const item={row,el:body,owner,body,generatedImage:generated};
        group.push(item);owners.set(owner,group);entries.push(item);explicit.push({el:body,role:'assistant',owner});continue;
      }
      const native=historyResponseIdentity(body,owner,allowComposite);
      if(!historyVisible(body))throw historyIssue('明確 GPT 正文尚未穩定掛載',owner,{responseBodyId:native});
      add('assistant',body,body,native);
      explicit.push({el:body,role:'assistant',owner});
    }
    // Explicit author-role roots take precedence, including attachment-only messages.
    for(const el of root.querySelectorAll('[data-message-author-role]')){
      if(el.parentElement?.closest('[data-message-author-role]')||!historyVisible(el))continue;
      const role=el.getAttribute('data-message-author-role');
      if(!['user','assistant'].includes(role))throw Error('遇到未支援的明確訊息角色：'+role);
      if(role==='assistant'&&explicit.some(x=>x.role===role&&(el.contains(x.el)||x.el.contains(el))))continue;
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
    for(const entry of entries)entry.row=pc.withoutImages(entry.row);
    const rows=entries.map(x=>x.row);pc.validateRows(rows);
    if(!rows.length)throw Error('尚未讀到對話訊息');
    onEntries(entries);
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
  // Preserve intended scroll position across ChatGPT auto-scroll and expansion.
  function historyRecoverScroll(b,target,height,stage,allowBoost=true,policy=null){
    const actual=b.host.scrollTop,currentHeight=b.host.scrollHeight;
    const recovery=pc.scrollRecoveryTarget(target,actual,currentHeight,height,b.host.clientHeight);
    if(recovery===null)return null;
    b.scrollStats.scrollResets++;
    const state=b.breakthrough||(b.breakthrough={resets:0,attempts:0,frontier:null});
    state.resets++;
    const frontier=pc.frontierPosition(state.frontier,currentHeight,b.host.clientHeight);
    let destination=recovery;
    if(!state.recoveryAvoidFrontier&&frontier!==null&&frontier<destination-b.host.clientHeight){
      destination=frontier;
      b.scrollStats.frontierRestores=(b.scrollStats.frontierRestores||0)+1;
      historyTrace(b,'frontier-restore',{anchor:state.frontier.id,estimated:frontier,recovery});
    }
    const boost=pc.breakthroughStep(state,b.host.clientHeight);
    if(allowBoost&&!state.recoveryAvoidFrontier&&boost&&destination>2&&policy?.locked==null){
      // Try moving beyond the obstruction. The outer loop still requires
      // strict overlap and can return to the last confirmed position.
      state.attempts++;
      b.scrollStats.breakthroughAttempts=(b.scrollStats.breakthroughAttempts||0)+1;
      const from=destination;destination=Math.max(0,destination-boost);
      historyTrace(b,'breakthrough-attempt',{attempt:state.attempts,resets:state.resets,from,to:destination,step:boost,anchor:state.frontier?.id||null});
    }
    if(state.recoveryAvoidFrontier)destination=target; // preserve the alternative probe's coordinate; overlap remains mandatory
    const originalDestination=destination;
    const escape=policy?pc.bottomEscape(state,target,actual,currentHeight,b.host.clientHeight):null;
    if(escape!==null){
      b.scrollStats.bottomEscapeAttempts=(b.scrollStats.bottomEscapeAttempts||0)+1;
      historyTrace(b,'bottom-escape-start',{from:actual,nudge:escape,returnTarget:destination,attempt:state.bottomEscapeAttempts});
      policy.recent=[];policy.recentCalls=[];policy.locked=null;policy.holds=0;
      historyScroll(b.host,escape);
      return {target:destination,height:currentHeight,delay:600,exhausted:false,escape:true};
    }
    const strategy=policy?pc.recoveryCycle(policy,destination,b.host.clientHeight):{destination,delay:180,detected:false,exhausted:false};
    destination=Math.max(0,Math.min(pc.scrollRange(currentHeight,b.host.clientHeight),strategy.destination));
    if(strategy.detected){b.scrollStats.recoveryCycles=(b.scrollStats.recoveryCycles||0)+1;if(strategy.crossWindow)b.scrollStats.crossWindowCycles=(b.scrollStats.crossWindowCycles||0)+1;historyTrace(b,'recovery-cycle',{recent:policy.recent.slice(),windows:policy.recentCalls.slice(),crossWindow:strategy.crossWindow,locked:policy.locked,delay:strategy.delay,stage})}
    if(policy?.locked!=null){b.scrollStats.cycleHolds=(b.scrollStats.cycleHolds||0)+1;historyTrace(b,'recovery-hold',{originalDestination,destination,delay:strategy.delay,holds:policy.holds,exhausted:strategy.exhausted})}
    historyTrace(b,'scroll-reset',{target,actual,expectedHeight:height,currentHeight,recovery,destination,stage,resetsSinceGrowth:state.resets});
    if(!strategy.exhausted)historyScroll(b.host,destination);
    return {target:destination,height:currentHeight,delay:strategy.delay,exhausted:strategy.exhausted};
  }
  // Observed native history failure: status and retry are siblings inside
  // the same row, outside conversation turns. Never use a global text click.
  function historyNativeFailure(host){
    if(!host?.querySelectorAll)return null;
    const excluded='[data-turn-key],[data-message-author-role],[data-testid^="conversation-turn-"],#ga-predecessor-history-panel,#ga-predecessor-page-config,[id^="ga-predecessor-page-config--"]';
    const norm=v=>String(v||'').trim().replace(/\s+/g,' ');
    const matches=[...host.querySelectorAll('[role="status"]')].filter(n=>norm(n.textContent)==='無法載入較早的訊息'&&!n.closest(excluded)&&historyVisible(n));
    if(!matches.length)return null;
    if(matches.length!==1)return {reason:'ambiguous-status'};
    const status=matches[0],row=status.parentElement;
    if(!row||!host.contains(row)||row.closest(excluded))return {reason:'invalid-row'};
    const buttons=[...row.children].filter(n=>n.tagName==='BUTTON'&&norm(n.textContent)==='重試'&&historyVisible(n));
    if(buttons.length!==1)return {reason:'ambiguous-button'};
    const button=buttons[0];
    if(button.disabled||button.getAttribute('aria-disabled')==='true')return {reason:'disabled-button'};
    return {button,status};
  }
  function historyNativeGeometry(host,detected){
    const rect=n=>{const r=n?.getBoundingClientRect?.();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null};
    const h=rect(host),button=rect(detected?.button),status=rect(detected?.status);
    const visible=(r)=>h&&r?Math.min(h.bottom,r.bottom)>Math.max(h.top,r.top)&&Math.min(h.right,r.right)>Math.max(h.left,r.left):null;
    return {hostRect:h,statusRect:status,buttonRect:button,buttonInHostViewport:visible(button)};
  }
  // Only strictly verified earlier rows reset the local retry counter/backoff.
  function historyNativeProgress(b,kind){
    const stats=b.nativeHistoryRetry;
    if(!stats||!stats.sinceProgress)return;
    stats.trace.push({at:new Date().toISOString(),event:'verified-progress-reset',kind,count:b.rows.length,minIndex:b.resume?.minIndex??null,previousAttempts:stats.sinceProgress,totalAttempts:stats.attempts});
    stats.sinceProgress=0;stats.progressResets++;
  }
  async function historyNativeRetry(b,until,{guard=()=>historyGuard(b),report=msg=>historyStatus(b,msg),maxAttempts=Infinity}={}){
    let detected=historyNativeFailure(b.host);
    if(!detected)return false;
    const stats=b.nativeHistoryRetry||(b.nativeHistoryRetry={attempts:0,cleared:0,sinceProgress:0,progressResets:0,trace:[]});
    const record=(event,details={})=>stats.trace.push({at:new Date().toISOString(),event,scrollTop:b.host.scrollTop,scrollHeight:b.host.scrollHeight,count:b.rows.length,...details});
    while(detected){
      guard();
      if(Date.now()>=until){record('deadline');throw Error('原生歷史載入失敗：已達無進展期限')}
      if(!detected.button){record('blocked',{reason:detected.reason});throw Error('原生歷史載入失敗：無法唯一確認可用重試按鈕')}
      if(stats.sinceProgress>=maxAttempts){record('exhausted');throw Error('原生歷史載入失敗：未取得核對進展，已達'+maxAttempts+'次重試上限')}
      const attempt=++stats.attempts,localAttempt=++stats.sinceProgress;
      report('原生歷史載入失敗，重試 '+localAttempt+(Number.isFinite(maxAttempts)?'/'+maxAttempts:'（不限次數，受無進展期限保護）')+'（累計 '+attempt+'次）');
      // Give native loading more time on repeated failure; preserve the
      // caller's retry policy and the absolute progress deadline. Later
      // attempts retain a ten-second observation window, never a busy loop.
      const observationMs=[2000,5000,10000][Math.min(2,localAttempt-1)],clickedAt=Date.now();
      record('click',{attempt,localAttempt,observationMs,...historyNativeGeometry(b.host,detected)});
      detected.button.click();
      // No scroll during observation. Absence must hold for 500ms; a
      // cleared banner still does not certify any historical rows.
      const waitEnd=Math.min(until,clickedAt+observationMs);
      let absentSince=null;
      while(Date.now()<waitEnd){
        await sleep(Math.min(250,waitEnd-Date.now()));guard();
        detected=historyNativeFailure(b.host);
        if(!detected){if(absentSince===null)absentSince=Date.now()}
        else absentSince=null;
        if(Date.now()-clickedAt>=2000&&absentSince!==null&&Date.now()-absentSince>=500)break;
      }
      if(Date.now()>=until){record('deadline',{attempt});throw Error('原生歷史載入失敗：重試等待逾時')}
      // If the banner disappears just before the observation ends, give
      // it only the remainder of the 500ms stability interval.
      while(!detected&&absentSince!==null&&Date.now()-absentSince<500){
        await sleep(Math.min(250,500-(Date.now()-absentSince),until-Date.now()));guard();
        if(Date.now()>=until){record('deadline',{attempt});throw Error('原生歷史載入失敗：重試等待逾時')}
        detected=historyNativeFailure(b.host);
      }
      if(!detected){stats.cleared++;record('error-cleared',{attempt,observedMs:Date.now()-clickedAt});return true}
      record('still-present',{attempt,observedMs:Date.now()-clickedAt,...historyNativeGeometry(b.host,detected)});
    }
    return true;
  }
  async function historySettled(b,{deadline=Infinity,upward=false,target=null,targetHeight=null,allowBoost=true,preferIdentity=false,anchorRead=null}={}){
    const until=Math.min(Date.now()+60000,deadline);let last=null,lastRows=null,lastAt=0,reason='',spinAt=0,lastNudge=0,nudges=0,resets=0;const policy=upward?pc.recoveryPolicy(b.breakthrough||(b.breakthrough={resets:0,attempts:0,frontier:null})):null;
    const retryError=()=>Object.assign(Error('頁面反覆自動返回底端；本次定位策略無法穩定'),{code:'HISTORY_RECOVERY_RETRY'});
    const farBottom=()=>preferIdentity&&upward&&target!==null&&historyAtBottom(b.host)&&b.host.scrollTop-target>b.host.clientHeight*4;
    const handoffIdentity=()=>Object.assign(Error('頁面反覆自動返回底端；改用相對原生ID定位'),{code:'HISTORY_RECOVERY_RETRY'});
    const recoverWait=async recovered=>{
      await sleep(Math.min(recovered.delay,Math.max(0,until-Date.now())));
      if(!recovered.escape||Date.now()>=until)return recovered;
      historyGuard(b);
      const height=b.host.scrollHeight,from=b.host.scrollTop;
      const departed=from<pc.scrollRange(height,b.host.clientHeight)-6;
      if(departed)b.scrollStats.bottomEscapeDepartures=(b.scrollStats.bottomEscapeDepartures||0)+1;
      const anchor={top:recovered.target,height:recovered.height},viewport=b.host.clientHeight;
      let target=pc.rejoinTarget(anchor,height,viewport);
      const baseStages=pc.escapeStageCount(from,target,viewport),backoff=b.breakthrough.stagedEscapeBackoff||1;
      const stages=baseStages===1?1:Math.min(48,baseStages*backoff);
      historyTrace(b,'bottom-escape-return',{from,target,departed,height,stages,baseStages,backoff});
      if(stages===1){
        historyScroll(b.host,target);await sleep(Math.min(350,Math.max(0,until-Date.now())));
        return {...recovered,target,height};
      }
      b.scrollStats.stagedReturns=(b.scrollStats.stagedReturns||0)+1;
      if(!departed){historyTrace(b,'bottom-escape-stage-failed',{reason:'nudge-not-held'});throw retryError()}
      let targetHeight=height;
      for(let i=0;i<stages;i++){
        historyGuard(b);
        if(Date.now()>=until)throw Error('等待逾時：分段返回');
        targetHeight=b.host.scrollHeight;target=pc.rejoinTarget(anchor,targetHeight,viewport);
        const start=b.host.scrollTop,waypoint=pc.escapeStageTarget(start,target,stages-i);
        if(start<target-viewport*.5){historyTrace(b,'bottom-escape-stage-failed',{reason:'unexpected-overshoot',start,target});throw retryError()}
        historyScroll(b.host,waypoint);
        await sleep(Math.min(600,Math.max(0,until-Date.now())));
        if(Date.now()>=until)throw Error('等待逾時：分段返回');
        historyGuard(b);
        const actual=b.host.scrollTop,nowHeight=b.host.scrollHeight;
        const expected=pc.rejoinTarget({top:waypoint,height:targetHeight},nowHeight,viewport);
        const max=pc.scrollRange(nowHeight,viewport),direct=Math.max(0,Math.min(max,waypoint));
        const landingBasis=pc.escapeLanding({start,waypoint,actual,height:targetHeight,nowHeight,viewport,final:i===stages-1});
        const held=landingBasis!==null;
        historyTrace(b,'bottom-escape-stage',{stage:i+1,stages,start,waypoint,actual,expected,direct,held,landingBasis,target,nowHeight});
        if(!held){
          const snap=Math.abs(actual-max)<=6;
          if(snap){b.breakthrough.stagedEscapeBackoff=Math.min(4,backoff*2);b.scrollStats.stagedReturnBackoffs=(b.scrollStats.stagedReturnBackoffs||0)+1}
          historyTrace(b,'bottom-escape-stage-failed',{stage:i+1,reason:snap?'bottom-snap':'waypoint-not-held',nextBackoff:b.breakthrough.stagedEscapeBackoff||1});throw retryError();
        }
        b.scrollStats.stagedReturnLandings=(b.scrollStats.stagedReturnLandings||0)+1;
        if(landingBasis==='height-envelope')b.scrollStats.stagedEnvelopeLandings=(b.scrollStats.stagedEnvelopeLandings||0)+1;
        if(i===stages-1){target=landingBasis==='direct'?direct:expected;targetHeight=nowHeight}
      }
      b.scrollStats.stagedReturnArrivals=(b.scrollStats.stagedReturnArrivals||0)+1;
      // Return only the coordinates: historySettled still reads a stable
      // window, and historyRun still verifies exact overlap/frontier.
      historyTrace(b,'bottom-escape-arrived',{stages,target,actual:b.host.scrollTop});
      return {...recovered,target,height:targetHeight};
    };
    while(Date.now()<until){
      historyGuard(b);
      if(upward&&await historyNativeRetry(b,until)){target=null;targetHeight=null;last=null;lastRows=null;spinAt=0;continue}
      if(farBottom())throw handoffIdentity();
      const recovered=upward&&target!==null?historyRecoverScroll(b,target,targetHeight,'settle-before-read',allowBoost,policy):null;
      if(recovered){
        target=recovered.target;targetHeight=recovered.height;
        last=null;lastRows=null;reason='恢復向上捲動位置';if(++resets>8||recovered.exhausted)throw retryError();historyStatus(b,reason);const result=await recoverWait(recovered);target=result.target;targetHeight=result.height;continue;
      }
      if(historyLoading(b.host)){
        last=null;reason='等待載入轉圈';b.scrollStats.loadingPolls++;
        const now=Date.now();if(!spinAt)spinAt=now;
        if(upward&&!isGenerating()&&now-spinAt>=8000&&now-lastNudge>=8000&&nudges<3&&b.host.scrollTop>2){
          const from=b.host.scrollTop;historyScroll(b.host,from-Math.max(24,Math.floor(b.host.clientHeight*.2)));
          lastNudge=now;nudges++;b.scrollStats.loadingNudges++;target=b.host.scrollTop;targetHeight=b.host.scrollHeight;
          historyTrace(b,'loading-nudge',{from,to:b.host.scrollTop});
        }
      }
      else{spinAt=0;
        try{
            // A forensic anchor match is not a canonical overlap: return its
            // same-window evidence before recovery or a stability sleep can
            // unmount it. Full scans never supply anchorRead.
            const anchor=b.mode==='predecessor-anchor'&&anchorRead?anchorRead(b.host):null;
            if(anchor?.observation)return anchor.rows;
            let entries=null;const rows=anchor?anchor.rows:historyRead(b.host,observation=>historyFoldObservation(b,observation),x=>{entries=x},b.mode==='predecessor-history'&&!b.sample&&!b.isolated),fingerprint=pc.fingerprint(rows);
            if(last===fingerprint&&lastRows){for(let i=0;i<rows.length;i++)for(const change of pc.compareRow(lastRows[i],rows[i]).changes)historyAttachmentChange(b,change)}
            if(lastRows&&last!==null&&last!==fingerprint){
              b.scrollStats.fingerprintChanges++;
              const before=new Map(lastRows.map(r=>[r.id,r]));const after=new Set(rows.map(r=>r.id));const changed=rows.filter(r=>before.has(r.id)).map(r=>({id:r.id,fields:pc.compareRow(before.get(r.id),r).fields})).filter(r=>r.fields.length);
              b.stabilityIssues.push({at:new Date().toISOString(),scrollTop:b.host.scrollTop,added:rows.filter(r=>!before.has(r.id)).map(r=>r.id),removed:lastRows.filter(r=>!after.has(r.id)).map(r=>r.id),changed});if(b.stabilityIssues.length>12)b.stabilityIssues.shift();
            }
            lastRows=rows;
            if(last===fingerprint&&Date.now()-lastAt>=550){
              if(upward&&historyNativeFailure(b.host)){last=null;lastRows=null;continue}
              if(farBottom())throw handoffIdentity();
              const recovered=upward&&target!==null?historyRecoverScroll(b,target,targetHeight,'settle-after-read',allowBoost,policy):null;
              if(recovered){target=recovered.target;targetHeight=recovered.height;last=null;lastRows=null;reason='恢復向上捲動位置';if(++resets>8||recovered.exhausted)throw retryError();historyStatus(b,reason);const result=await recoverWait(recovered);target=result.target;targetHeight=result.height;continue}
              if(entries?.some(x=>x.generatedImage)){await historyCaptureGeneratedImages(b,entries);historyGuard(b)}
              return rows;
            }
            if(last!==fingerprint){
              last=fingerprint;lastAt=Date.now();
            }
            reason='等待原文與格式穩定';
        }catch(e){if(e.code==='HISTORY_RECOVERY_RETRY')throw e;last=null;reason=String(e.message||e);b.lastReadIssue={at:new Date().toISOString(),reason,scrollTop:b.host.scrollTop,scrollHeight:b.host.scrollHeight,evidence:e.historyEvidence||null}}
      }
      historyStatus(b,reason+'（最多等待60秒）');await sleep(350);
    }
    throw Error('等待逾時：'+reason);
  }
  function historyGuard(b){
    if(b.cancelled)throw Error('使用者停止');
    if(b.mode==='predecessor-anchor'&&isGenerating())throw Error('聊天正在生成，停止局部定位');
    if(state.bulk!==b||!valid()||path()!==b.chat||!b.host.isConnected)throw Error('聊天來源或捲動容器已變更');
  }
  // Passive trusted wheel evidence only: no synthesized input, no new scroll.
  function historyObserveWheel(b,event){
    if(!event.isTrusted||!b.host?.contains(event.target))return;
    const entry={at:new Date().toISOString(),deltaY:event.deltaY,deltaMode:event.deltaMode,scrollTop:b.host.scrollTop,scrollHeight:b.host.scrollHeight,count:b.rows.length};
    b.trustedWheelCount=(b.trustedWheelCount||0)+1;
    const list=b.trustedWheelTrace||(b.trustedWheelTrace=[]);
    if(list.length>=64){list.shift();b.trustedWheelOverflow=(b.trustedWheelOverflow||0)+1}
    list.push(entry);
  }
  // Keep the native history loader at the top of the chat unobstructed.
  function historyPanelButton(button,color){
    button.type='button';
    button.style.cssText='appearance:none!important;box-sizing:border-box!important;background:'+color+'!important;color:#fff!important;border:1px solid #a4b5d2!important;border-radius:7px!important;padding:8px 12px!important;min-height:36px!important;font:600 13px system-ui!important;cursor:pointer!important;text-align:center!important;white-space:normal!important;overflow-wrap:anywhere!important';
    return button;
  }
  function historyPanelControls(pane,b){
    const bar=document.createElement('div');bar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0';
    const compact=document.createElement('button'),move=document.createElement('button');
    historyPanelButton(compact,'#33435f');historyPanelButton(move,'#33435f');
    let small=window.innerWidth<=640,side='left';
    const render=()=>{
      pane.style.left=side==='left'?'12px':'auto';pane.style.right=side==='right'?'12px':'auto';
      pane.style.width=small?'max-content':'min(320px,calc(100vw - 24px))';
      b.info.hidden=small;compact.textContent=small?'展開詳情':'縮小面板';
      compact.setAttribute('aria-expanded',String(!small));
      move.textContent=side==='left'?'移到右下':'移到左下';
    };
    compact.onclick=()=>{small=!small;render()};
    move.onclick=()=>{side=side==='left'?'right':'left';render()};
    b.showPanelDetails=()=>{small=false;render()};
    bar.append(compact,move);render();return bar;
  }
  function historyStatus(b,msg){
    if(b.mode==='predecessor-anchor'){b.anchorProgress?.(msg);return}
    const count=b.isolated?b.isolated.originalRows.length+'（另有隔離取證 '+b.rows.length+' 則，含重疊）':b.sample?Math.min(b.sample,b.rows.length)+' / '+b.sample:b.rows.length;
    const compositeCount=b.rows.filter(r=>r.identityBasis==='unresolved-native-composite').length;
    const unit=compositeCount?' 個顯示單元（'+compositeCount+' 個複合待核對，非原生則數）':' 則';
    b.info.textContent=msg+'\n已保全 '+count+unit+'；不會上傳 Firebase。';
    if(b.summary)b.summary.textContent='已保全 '+count+unit+'｜'+(b.download.hidden?(b.cancelled?'停止中':'掃描中'):'已結束，詳情可展開');
    if(b.action)b.action.textContent='目前動作：'+msg;
  }
  function historyAtBottom(host){return host.scrollHeight-host.clientHeight-host.scrollTop<=6}
  function historyScroll(host,at){host.scrollTo({top:Math.max(0,at),behavior:'instant'})}
  function historyTrace(b,event,details={}){
    const trace=b.scrollTrace;
    const entry={at:new Date().toISOString(),event,count:b.rows.length,...(b.isolated?{scope:'isolated-frontier'}:{}),scrollTop:b.host.scrollTop,scrollHeight:b.host.scrollHeight,clientHeight:b.host.clientHeight,...details};
    trace.push(entry);
    const limit=b.mode==='predecessor-anchor'?1200:40;
    if(trace.length>limit){trace.shift();if(b.mode==='predecessor-anchor')b.recoveryTraceOverflow=(b.recoveryTraceOverflow||0)+1}
    if(event.startsWith('identity-rejoin-')){
      const saved=b.identityRejoinTrace||(b.identityRejoinTrace=[]);
      if(saved.length>=2048){saved.shift();b.identityRejoinTraceOverflow=(b.identityRejoinTraceOverflow||0)+1}
      saved.push(entry);
    }
    if(event.startsWith('bottom-escape-')){
      const saved=b.bottomEscapeTrace||(b.bottomEscapeTrace=[]);
      if(saved.length>=64){saved.shift();b.bottomEscapeTraceOverflow=(b.bottomEscapeTraceOverflow||0)+1}
      saved.push(entry);
    }
  }
  function historyFoldObservation(b,observation){
    if(b.mode==='predecessor-anchor'&&observation.messageId!==b.anchorId)return;
    const key=JSON.stringify(observation);
    if(b.foldObservations.has(key))return;
    if(b.foldObservations.size>=2000){b.foldObservationOverflow++;return}
    b.foldObservations.set(key,observation);
  }
  function historyAttachmentChange(b,change){
    if(b.mode==='predecessor-anchor'&&change.messageId!==b.anchorId)return;
    const key=JSON.stringify(change);
    if(change.type==='folded-user-tail-variant'){
      const list=b.foldTailVariants||(b.foldTailVariants=[]);
      if(list.some(x=>JSON.stringify(x)===key))return;
      if(list.length>=1000)throw Error('折疊尾端差異證據達容量上限，保全退出');
      list.push(change);return;
    }
    if(change.type==='code-render-label-variant'){
      const list=b.renderChanges||(b.renderChanges=[]),keys=b.renderChangeKeys||(b.renderChangeKeys=new Set());
      if(keys.has(key))return;
      if(list.length>=1000){b.renderChangeOverflow=(b.renderChangeOverflow||0)+1;return}
      keys.add(key);list.push(change);return;
    }
    if(b.attachmentChangeKeys.has(key))return;
    if(b.attachmentChanges.length>=1000){b.attachmentChangeOverflow++;return}
    b.attachmentChangeKeys.add(key);b.attachmentChanges.push(change);
  }
  function historyPayload(b,status,error){
    const rows=(b.isolated?b.isolated.originalRows:b.sample?pc.sampleRows(b.rows,b.sample):b.rows).map((r,index)=>({...r,index})),warnings=[];
    const compositeCount=rows.filter(r=>r.identityBasis==='unresolved-native-composite').length+(b.isolated?b.rows.filter(r=>r.identityBasis==='unresolved-native-composite').length:0);
    if(compositeCount&&status==='completed'){status='failed';error='已抵達觀測頂端；複合原生訊息分界待核對，非正式完整聊天'}
    if(compositeCount)warnings.push('含 '+compositeCount+' 個複合原生單元，count 是顯示單元數而非原生訊息數；分界未核對，不得正式匯入或分類。僅供取證與手動指定保全續掃。');
    if(b.isolated)warnings.push('前沿圖片參照仍有未解衝突；正式 rows 保留原有則數，不合併隔離取證。獨立原文段見 evidence.isolatedSegment，禁止當完整聊天或正式續掃斷點。');
    warnings.push('前輩聊天仍以文字保全為主；唯一圖片特例為已辨識的 AI 單張純生成圖片回覆，嘗試保存當下渲染 blob 位元組至 evidence.generatedImageAssets。玩家圖片、混合文字圖片、原始伺服器圖片及所有圖片數量一致性不在驗收範圍。');
    if(b.sample)warnings.push('最近'+b.sample+'則測試：僅供診斷，禁止當完整聊天匯入或分類。');
    if(b.nativeHistoryRetry?.attempts)warnings.push('曾觸發原生歷史載入重試；錯誤消失不代表訊息已取得，仍依原文重疊及前沿核對。');
    if(b.trustedWheelCount)warnings.push('掃描期間觀測到可信滾輪輸入，不能當成無人工介入的自動驗收；來源可能是使用者或瀏覽器自動化。');
    if(b.foldObservations.size)warnings.push('前輩掃描不點擊展開／收合；已掛載正文照讀，折疊觀測及確定移除的尾端介面標籤另存證據，未獨立驗證折疊正文完整性，需後續核對。');
    if(b.attachmentChanges.some(x=>!x.type))warnings.push('臨時圖片 blob 網址曾變動；僅核對附件參照位置與標籤，未驗證圖片位元組。');
    if(b.attachmentChanges.some(x=>x.type==='image-reference-accepted-window-bridge-enriched'))warnings.push('圖片參照透過同批已核對視窗的暫時網址補接；保留三份參照，未驗證圖片位元組或原始附件數量。');
    if(b.attachmentChanges.some(x=>x.type))warnings.push('玩家圖片參照曾延遲出現或未觀測到；保留已觀測的圖片參照及前後快照，附件數量與原始位元組尚未驗證。');
    if(b.renderChanges?.length)warnings.push('程式碼框介面標籤與文字節點拆分經逐字核對等價；原先收錄不改寫，兩份觀測保存在 codeRenderVariants，非伺服器原始格式。');
    if(b.foldTailVariants?.length)warnings.push('玩家折疊尾端差異僅核對同ID及其他原文欄位；保留舊正文、兩份觀測及折疊證據，完整原文尚未驗證，請見 foldTailVariants。');
    if(b.resume)warnings.push('續掃沿用先前保全 '+b.resume.baseCount+' 則；本次僅驗證已重新經過的視窗，不代表舊正文全部重新收錄。'+(b.resume.currentPosition&&!b.resume.tailVerified?'本次尾端尚未重新核對，僅沿用舊底端證據；候選不可作完成檔。':'來源 SHA-256 及驗證狀態見 evidence.resume。'));
    for(let i=0;i<rows.length;i++)if((i===0&&rows[i].role!=='user')||(i>0&&rows[i].role===rows[i-1].role))warnings.push('角色序列需人工確認：原始索引 '+i+'（保留，不猜測配對）');
    if(rows.at(-1)?.role==='user')warnings.push('尾端玩家尚無 GPT 回覆；原樣保留');
    if(rows.some(r=>r.attachments.length))warnings.push('附件僅保留可見名稱／連結參照，未證明附件原始位元組已保存');
    if(rows.some(r=>r.contentBasis==='composite-after-user-dom'))warnings.push('無標記 GPT 回覆以唯一玩家邊界後的完整 DOM 文字節點讀取；保留分段證據，非伺服器原始 Markdown');
    return {format:compositeCount?pc.COMPOSITE:b.sample?pc.SAMPLE:pc.FORMAT,...(compositeCount?{importable:false}:{}),...(b.sample?{scope:'sample-'+b.sample,sampleLimit:b.sample,importable:false}:{}),version:1,canonical:false,fidelity:'rendered-dom',status,runId:b.runId,title:b.title,chatId:b.chat.split('/').at(-1),sourceUrl:location.origin+b.chat,startedAt:b.startedAt,finishedAt:new Date().toISOString(),scannerVersion:chrome.runtime.getManifest().version,count:rows.length,rows,warnings,error:error||null,evidence:{bottomReached:b.bottomReached,topReached:b.topReached,bottomStableMs:b.bottomStableMs,topStableMs:b.topStableMs,continuity:status==='completed'&&!compositeCount,...(compositeCount?{unresolvedCompositeCount:compositeCount,displayUnitContinuityOnly:true}:{}),firstId:rows[0]?.id||null,lastId:rows.at(-1)?.id||null,windows:b.windows,coverage:'rendered-branch-only; no independent server manifest',imagePolicy:'omit-images-except-proven-assistant-generated-image-only; observed-bytes-only',generatedImageAssets:historyGeneratedImageExport(b,rows),generatedImageOverflow:b.generatedImageOverflow||0,lastReadIssue:status==='completed'?null:b.lastReadIssue||null,overlapIssues:b.overlapIssues,attachmentReferenceChanges:b.attachmentChanges,attachmentChangeOverflow:b.attachmentChangeOverflow,codeRenderVariants:b.renderChanges||[],codeRenderVariantOverflow:b.renderChangeOverflow||0,attachmentBytesVerified:false,attachmentCountVerified:false,scrollStats:b.scrollStats,nativeHistoryRetry:b.nativeHistoryRetry||{attempts:0,cleared:0,sinceProgress:0,progressResets:0,trace:[]},trustedWheelCount:b.trustedWheelCount||0,trustedWheelTrace:b.trustedWheelTrace||[],trustedWheelOverflow:b.trustedWheelOverflow||0,knownMinimum:b.knownMinimum,resume:b.resume||null,...(b.isolated?{isolatedSegment:{format:'gal-predecessor-frontier-evidence',importable:false,count:b.rows.length,rows:b.rows.map((r,index)=>({...r,index})),anchor:b.isolated.anchor,startedAt:b.isolated.startedAt,topReached:!!b.isolated.topReached,topStableMs:b.isolated.topStableMs||0,windows:b.isolated.windows,sourceSha256:b.resume?.sourceSha256||null}}:{}),checkpointExports:b.checkpointExports||[],hostProof:b.hostProof||null,breakthroughState:b.breakthrough||null,scrollTrace:b.scrollTrace,unjoinedWindows:b.unjoinedWindows||[],unjoinedOverflow:b.unjoinedOverflow||0,identityRejoinTrace:b.identityRejoinTrace||[],identityRejoinTraceOverflow:b.identityRejoinTraceOverflow||0,bottomEscapeTrace:b.bottomEscapeTrace||[],bottomEscapeTraceOverflow:b.bottomEscapeTraceOverflow||0,stabilityIssues:b.stabilityIssues,readMode:'passive-no-expand',foldObservations:[...b.foldObservations.values()],foldObservationOverflow:b.foldObservationOverflow,inheritedFoldObservations:b.resumeFoldObservations||[],foldTailVariants:b.foldTailVariants||[]}};
  }
  function historyDownload(data){
    const file=(data.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').slice(0,95)||'未命名聊天')+'_'+data.chatId+'_'+data.runId+'_'+data.status+(data.evidence?.checkpoint?'_斷點'+(data.evidence.isolatedSegment?.count??data.count):'')+'.json';
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=(data.format==='gal-predecessor-prefix-supplement-evidence'?'前輩頂端補掃取證_':data.format===pc.COMPOSITE?'前輩複合待核對_':data.format===pc.SAMPLE?(data.sampleLimit===20?'前輩二十則測試_':'前輩十則測試_'):'前輩聊天_')+file;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return a.download;
  }
  async function historyRemember(b,data){
    if(b.sample||b.isolated||data.format===pc.COMPOSITE||data.status==='completed'||(b.resume&&(!b.resume.frontierVerified||data.count<=b.resume.baseCount)))return;
    try{
      const source=location.origin+b.chat;
      pc.validateCheckpoint(data,source);
      const result=await GalCheckpointMemory.save(chrome.storage.local,new TextEncoder().encode(JSON.stringify(data,null,2)),source,pc,undefined,true);
      b.memoryStatus=result.unchanged?'本機保全未變更':'本機已記住 '+result.count+' 則（'+result.slot+'）';
    }catch(e){b.memoryStatus='本機保全記憶未更新：'+String(e.message||e)}
  }
  // Navigation-only identity hint. A mounted marker is NOT proof of a
  // readable row; historySettled and mergeUp still certify the entire window.
  function historyMountedFrontier(host,id){
    const root=historyRoot(host),m=/^(user|assistant)\|(turn|message):([a-zA-Z0-9_-]+)$/.exec(id||'');
    if(!m)return false;
    const [,role,kind,native]=m;
    if(kind==='turn')return [...root.querySelectorAll('[data-turn-key]')].some(n=>n.getAttribute('data-turn-key')===native&&historyVisible(n));
    if(role==='assistant'&&[...root.querySelectorAll('[data-response-body]')].some(n=>n.getAttribute('data-response-body')===native&&historyVisible(n)))return true;
    return [...root.querySelectorAll('[data-message-id],[data-source-message-id],[data-dil-message-id]')].some(n=>historyVisible(n)&&['data-message-id','data-source-message-id','data-dil-message-id'].some(a=>n.getAttribute(a)===native));
  }
  // Native markers guide navigation only; even a matching marker may have
  // no readable user body, or be separated from the next row by a gap.
  function historyMountedRanks(host,saved){
    const root=historyRoot(host),ranks=new Map(),found=new Map();
    saved.forEach((r,i)=>{const key=r.id.split('|')[1];if(key){const a=ranks.get(key)||[];a.push(i);ranks.set(key,a)}});
    const selectors=[['[data-turn-key]','data-turn-key','turn:'],['[data-response-body]','data-response-body','message:'],['[data-message-id],[data-source-message-id],[data-dil-message-id]','data-message-id','message:']];
    for(const [selector,attr,prefix] of selectors)for(const n of root.querySelectorAll(selector)){
      if(!historyVisible(n))continue;
      const value=n.getAttribute(attr)||(attr==='data-message-id'&&(n.getAttribute('data-source-message-id')||n.getAttribute('data-dil-message-id')));
      for(const rank of ranks.get(prefix+value)||[])if(!found.has(rank))found.set(rank,n);
    }
    return found;
  }
  function historyIdentityWindow(saved,live,requirePair=false){
    const ranks=new Map(saved.map((r,i)=>[r.id,i]));
    const known=live.map((r,i)=>({i,rank:ranks.get(r.id)})).filter(x=>x.rank!==undefined);
    if(!known.length||known[0].rank!==0||known.at(-1).i!==live.length-1)return false;
    if(requirePair&&known.length<2)return false;
    return known.every((x,i)=>x.rank===i&&x.i===known[0].i+i);
  }
  async function historyRejoinByIdentity(b,deadline){
    const startIndex=b.resume&&!b.resume.frontierVerified?Math.max(0,b.rows.findIndex(r=>r.id===b.resumeRows?.[b.resume.minIndex]?.id)):0;
    const saved=b.rows.slice(startIndex),id=saved[0]?.id,host=b.host;
    if(!id)return null;
    const stats=b.scrollStats;
    stats.identityRejoinAttempts=(stats.identityRejoinAttempts||0)+1;
    const record=(event,details={})=>historyTrace(b,'identity-rejoin-'+event,{anchorId:id,...details});
    // Do not reset to the bottom: a disjoint window can already be older
    // than the saved frontier. Relative navigation is not an archive merge.
    record('start',{startIndex});historyStatus(b,'依原生前沿ID重新接合');
    const maxSteps=16384,requirePair=!!(b.resume&&!b.resume.frontierVerified);
    let steps=0,stalled=0,snaps=0,consecutiveSnaps=0,steady=0,edges=0,direction=historyAtBottom(host)?-1:1,best=Infinity;
    let lastProgress=Date.now(),lastProbe='',lastProbeAt=0,failedProbes=0,sweep=null;
    const recent=[];
    const beginSweep=(why)=>{if(!sweep){sweep={direction,remaining:4,span:4,pass:0};record('local-sweep-start',{steps,why,direction})}};
    while(steps<=maxSteps&&Date.now()<deadline&&Date.now()-lastProgress<300000){
      historyGuard(b);
      const hints=historyMountedRanks(host,saved),ranks=[...hints.keys()].sort((a,c)=>a-c);
      if(ranks.length&&ranks[0]<best){best=ranks[0];lastProgress=Date.now();failedProbes=0;sweep=null;recent.length=0;record('rank-progress',{steps,best})}
      if(hints.has(0)){
        const key=JSON.stringify([Math.round(host.scrollTop),host.scrollHeight,ranks]);
        if(key!==lastProbe||Date.now()-lastProbeAt>=1500){
          lastProbe=key;lastProbeAt=Date.now();record('mounted',{steps,snaps,ranks:ranks.slice(0,8)});
          let live=null;
          try{live=await historySettled(b,{deadline:Math.min(deadline,Date.now()+8000),upward:true,target:null,allowBoost:false})}
          catch(e){record('probe-failed',{steps,reason:String(e.message||e)});historyGuard(b)}
          if(live&&historyIdentityWindow(saved,live,requirePair)){
            record('stable-hit',{steps,firstId:live[0]?.id,lastId:live.at(-1)?.id});return live;
          }
          record('marker-only',{steps,liveIds:live?.map(r=>r.id)||[]});failedProbes++;
        }
        const rect=hints.get(0)?.getBoundingClientRect?.(),hr=host.getBoundingClientRect?.();
        if(rect&&hr&&rect.bottom<=hr.top)direction=-1;
        else if(rect&&hr&&rect.top>=hr.bottom)direction=1;
        else direction=1; // expose the next adjacent row, not an assumed gap
      }else if(ranks.length)direction=-1;
      // A marker can stay mounted far outside the viewport. Alternating
      // its rectangle-based direction can trap the walker in one spot.
      // Expand a bounded relative sweep, not the acceptance criteria.
      const cell=JSON.stringify([Math.round(host.scrollTop/Math.max(1,host.clientHeight*.25)),Math.round(host.scrollHeight/Math.max(1,host.clientHeight)),ranks.slice(0,4)]);
      recent.push(cell);if(recent.length>12)recent.shift();
      if(failedProbes>=2)beginSweep('marker-without-stable-overlap');
      else if(recent.filter(x=>x===cell).length>=4)beginSweep('repeated-local-position');
      if(sweep)direction=sweep.direction;
      if(steps===maxSteps)break;
      // Loading indicators may persist while relative scroll remains possible.
      // Never accept a loading window; historySettled still gates that read.
      const loading=historyLoading(host);
      if(await historyNativeRetry(b,deadline))continue;
      const before=host.scrollTop,viewport=host.clientHeight;
      if(viewport<=0)break;
      if((direction<0&&before<=2)||(direction>0&&historyAtBottom(host))){
        if(++edges>12)break;direction=-direction;if(sweep){sweep.direction=direction;sweep.remaining=Math.max(4,sweep.remaining)}record('edge-turn',{steps,direction,edges});
      }
      const cautious=consecutiveSnaps>0||loading;
      const ratio=sweep?Math.min(2,1+sweep.pass*.5):(hints.has(0)||cautious?.5:1);
      const delta=direction*Math.max(1,Math.floor(viewport*ratio));
      if(typeof host.scrollBy==='function')host.scrollBy({top:delta,behavior:'instant'});
      else historyScroll(host,before+delta);
      await sleep(sweep?250:cautious?150:50);steps++;
      if(sweep&&--sweep.remaining<=0){sweep.pass++;sweep.span=Math.min(32,sweep.span*2);sweep.remaining=sweep.span;sweep.direction=-sweep.direction;record('local-sweep-turn',{steps,pass:sweep.pass,span:sweep.span,direction:sweep.direction})}
      stats.identityRejoinSteps=(stats.identityRejoinSteps||0)+1;
      const actual=host.scrollTop;
      const bottomReturn=delta<0&&historyAtBottom(host)&&actual>=before-1;
      if(bottomReturn){
        // A jump or failure to leave the bottom is not a terminal condition.
        // Keep independent time/step budgets; do not turn a bottom hold into
        // the three-stalled-movements abort.
        const jumped=actual>before+viewport;if(jumped)snaps++;
        consecutiveSnaps++;steady=0;stalled=0;
        record(jumped?'bottom-snap':'bottom-hold',{steps,snaps,consecutiveSnaps,before,actual,loading});
        direction=-1;if(sweep){sweep.direction=-1;sweep.remaining=Math.max(4,sweep.remaining)}await sleep(500);
      }else if(Math.abs(actual-before)>=1){if(++steady>=32){consecutiveSnaps=0;steady=0}}
      if(steps%16===0)record('relative-progress',{steps,best:Number.isFinite(best)?best:null,before,actual,loading,delta,rankCount:ranks.length});
      if(Math.abs(actual-before)<1){if(!bottomReturn&&++stalled>=12)break;await sleep(150)}else stalled=0;
    }
    record('not-located',{steps,snaps,stalled,failedProbes,sweep,best:Number.isFinite(best)?best:null});return null;
  }
  // At the end only: verify the live tail before any completion claim.
  // No mutation of the accumulated prefix until the actual bottom is stable.
  async function historyVerifyDeferredTail(b){
    historyStatus(b,'頂端已取證；最後核對目前聊天尾端');
    let stable=0,prev=null;const deadline=Date.now()+60000;
    for(;;){
      historyGuard(b);if(Date.now()>deadline)throw Error('尾端尚未重新核對；保留候選斷點，禁止宣告完整');
      historyScroll(b.host,b.host.scrollHeight);
      const rows=await historySettled(b,{deadline});
      historyHostObservation(b);
      const sig=JSON.stringify([pc.fingerprint(rows),b.host.scrollHeight]);
      if(historyAtBottom(b.host)&&sig===prev){
        if(!stable)stable=Date.now();
        if(pc.edgeProof(rows,b.rows,{edge:'bottom',atEdge:true,stableMs:Date.now()-stable,loading:historyLoading(b.host)||!!historyNativeFailure(b.host),...historyEdgeOrdinal(b,'bottom')})){
          const changes=[],seed=pc.resumeSeed(b.rows,rows,x=>changes.push(x),{source:b.resumeFoldObservations,current:b.foldObservations,currentOverflow:b.foldObservationOverflow,sourceSha256:b.resume.sourceSha256,attachmentBridges:b.acceptedAttachmentBridges});
          if(seed.rows.length!==b.rows.length)throw Error('尾端出現未核定新訊息；不得改寫候選');
          b.rows=seed.rows;for(const change of changes)historyAttachmentChange(b,change);
          b.bottomReached=true;b.bottomStableMs=Date.now()-stable;b.resume.tailVerified=true;b.resume.tailVerifiedAt=new Date().toISOString();b.resume.checkedWindows++;b.windows++;
          historyTrace(b,'resume-deferred-tail-verified',{matched:seed.matched});return;
        }
      }else{stable=0;prev=sig}
      await sleep(650);
    }
  }
  async function historyRun(b){
    let status='failed',error=null;
    try{
      await historyLocateHost(b);
      if(b.resume?.currentPosition){
        b.rows=b.resumeRows.slice();b.resume.minIndex=0;
        b.breakthrough={resets:0,attempts:0,frontier:{id:b.rows[0].id,top:b.host.scrollTop,height:b.host.scrollHeight}};
        historyStatus(b,'從目前位置核對保全前沿（不先返回底端）');
        const deadline=Date.now()+180000;
        let live=await historySettled(b,{deadline:Math.min(deadline,Date.now()+12000)});
        if(!historyIdentityWindow(b.resumeRows,live,true))live=await historyRejoinByIdentity(b,deadline);
        if(!live)throw Error('目前位置無法核對前沿；請人工滑到原保全最早兩則附近後重試，不會自動跳底');
        const seed=pc.resumeFrontierSeed(b.resumeRows,live,change=>historyAttachmentChange(b,change),{source:b.resumeFoldObservations,current:b.foldObservations,currentOverflow:b.foldObservationOverflow,sourceSha256:b.resume.sourceSha256,attachmentBridges:b.acceptedAttachmentBridges});
        b.acceptedAttachmentBridges=pc.rememberAttachmentObservations(b.acceptedAttachmentBridges||new Map(),seed.rows,live);
        b.rows=seed.rows;b.resume.frontierVerified=true;b.resume.frontierVerifiedAt=new Date().toISOString();b.resume.frontierPair=b.resumeRows.slice(0,2).map(r=>r.id);b.resume.checkedWindows=1;b.windows++;
        historyHostObservation(b);historyTrace(b,'resume-current-frontier-verified',{matched:seed.matched,tailDeferred:true});
      }else{
      historyStatus(b,'定位聊天最底端');
      let stable=0,prev=null,prevRows=null,bottomDeadline=Date.now()+60000;
      for(;;){
        historyGuard(b);if(Date.now()>bottomDeadline)throw Error('60秒內無法確認完整底端');
        historyScroll(b.host,b.host.scrollHeight);const rows=await historySettled(b,{deadline:bottomDeadline});
        historyHostObservation(b);
        const sig=JSON.stringify([pc.fingerprint(rows),b.host.scrollHeight]);
        if(sig===prev&&prevRows)for(let i=0;i<rows.length;i++)for(const change of pc.compareRow(prevRows[i],rows[i]).changes)historyAttachmentChange(b,change);
        prevRows=rows;
        if(historyAtBottom(b.host)&&sig===prev){if(!stable)stable=Date.now();if(pc.edgeProof(rows,rows,{edge:'bottom',atEdge:true,stableMs:Date.now()-stable,loading:historyLoading(b.host),...historyEdgeOrdinal(b,'bottom')})){b.bottomStableMs=Date.now()-stable;b.bottomReached=true;b.rows=pc.mergeUp([],rows);b.windows++;break}}
        else{stable=0;prev=sig}
        // Keep the most recent observed tail as emergency evidence only.
        b.rows=rows;await sleep(650);
      }
      }
      let topSince=0,topSignature=null,lastGrowth=Date.now(),lastCount=b.rows.length,edgeAttempt=0,unchanged=0;
      b.breakthrough={resets:0,attempts:0,frontier:{id:b.rows[0]?.id,top:b.host.scrollTop,height:b.host.scrollHeight}};
      if(b.sample&&pc.sampleReady(b.rows,b.bottomReached,b.topReached,b.sample))status='completed';
      if(b.resume&&!b.resume.currentPosition){
        const seed=pc.resumeSeed(b.resumeRows,b.rows,change=>historyAttachmentChange(b,change),{source:b.resumeFoldObservations,current:b.foldObservations,currentOverflow:b.foldObservationOverflow,sourceSha256:b.resume?.sourceSha256,attachmentBridges:b.acceptedAttachmentBridges});
        b.acceptedAttachmentBridges=pc.rememberAttachmentObservations(b.acceptedAttachmentBridges||new Map(),seed.rows,b.rows);
        b.rows=seed.rows;b.resume.tailVerified=true;b.resume.tailVerifiedAt=new Date().toISOString();b.resume.frontierVerified=seed.frontier;if(seed.frontier)b.resume.frontierVerifiedAt=b.resume.tailVerifiedAt;b.resume.minIndex=seed.minIndex;b.resume.checkedWindows=1;
        lastCount=b.rows.length;lastGrowth=Date.now();
        b.breakthrough.frontier={id:b.resumeRows[seed.minIndex].id,top:b.host.scrollTop,height:b.host.scrollHeight};
        historyTrace(b,'resume-tail-verified',{baseCount:b.resume.baseCount,minIndex:seed.minIndex,matched:seed.matched});
      }
      let verifiedViewport={top:b.host.scrollTop,height:b.host.scrollHeight};
      let nextCheckpoint=Math.floor(b.rows.length/100)*100+100;
      while(status!=='completed'){
        historyGuard(b);
        const pos=b.host.scrollTop;
        const state=b.breakthrough,frontier=pc.frontierPosition(state.frontier,b.host.scrollHeight,b.host.clientHeight);
        const boost=state.recoveryAvoidFrontier?0:pc.breakthroughStep(state,b.host.clientHeight);
        const origin=boost&&frontier!==null?Math.min(pos,frontier):pos;
        const rapid=b.resume&&!b.isolated&&!b.resume.frontierVerified?pc.resumeStep(b.host.clientHeight,b.resume.minIndex):0;
        const step=boost||rapid||pc.scrollStep(b.host.clientHeight,unchanged);
        if(boost&&origin>2){
          state.attempts++;b.scrollStats.breakthroughAttempts=(b.scrollStats.breakthroughAttempts||0)+1;
          historyTrace(b,'breakthrough-attempt',{attempt:state.attempts,resets:state.resets,from:origin,to:Math.max(0,origin-step),step,anchor:state.frontier?.id||null});
        }
        const growthLimit=b.sample||b.isolated?60000:180000;
        if(pc.noNewRows(lastGrowth,Date.now(),growthLimit)){historyTrace(b,'no-new-rows-timeout');throw Error((growthLimit/1000)+'秒未取得新訊息；已保全，禁止無限重複掃描')}
        const deadline=lastGrowth+growthLimit;
        let rows=null,lastError='';
        // Keep the last verified viewport in its original coordinate frame.
        // Rebase each retry, and never trigger another breakthrough while
        // attempting to rejoin a lost overlap.
        const currentHeight=b.host.scrollHeight;
        const savedAnchor=pc.verifiedViewportAnchor(verifiedViewport,pos,currentHeight,b.host.clientHeight);
        const anchor=savedAnchor||{top:pos,height:currentHeight};
        if(savedAnchor){
          b.scrollStats.interWindowBottomReturns=(b.scrollStats.interWindowBottomReturns||0)+1;
          historyTrace(b,'inter-window-bottom-return',{actual:pos,height:currentHeight,verifiedTop:anchor.top,verifiedHeight:anchor.height,estimated:pc.frontierPosition(anchor,currentHeight,b.host.clientHeight)});
        }
        // V0.10.41 observed-top navigation: exhaust geometric overlap probes, not long-range identity searches.
        const plans=[{ratio:1},{ratio:1,rebase:false,alternate:true},{ratio:.5},{ratio:.25},{ratio:.125},{ratio:0},
          ...[1,-1,2,-2,4,-4].map(offset=>({ratio:0,offset})),
          {ratio:0,rebase:false}];
        // The historical sequence remains first. If a virtual remount breaks
        // its last-viewport estimate, also probe the last independently
        // verified advancing frontier, not a distant identity search.
        if(!b.sample&&!b.isolated&&state.frontier?.id&&state.frontier.id===(b.resume&&!b.resume.frontierVerified?b.resumeRows[b.resume.minIndex]?.id:b.rows[0]?.id)&&Number.isFinite(state.frontier.top)&&Number.isFinite(state.frontier.height)&&Math.abs(state.frontier.top-anchor.top)>=b.host.clientHeight*.5){
          plans.push({ratio:0,frontier:true},{ratio:0,frontier:true,rebase:false});
        }
        // A prepend can change the coordinate frame before this iteration
        // starts. Keep the actual last accepted viewport and advancing
        // frontier, rather than rebasing an already shifted live coordinate.
        // These bounded probes are fallback only; mergeUp still proves overlap.
        if(!b.sample&&!b.isolated){
          for(const growth of ['viewport','frontier']){
            plans.push({ratio:0,growth},{ratio:0,growth,offset:1},{ratio:0,growth,offset:-1},{ratio:0,growth,rebase:false});
          }
        }
        let recovering=false,attempted=new Set();
        for(const plan of plans){
          const {ratio,offset=0,rebase=true,alternate=false,frontier:useFrontier=false,growth}=plan;
          if(alternate&&!lastError.startsWith('頁面反覆自動返回底端'))continue;
          if(useFrontier&&(lastError!=='視窗沒有重疊訊息'||Math.abs(b.host.scrollHeight-state.frontier.height)<b.host.clientHeight))continue;
          if((offset||!rebase)&&lastError!=='視窗沒有重疊訊息'&&!lastError.startsWith('頁面反覆自動返回底端'))break;
          historyGuard(b);
          if(Date.now()>=deadline)break;
          const targetHeight=b.host.scrollHeight;
          const frontierId=b.resume&&!b.resume.frontierVerified?b.resumeRows[b.resume.minIndex]?.id:b.rows[0]?.id;
          const growthAnchor=growth&&lastError==='視窗沒有重疊訊息'?pc.heightGrowthRejoinAnchor(growth==='viewport'?verifiedViewport:state.frontier?.id===frontierId?state.frontier:null,targetHeight,b.host.clientHeight):null;
          if(growth&&!growthAnchor)continue;
          const baseAnchor=growthAnchor|| (useFrontier?state.frontier:ratio===1&&!recovering&&!savedAnchor?{top:origin,height:anchor.height}:anchor);
          const basis=growth?'height-growth-'+growth:useFrontier?'verified-frontier':'verified-viewport';
          const target=pc.rejoinTarget(baseAnchor,targetHeight,b.host.clientHeight,offset*b.host.clientHeight-step*ratio,rebase);
          const key=JSON.stringify([Math.round(target),targetHeight,!!state.recoveryAvoidFrontier]);
          if(recovering&&attempted.has(key))continue;
          attempted.add(key);
          if(recovering){
            b.scrollStats.rejoinAttempts=(b.scrollStats.rejoinAttempts||0)+1;
            historyTrace(b,'rejoin-attempt',{ratio,offset,rebase,target,anchorTop:baseAnchor.top,anchorHeight:baseAnchor.height,expectedHeight:targetHeight,anchorId:state.frontier?.id||null,basis});
          }
          const nativeRetried=await historyNativeRetry(b,deadline);
          if(!nativeRetried){historyScroll(b.host,target);await sleep(180);b.scrollStats.attempts++}
          try{rows=await historySettled(b,{deadline,upward:true,target:nativeRetried?null:target,targetHeight:nativeRetried?null:targetHeight,allowBoost:!recovering})}catch(e){
            historyTrace(b,'settle-failed',{ratio,step,target,targetHeight,reason:String(e.message||e)});
            if(e.code!=='HISTORY_RECOVERY_RETRY'&&(b.sample||b.isolated||!String(e.message||e).includes('等待逾時：恢復向上捲動位置')))throw e;
            lastError=String(e.message||e);recovering=true;rows=null;
            pc.alternateRecoveryPolicy(state);
            b.scrollStats.recoveryPlanRetries=(b.scrollStats.recoveryPlanRetries||0)+1;
            historyTrace(b,'recovery-next-plan',{ratio,offset,rebase,target});
            continue;
          }
          try{
            const changes=[];
            const merged=pc.mergeUp(b.rows,rows,change=>changes.push(change),{source:b.resumeFoldObservations,current:b.foldObservations,currentOverflow:b.foldObservationOverflow,sourceSha256:b.resume?.sourceSha256,attachmentBridges:b.acceptedAttachmentBridges});
            if(b.resume&&!b.isolated&&!b.resume.frontierVerified){
              const q=pc.resumeWindow(b.resumeRows,rows);
              if(merged.length>b.rows.length&&!q.frontier)throw Error('續掃前沿未核對，不能增加舊訊息');
              b.resume.checkedWindows++;
              if(q.minIndex<b.resume.minIndex){
                b.resume.minIndex=q.minIndex;lastGrowth=Date.now();unchanged=0;state.resets=0;state.attempts=0;pc.clearRecoveryPolicy(state);historyNativeProgress(b,'resume-earlier-index');
                state.frontier={id:b.resumeRows[q.minIndex].id,top:b.host.scrollTop,height:b.host.scrollHeight};
                historyTrace(b,'resume-progress',{minIndex:q.minIndex,matched:q.matched});
              }
              if(q.frontier){
                b.resume.frontierVerified=true;b.resume.frontierVerifiedAt=new Date().toISOString();lastGrowth=Date.now();unchanged=0;
                historyTrace(b,'resume-frontier-verified',{id:b.resumeRows[0].id,matched:q.matched});
              }
            }
            b.acceptedAttachmentBridges=pc.rememberAttachmentObservations(b.acceptedAttachmentBridges||new Map(),merged,rows);
            b.rows=merged;for(const change of changes)historyAttachmentChange(b,change);b.windows++;if(b.isolated)b.isolated.windows++;
            if(recovering){b.scrollStats.rejoinSuccesses=(b.scrollStats.rejoinSuccesses||0)+1;historyTrace(b,'rejoin-success',{ratio,offset,target,firstId:rows[0]?.id,lastId:rows.at(-1)?.id,basis})}
            lastError='';break;
          }catch(e){
            b.scrollStats.overlapRetries++;lastError=String(e.message||e);
            historyTrace(b,'overlap-retry',{ratio,step,target,targetHeight,reason:lastError,firstId:rows[0]?.id,lastId:rows.at(-1)?.id,liveIds:rows.map(r=>r.id),savedFirstId:b.rows[0]?.id});
            if(e.overlapEvidence){if(b.overlapIssues.length>=8)b.overlapIssues.shift();b.overlapIssues.push({at:new Date().toISOString(),ratio,scrollTop:b.host.scrollTop,reason:lastError,...e.overlapEvidence})}
            // Preserve stable disjoint windows as diagnostic-only evidence.
            // They never enter b.rows, checkpoint identity, or coverage proof.
            if(!b.sample&&!b.isolated&&lastError==='視窗沒有重疊訊息'){
              const windows=b.unjoinedWindows||(b.unjoinedWindows=[]),fingerprint=pc.fingerprint(rows);
              if(!windows.some(w=>w.fingerprint===fingerprint)){
                const size=JSON.stringify(rows).length;
                if(windows.length<6&&(b.unjoinedUnits||0)+size<=1000000){
                  b.unjoinedUnits=(b.unjoinedUnits||0)+size;
                  windows.push({importable:false,observedAtMs:Date.now(),scrollTop:b.host.scrollTop,scrollHeight:b.host.scrollHeight,fingerprint,rows:rows.slice()});
                }else b.unjoinedOverflow=(b.unjoinedOverflow||0)+1;
              }
            }
            // Do not merge a disjoint attachment conflict. Capture a separate
            // independent earlier segment only if its complete visible window
            // proves a contiguous old prefix and actual earlier rows.
            if(!b.sample&&!b.isolated&&b.resume?.tailVerified&&!b.resume.frontierVerified&&e.overlapEvidence?.messageId===b.rows[0]?.id){
              const proof=pc.isolateFrontierWindow(b.rows,rows);
              if(proof){
                b.isolated={originalRows:b.rows,anchor:proof,startedAt:new Date().toISOString(),windows:1};
                b.rows=rows.slice();b.acceptedAttachmentBridges=new Map();
                lastCount=rows.length-proof.newPrefixCount;unchanged=0;topSignature=null;topSince=0;edgeAttempt=0;
                b.windows++;historyTrace(b,'isolated-frontier-start',{newPrefixCount:proof.newPrefixCount,matchedNeighbors:proof.matchedNeighbors});
                lastError='';break;
              }
            }
            rows=null;recovering=true;
          }
        }
        if(!rows)throw Error('無法核對前後視窗連續性：'+lastError);
        verifiedViewport={top:b.host.scrollTop,height:b.host.scrollHeight};
        historyHostObservation(b);
        historyStatus(b,b.isolated?'附件待核對・獨立向上取證':b.sample?'最近'+b.sample+'則測試':b.resume&&!b.resume.frontierVerified?'急速返回・已核對舊索引 '+(b.resume.minIndex+1)+'／'+b.resume.baseCount:'向上掃描');
        if(b.sample&&pc.sampleReady(b.rows,b.bottomReached,b.topReached,b.sample)){historyTrace(b,'sample-completed',{step,from:pos});status='completed';break}
        const atTop=b.host.scrollTop<=2,sig=JSON.stringify([rows[0]?.id,b.rows.length,b.host.scrollHeight]);
        if(atTop){
          if(!edgeAttempt)edgeAttempt=Date.now();
          if(sig!==topSignature){topSignature=sig;topSince=Date.now()}
          if(pc.edgeProof(rows,b.rows,{edge:'top',atEdge:true,stableMs:Date.now()-topSince,loading:historyLoading(b.host)||!!historyNativeFailure(b.host),...historyEdgeOrdinal(b,'top')})){
            if(b.isolated){
              if(pc.scrollRange(b.host.scrollHeight,b.host.clientHeight)<=8||!b.hostProof?.observedMovement)throw Error('隔離取證疑似假頂端，原檔仍未完成');
              b.isolated.topReached=true;b.isolated.topStableMs=Date.now()-topSince;
              throw Error('隔離取證已達觀測頂端；附件仍待核對，正式掃描未完成');
            }
            if(b.resume&&!b.resume.frontierVerified)throw Error('續掃尚未核對原斷點，禁止完成');
            if(!pc.fullCoverageGate(b.rows.length,b.sample?0:b.knownMinimum,b.hostProof.maxRange,b.hostProof.observedMovement)||pc.scrollRange(b.host.scrollHeight,b.host.clientHeight)<=8){historyTrace(b,'false-top-rejected',{knownMinimum:b.knownMinimum,hostProof:b.hostProof});throw Error('疑似假頂端：捲動證據不足或未達已知最低訊息數 '+b.knownMinimum)}
            b.topReached=true;b.topStableMs=Date.now()-topSince;
            if(b.resume?.currentPosition)await historyVerifyDeferredTail(b);
            status='completed';break}
          if(Date.now()-edgeAttempt>60000)throw Error('頁面已在頂端，但首則訊息或頂端穩定證據不符');
        }else{topSince=0;topSignature=null;edgeAttempt=0}
        if(b.rows.length>lastCount){
          if(state.attempts){b.scrollStats.breakthroughSuccesses=(b.scrollStats.breakthroughSuccesses||0)+1;historyTrace(b,'breakthrough-progress',{attempts:state.attempts,resets:state.resets,previousCount:lastCount});}
          historyTrace(b,'new-rows',{previousCount:lastCount,step,from:pos,firstId:rows[0]?.id,lastId:rows.at(-1)?.id});
          lastCount=b.rows.length;lastGrowth=Date.now();unchanged=0;state.resets=0;state.attempts=0;pc.clearRecoveryPolicy(state);historyNativeProgress(b,'new-rows');
          state.frontier={id:b.rows[0]?.id,top:b.host.scrollTop,height:b.host.scrollHeight};
        }
        else{unchanged++;b.scrollStats.noGrowthWindows++;historyTrace(b,'no-new-rows',{step,from:pos,unchanged,msSinceGrowth:Date.now()-lastGrowth,firstId:rows[0]?.id,lastId:rows.at(-1)?.id})}
        if(b.isolated&&nextCheckpoint>b.rows.length+100)nextCheckpoint=Math.floor(b.rows.length/100)*100+100;
        if(!b.sample&&b.rows.length>=nextCheckpoint&&(b.isolated||!b.resume||b.resume.frontierVerified)){
          nextCheckpoint=Math.floor(b.rows.length/100)*100+100;
          try{
            const snapshot=historyPayload(b,'failed','自動斷點保全：掃描仍在進行，非完整檔');
            snapshot.evidence.checkpoint=true;(snapshot.format===pc.COMPOSITE?pc.validateCompositeEvidence:pc.validateRaw)(snapshot);
            try{await historyRemember(b,snapshot)}catch(_){}
            const file=historyDownload(snapshot);(b.checkpointExports||(b.checkpointExports=[])).push({count:b.rows.length,file,triggered:true});
            historyTrace(b,'checkpoint-download',{count:b.rows.length,file});
          }catch(e){historyTrace(b,'checkpoint-download-failed',{reason:String(e.message||e)})}
        }
        if(pc.noNewRows(lastGrowth,Date.now(),growthLimit))throw Error((growthLimit/1000)+'秒未取得新訊息；已保全，禁止無限重複掃描');
        await sleep(150);
      }
    }catch(e){error=String(e.message||e);status=b.cancelled?'cancelled':'failed'}
    if(status==='completed'&&b.rows.some(r=>r.identityBasis==='unresolved-native-composite')){status='failed';error='已抵達觀測頂端；複合原生訊息分界待核對，非正式完整聊天'}
    const data=historyPayload(b,status,error);
    // Counts are only a local lower bound; never mix previous rows into this run.
    if(b.bottomReached&&!b.sample&&!b.isolated&&data.format!==pc.COMPOSITE&&b.rows.length>b.knownMinimum){try{await chrome.storage.local.set({['ga-predecessor-min:'+b.chat]:b.rows.length})}catch(e){data.warnings.push('本機最低數量紀錄保存失敗')}}
    try{(data.format===pc.COMPOSITE?pc.validateCompositeEvidence:b.sample?pc.validateSample:pc.validateRaw)(data)}catch(e){data.status='failed';data.error='輸出核對失敗：'+String(e.message||e);data.evidence.continuity=false}
    if(!b.sample&&!b.isolated&&data.status!=='completed'&&(!b.resume||data.count>b.resume.baseCount)){
      try{await historyRemember(b,data)}catch(_){}
    }
    b.download.onclick=event=>{event?.preventDefault();event?.stopPropagation();try{historyStatus(b,'已觸發下載：'+historyDownload(data))}catch(e){historyStatus(b,'下載觸發失敗，請重試：'+e.message)}};
    b.download.hidden=false;b.stop.textContent='✕ 關閉面板';b.stop.setAttribute?.('aria-label','關閉面板');b.stop.onclick=event=>{event?.preventDefault();event?.stopPropagation();b.pane.remove()};
    if(state.bulk===b)state.bulk=null;
    try{historyStatus(b,(data.status==='completed'?(b.sample?b.sample+'則測試完成（'+data.count+' 則）；':'已抵達頂端；'):'未完成：'+data.error+'；')+'已觸發下載 '+historyDownload(data)+'\n請核對下載檔，亦可按重新下載。'+(b.memoryStatus?'\n'+b.memoryStatus:''))}
    catch(e){historyStatus(b,'保全已留在本頁，下載觸發失敗：'+e.message)}
  }

  // Navigation only: no historyRead, archive rows, checkpoint, download or upload.
  function historyTopNavigationSnapshot(host,expectedId,names){
    const root=historyRoot(host);
    const owners=[...new Set([...root.querySelectorAll('[data-turn-key],[data-testid^="conversation-turn-"],[data-message-author-role]')].filter(historyVisible).map(historyOwner))];
    const first=owners[0];
    const key=first?.getAttribute('data-turn-key')||'';
    const firstId=key?'user|turn:'+key:'';
    const isUser=!!first&&(first.getAttribute('data-message-author-role')==='user'||outerUsers().some(n=>first.contains(n)));
    const labels=new Set();
    if(first&&isUser&&names.length){
      // Match visible attachment controls/labels, never the message body as a whole.
      for(const el of first.querySelectorAll('[data-testid*="attachment"],[data-testid*="file-chip"],button,a,[title],[aria-label]')){
        if(!historyVisible(el))continue;
        for(const value of [el.getAttribute('title'),el.getAttribute('aria-label'),el.innerText]){
          for(const line of String(value||'').split(/\r?\n/))if(line.trim())labels.add(line.trim());
        }
      }
    }
    const match=!!first&&isUser&&(!expectedId||firstId===expectedId)&&names.every(n=>labels.has(n));
    return {firstId,isUser,match,found:names.filter(n=>labels.has(n)).length,owner:first};
  }
  async function historyRushTop(expectedId,files,report,cancel=()=>false,borrowed=null){
    expectedId=String(expectedId||'').trim();
    const names=[...new Set(String(files||'').split(/[,，;；\n]/).map(x=>x.trim()).filter(Boolean))];
    if(expectedId&&!/^user\|turn:[a-zA-Z0-9_-]+$/.test(expectedId))return {ok:false,error:'開頭 ID 必須是 user|turn:…'};
    if(names.length>20||names.some(n=>n.length>200))return {ok:false,error:'附件條件過多或過長'};
    if(!valid()||state.scanning||state.activeSends||state.timeBusy||state.enabled||isGenerating()||
       (borrowed?(state.bulk!==borrowed.b||!borrowed.lock?.isConnected||borrowed.b.chat!==path()):(state.bulk||document.getElementById(HISTORY_PANEL))))return {ok:false,error:'請先停止本聊天的監看、生成或其他操作，並關閉前一批已保全面板'};
    const b=borrowed?.b||{mode:'predecessor-top-navigation',chat:path(),rows:[]};
    // Shared panel ID prevents another installed version starting a scan on this page.
    const lock=borrowed?.lock||document.createElement('section');
    if(!borrowed){lock.id=HISTORY_PANEL;lock.hidden=true;lock.dataset.gaExtensionId=chrome.runtime.id;state.bulk=b;document.body.append(lock)}
    let stableSince=null,lastSignature='',lastProgress=Date.now(),best=Infinity,lastHost=null,lastFirst='',lastHeight=0;
    const known=!!expectedId||names.length>0;
    const guard=()=>{if(cancel()||state.bulk!==b||!valid()||path()!==b.chat||isGenerating()||!lock.isConnected)throw Error('導航已停止或聊天狀態已變更');};
    try{
      while(true){
        guard();
        const h=historyHost(),now=Date.now();
        if(!h){
          stableSince=null;lastSignature='';
          if(now-lastProgress>=180000)throw Error('找不到有效聊天捲動容器');
          report('等待聊天載入（不掃描）');await sleep(600);continue;
        }
        const x=historyTopNavigationSnapshot(h,expectedId,names),top=h.scrollTop,height=h.scrollHeight,loading=historyLoading(h);
        if(h!==lastHost||x.firstId!==lastFirst||height!==lastHeight||top<best-8){
          if(h!==lastHost||height!==lastHeight)best=Infinity;
          lastProgress=now;best=Math.min(best,top);
          lastHost=h;lastFirst=x.firstId;lastHeight=height;
        }
        b.host=h;
        if(historyNativeFailure(h)){
          stableSince=null;lastSignature='';
          await historyNativeRetry(b,lastProgress+180000,{guard:()=>{guard();if(!h.isConnected||historyHost()!==h)throw Error('導航捲動容器已變更');},report,maxAttempts:Infinity});
          continue;
        }
        const signature=[top<=6,height,x.firstId,x.isUser,x.match,x.found].join('|');
        const eligible=top<=6&&!loading&&x.match&&/^user\|turn:[a-zA-Z0-9_-]+$/.test(x.firstId);
        if(!eligible||signature!==lastSignature)stableSince=null;
        if(eligible&&stableSince===null)stableSince=now;
        lastSignature=signature;
        if(eligible&&now-stableSince>=8000)return {ok:true,verified:known,message:known?'已確認抵達指定開頭（只導航，未掃描）':'已抵達觀測頂端；未指定開頭條件，尚未確認真正開頭'};
        if(now-lastProgress>=180000)throw Error(known?'180秒無新進展，未找到指定開頭；不能宣告抵頂':'180秒無新進展，未確認抵頂');
        report('只導航｜距頂 '+Math.round(top)+' px｜'+(known?(x.match?'開頭條件吻合，等待穩定':'尋找指定開頭；附件 '+x.found+'/'+names.length):(x.match?'觀測首則，等待穩定（非真開頭）':'等待有效玩家原生首則'))+(loading?'｜等待歷史載入':''));
        if(!loading&&(!eligible||top>6))historyScroll(h,0);
        await sleep(600);
      }
    }finally{if(!borrowed){if(state.bulk===b)state.bulk=null;lock.remove()}}
  }

  async function historyBegin(requestedTitle,sample=false,minimum=0,checkpoint=null,currentPosition=false){
    if(!pc||!valid())return {ok:false,error:'請開啟具體 ChatGPT 聊天並載入新版'};
    if(state.bulk||state.scanning||state.activeSends||state.timeBusy||isGenerating())return {ok:false,error:'此聊天正在監看擷取、掃描或生成，稍後再開始'};
    if(document.getElementById(HISTORY_PANEL))return {ok:false,error:'前一批保全仍在頁面，請確認下載並關閉面板後再開始'};
    const title=pc.chatTitle(requestedTitle||document.title);
    if(!title||title==='ChatGPT'||title.length>512)return {ok:false,error:'請輸入聊天的實際名稱'};
    const host=historyHost()||bulkHost();if(!host)return {ok:false,error:'找不到聊天捲動容器'};
    const b={mode:'predecessor-history',knownMinimum:pc.minimumCount(minimum),hostProof:null,sample:pc.sampleLimit(sample),attachmentChanges:[],attachmentChangeKeys:new Set(),attachmentChangeOverflow:0,overlapIssues:[],scrollTrace:[],stabilityIssues:[],foldObservations:new Map(),foldObservationOverflow:0,scrollStats:{attempts:0,loadingPolls:0,loadingNudges:0,overlapRetries:0,noGrowthWindows:0,scrollResets:0,bottomEscapeAttempts:0,bottomEscapeDepartures:0,stagedReturns:0,stagedReturnLandings:0,stagedReturnArrivals:0,stagedEnvelopeLandings:0,stagedReturnBackoffs:0,recoveryCycles:0,crossWindowCycles:0,cycleHolds:0,recoveryPlanRetries:0,frontierRestores:0,breakthroughAttempts:0,breakthroughSuccesses:0,rejoinAttempts:0,rejoinSuccesses:0,expansionClicks:0,expansionRestores:0,fingerprintChanges:0},chat:path(),title,host,rows:[],runId:crypto.randomUUID(),startedAt:new Date().toISOString(),bottomReached:false,topReached:false,bottomStableMs:0,topStableMs:0,windows:0,cancelled:false};
    if(checkpoint){
      if(b.sample)return {ok:false,error:'測試不能續掃'};
      try{
        b.resumeRows=pc.validateCheckpoint(checkpoint.data,location.origin+b.chat,true);
        if(!/^[a-f0-9]{64}$/.test(checkpoint.hash))throw Error('斷點雜湊無效');
        b.resume={baseCount:b.resumeRows.length,sourceRunId:checkpoint.data.runId,sourceVersion:checkpoint.data.scannerVersion||null,imagePolicy:'omit-images; original checkpoint hash unchanged',sourceSha256:checkpoint.hash,sourceFirstId:b.resumeRows[0].id,sourceLastId:b.resumeRows.at(-1).id,tailVerified:false,frontierVerified:false,minIndex:b.resumeRows.length,checkedWindows:0};
        const sourceEvidence=checkpoint.data.evidence;
        if(currentPosition){
          const prior=sourceEvidence.resume?.inheritedBottom;
          b.resume.currentPosition=true;
          b.resume.inheritedBottom=pc.pendingTailProof(checkpoint.data)?{...prior}:{runId:checkpoint.data.runId,sha256:checkpoint.hash,lastId:b.resume.sourceLastId,bottomStableMs:sourceEvidence.bottomStableMs,maxRange:sourceEvidence.hostProof?.maxRange||Math.max(0,...(sourceEvidence.scrollTrace||[]).map(x=>pc.scrollRange(x.scrollHeight,x.clientHeight))),observedMovement:sourceEvidence.hostProof?.observedMovement===true};
          if(!b.resume.inheritedBottom.observedMovement)throw Error('目前位置續掃需要原保全有效捲動證據，請改用普通底端續掃');
        }
        b.resumeFoldObservations=[...(Array.isArray(sourceEvidence.inheritedFoldObservations)?sourceEvidence.inheritedFoldObservations:[]),...(Array.isArray(sourceEvidence.foldObservations)?sourceEvidence.foldObservations:[])];
        // Keep prior variant snapshots in later checkpoints; original rows remain unchanged.
        b.foldTailVariants=Array.isArray(sourceEvidence.foldTailVariants)?sourceEvidence.foldTailVariants.map(x=>({...x,previous:pc.withoutImages(x.previous),current:pc.withoutImages(x.current)})):[];
        if(b.foldTailVariants.length>1000)throw Error('斷點折疊尾端差異證據過多');
        b.knownMinimum=Math.max(b.knownMinimum,b.resume.baseCount);
      }catch(e){return {ok:false,error:String(e.message||e)}}
    }
    state.bulk=b;
    try{
      if(checkpoint)await historyInheritGeneratedImages(b,checkpoint.data);
      // Disable only this chat's existing automatic upload so scrolling over
      // historical messages cannot upload them after the scan ends.
      const minimumKey='ga-predecessor-min:'+b.chat;
      const {watch={},[minimumKey]:known=0}=await chrome.storage.local.get(['watch',minimumKey]);
      b.knownMinimum=Math.max(b.knownMinimum,pc.minimumCount(known));
      if(watch[b.chat]===true){delete watch[b.chat];await chrome.storage.local.set({watch})}
      state.enabled=false;state.watchedPath=null;candidates.clear();
      historyGuard(b);
      document.getElementById(HISTORY_PANEL)?.remove();
      const pane=document.createElement('section');pane.id=HISTORY_PANEL;pane.dataset.gaExtensionId=chrome.runtime.id;
      pane.style.cssText='position:fixed;z-index:2147483646;left:12px;right:auto;bottom:156px;top:auto;box-sizing:border-box;max-width:calc(100vw - 24px);max-height:min(35vh,calc(100vh - 180px));overflow:auto;background:#202840;color:#fff;border:1px solid #9ba9cb;padding:10px;border-radius:12px;font:13px system-ui;box-shadow:0 3px 20px #0006';
      const h=document.createElement('strong');h.textContent='V'+chrome.runtime.getManifest().version+'｜'+(b.sample?'最近'+b.sample+'則・測試掃描':b.resume?(b.resume.currentPosition?'完整聊天・目前位置續掃':'完整聊天・保全續掃'):'完整聊天・從底端向上掃描');
      b.action=document.createElement('div');b.action.setAttribute('role','status');b.action.style.cssText='padding:8px;margin:5px 0;background:#111827;border-radius:7px;white-space:pre-wrap;overflow-wrap:anywhere';b.action.textContent='目前動作：準備掃描';
      b.info=document.createElement('pre');b.info.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:10px 0';
      b.stop=historyPanelButton(document.createElement('button'),'#a13232');b.stop.textContent='停止並保全';b.stop.setAttribute('aria-label','停止並保全掃描');b.stop.onclick=()=>{b.cancelled=true;b.action.textContent='目前動作：停止並保全中'};
      b.stop.id='ga-predecessor-history-close';
      b.download=historyPanelButton(document.createElement('button'),'#166b65');b.download.id='ga-predecessor-history-redownload';b.download.textContent='重新下載 JSON';b.download.style.cssText+=';width:100%!important';b.download.hidden=true;
      const header=document.createElement('div');header.style.cssText='position:sticky;top:0;z-index:3;background:#202840;padding:4px 0 8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px';
      h.style.cssText='flex:1 1 140px;overflow-wrap:anywhere';
      header.append(h,b.stop);
      const downloads=document.createElement('div');downloads.style.cssText='margin:8px 0';downloads.append(b.download);
      b.summary=document.createElement('div');b.summary.setAttribute('role','status');b.summary.textContent='準備掃描';
      const controls=historyPanelControls(pane,b);
      pane.append(header,b.action,b.summary,controls,downloads,b.info);document.body.append(pane);b.pane=pane;
      pane.gaShowHistoryDetails=b.showPanelDetails;
      const wheel=event=>historyObserveWheel(b,event);
      document.addEventListener('wheel',wheel,{capture:true,passive:true});
      historyRun(b).finally(()=>document.removeEventListener('wheel',wheel,true));return {ok:true,title};
    }catch(e){if(state.bulk===b)state.bulk=null;return {ok:false,error:String(e.message||e)}}
  }


  // In-page entry: browser automation need not access Chrome toolbar popups.
  // Independent local anchor evidence. No raw-scan output, no checkpoint
  // mutation, no automatic expansion, no Firebase, and no continuity claim.

  // Evidence-only prefix supplement: no checkpoint mutation or official import.
  function historyPrefixMerge(previous,live){
    pc.validateRows(previous);pc.validateRows(live);
    if(!live.length)throw Error('目前沒有可讀訊息');
    if(!previous.length)return live.slice();
    const ids=new Map(previous.map((r,i)=>[r.id,i]));
    const hits=live.map((r,i)=>({i,at:ids.get(r.id),r})).filter(x=>x.at!==undefined);
    if(!hits.length||hits[0].i!==0)throw Error('向下視窗沒有連續重疊');
    for(let j=0;j<hits.length;j++){
      const x=hits[j];
      if(x.i!==j||x.at!==hits[0].at+j||!pc.compareRow(previous[x.at],x.r).equal)throw Error('向下視窗重疊正文、格式或順序不符：'+x.r.id);
    }
    if(hits.length===live.length)return previous.slice();
    if(hits.at(-1).at!==previous.length-1)throw Error('新增訊息未接在已驗證尾端');
    const result=[...previous,...live.slice(hits.length)];pc.validateRows(result);return result;
  }
  function historyPrefixJoin(rows,saved){
    pc.validateRows(rows);pc.validateRows(saved);
    const ids=new Map(saved.map((r,i)=>[r.id,i]));
    const start=rows.findIndex(r=>ids.has(r.id));
    if(start<0)return null;
    if(rows[start].id!==saved[0].id)throw Error('補掃跳過原保全第一則，禁止接合');
    const overlap=rows.slice(start);
    if(overlap.length>saved.length)throw Error('補掃超出原保全尾端');
    for(let i=0;i<overlap.length;i++)if(overlap[i].id!==saved[i].id||!pc.compareRow(saved[i],overlap[i]).equal)throw Error('原保全重疊正文、格式或順序不符：'+overlap[i].id);
    if(overlap.length<2)return null;
    const candidate=[...rows.slice(0,start),...saved];pc.validateRows(candidate);
    return {added:start,matched:overlap.length,candidate};
  }
  // A previous prefix is independent evidence, never an official checkpoint.
  function historyPrefixResumeRows(prior,checkpoint,saved,source){
    const d=prior?.data,e=d?.evidence;
    if(!/^[a-f0-9]{64}$/.test(prior?.hash||'')||d?.format!=='gal-predecessor-prefix-supplement-evidence'||d.version!==1||
      !['failed','cancelled'].includes(d.status)||d.canonical!==false||d.importable!==false||d.continuity!==false||
      d.sourceUrl!==source||d.chatId!==pc.sourceId(source)||typeof d.runId!=='string'||!d.runId||d.candidateRows!==null||
      d.base?.runId!==checkpoint.data.runId||d.base?.sha256!==checkpoint.hash||d.base?.count!==saved.length||d.base?.firstId!==saved[0].id||
      e?.observedTopVerified!==true||e.originalCheckpointUnchanged!==true||
      !Array.isArray(d.rows)||d.count!==d.rows.length||d.rows.length<2||d.rows.length>5000||
      !/^user\|turn:[a-zA-Z0-9_-]+$/.test(e.observedFirstId||'')||d.rows[0]?.id!==e.observedFirstId||
      d.rows.some((r,i)=>r.index!==i))throw Error('頂端取證來源、雜湊基準或順序不符');
    // Export ordinals are validated above, but are not live message fields.
    const rows=d.rows.map(({index,...row})=>row);
    pc.validateRows(rows);
    if(historyPrefixJoin(rows,saved))throw Error('此取證已有完整接合，無須續掃');
    return rows;
  }
  function historyPrefixResumeWindow(previous,live){
    pc.validateRows(live);
    const tail=previous.slice(-2),at=live.findIndex(r=>r.id===tail[0].id);
    if(at<0||live[at+1]?.id!==tail[1].id||!tail.every((r,i)=>pc.compareRow(r,live[at+i]).equal))
      throw Error('目前視窗沒有原頂端取證最後兩則連續重疊，請先定位尾端');
    return historyPrefixMerge(previous,live);
  }
  // A verified prefix trace supplies a navigation hint, never an identity proof.
  // Do not traverse the chat or load missing history just to use stale geometry.
  function historyPrefixRestoreHints(prior,previous,host){
    const trace=prior?.data?.evidence?.trace;
    if(!Array.isArray(trace)||!previous.length)return [];
    const t=trace.at(-1),height=host.scrollHeight,viewport=host.clientHeight;
    if(t?.count!==previous.length||![t.top,t.height,height,viewport].every(Number.isFinite)||
       viewport<=0||t.top<0||t.top>t.height||height<=viewport||t.height<=viewport||
       Math.abs(height-t.height)>Math.max(viewport*8,t.height*.02))return [];
    const max=height-viewport;
    return [...new Set([t.top,t.top+height-t.height,t.top*height/t.height].map(x=>Math.round(Math.max(0,Math.min(max,x)))))];
  }
  // Capture synchronously while the conflicting native container is mounted.
  // At most four snapshots; retain both rendering variants if observed again.
  function historyPrefixConflictDom(entries,known,observations){
    for(const entry of entries){
      const row=entry.row,old=known.get(row.id);
      if(!old||row.role!=='assistant'||row.identityBasis!=='native-dom-id')continue;
      const cmp=pc.compareRow(old,row),normalizations=entry.blankCodeNormalizations||[];
      const kind=!cmp.equal?'conflicting':normalizations.length?'blank-code-normalized':'matching';
      if(kind==='matching'&&!observations.some(x=>x.messageId===row.id&&x.kind==='conflicting'))continue;
      if(observations.length>=4||observations.some(x=>x.messageId===row.id&&x.kind===kind))continue;
      let rawDom;
      try{rawDom=historyAnchorDomSnapshot(entry)}catch(e){rawDom={status:'unavailable',reason:String(e.message||e).slice(0,300)}}
      observations.push({messageId:row.id,kind,fields:cmp.fields,row,rawDom,...(normalizations.length?{blankCodeNormalizations:normalizations}:{})});
    }
  }
  async function historyPrefixSupplement(expectedId,files,requestedTitle,checkpoint,report,cancel=()=>false,observedOnly=false,prior=null){
    const names=[...new Set(String(files||'').split(/[,，;；\n]/).map(x=>x.trim()).filter(Boolean))];
    expectedId=String(expectedId||'').trim();
    if(!observedOnly&&!/^user\|turn:[a-zA-Z0-9_-]+$/.test(expectedId))return {ok:false,error:'補掃必須設定已知開頭 user|turn:…'};
    if(observedOnly&&(expectedId||names.length))return {ok:false,error:'候選頂端模式請清空已知開頭 ID 與附件條件'};
    if(names.length>20||names.some(n=>n.length>200))return {ok:false,error:'附件條件過多或過長'};
    if(!valid()||state.bulk||state.scanning||state.activeSends||state.timeBusy||state.enabled||isGenerating()||document.getElementById(HISTORY_PANEL))return {ok:false,error:'請先停止本聊天其他操作，關閉舊保全面板'};
    const chat=path(),source=location.origin+chat,title=pc.chatTitle(requestedTitle||document.title);
    if(!title||!checkpoint||!/^[a-f0-9]{64}$/.test(checkpoint.hash))return {ok:false,error:'請選擇有效原保全及聊天名稱'};
    const saved=pc.validateCheckpoint(checkpoint.data,source,true);
    if(prior&&!observedOnly)throw Error('頂端取證續掃僅允許候選模式');
    const previous=prior?historyPrefixResumeRows(prior,checkpoint,saved,source):null;
    const b={mode:'predecessor-prefix-supplement',chat,rows:[]};
    const lock=document.createElement('section');lock.id=HISTORY_PANEL;lock.hidden=true;lock.dataset.gaExtensionId=chrome.runtime.id;
    state.bulk=b;document.body.append(lock);
    const startedAt=new Date().toISOString(),runId=crypto.randomUUID();
    let rows=[],join=null,openingVerified=false,observedTopVerified=false,observedFirstId=null,error=null,status='failed',windows=0,folds=[],trace=[],openingTrace=[],recoveryTrace=[],conflictDom=[],resumeNavigation=[],lastConflict=null,host=null,anchorRows=null,replay=false,replayMax=-1;
    const guard=()=>{if(cancel()||state.bulk!==b||!valid()||path()!==chat||isGenerating()||!lock.isConnected)throw Error('補掃已停止或聊天狀態變更');};
    const readStable=async(timeout=60000)=>{
      const known=new Map([...saved,...rows].map(r=>[r.id,r]));
      let previous=null,lastAt=0;const until=Date.now()+timeout;
      while(Date.now()<until){
        guard();if(!host.isConnected)throw Error('捲動容器已更換');
        if(!historyLoading(host)&&!historyNativeFailure(host)){
          try{
            let mounted=null;const current=historyRead(host,x=>{if(folds.length<200)folds.push(x)},entries=>{mounted=entries;historyPrefixConflictDom(entries,known,conflictDom)},true),sig=pc.fingerprint(current);
            if(previous===sig&&Date.now()-lastAt>=550){if(mounted?.some(x=>x.generatedImage)){await historyCaptureGeneratedImages(b,mounted);guard()}return current}
            if(previous!==sig){previous=sig;lastAt=Date.now()}
          }catch(e){lastConflict={reason:String(e.message||e),evidence:e.historyEvidence||null};previous=null}
        }else previous=null;
        await sleep(350);
      }
      throw Error('局部正文未能穩定讀取');
    };
    try{
      await historyInheritGeneratedImages(b,checkpoint.data);if(prior)await historyInheritGeneratedImages(b,prior.data);
      guard();host=historyHost();
      if(!host)throw Error('找不到捲動容器');
      if(previous){
        rows=previous;
        observedFirstId=prior.data.evidence.observedFirstId;observedTopVerified=true;openingVerified=false;
        folds=Array.isArray(prior.data.evidence.folds)?prior.data.evidence.folds.slice(0,200):[];
        let current=null,why='';
        const attempt=async(kind,target)=>{
          guard();
          if(!host.isConnected||historyHost()!==host)throw Error('捲動容器已更換');
          if(target!==null){historyScroll(host,target);await sleep(600);guard()}
          try{
            const live=await readStable(12000),next=historyPrefixResumeWindow(previous,live);
            rows=next;current=live;
            resumeNavigation.push({kind,target,verified:true,top:host.scrollTop,height:host.scrollHeight,tailIds:previous.slice(-2).map(r=>r.id)});
          }catch(e){
            guard();why=String(e.message||e);
            resumeNavigation.push({kind,target,verified:false,top:host.scrollTop,height:host.scrollHeight,reason:why});
          }
        };
        await attempt('current-window',null);
        if(!current)for(const target of historyPrefixRestoreHints(prior,previous,host)){
          report('依上次保全座標快速復原，仍需最後兩則完全一致');
          await attempt('saved-geometry-hint',target);
          if(current)break;
        }
        if(!current){
          // Reloaded pages no longer contain the old history. Load it using
          // the native top navigation, under this same cancellation/scan lock.
          b.rows=rows;
          report('舊位置未掛載；自動重新載入已知頂端，不重建原保全');
          const nav=await historyRushTop(observedFirstId,'',report,cancel,{b,lock});
          if(!nav.ok||!nav.verified)throw Error(nav.error||'未確認原取證開頭');
          guard();host=historyHost();if(!host)throw Error('找不到捲動容器');
          resumeNavigation.push({kind:'native-rehydrate-top',verified:true,top:host.scrollTop,height:host.scrollHeight,firstId:observedFirstId});
          for(const target of historyPrefixRestoreHints(prior,previous,host)){
            await attempt('rehydrated-geometry-hint',target);if(current)break;
          }
          if(!current){
            // Return to known top and walk only the already-preserved prefix.
            // It is not new evidence or a new candidate until the tail matches.
            historyScroll(host,0);await sleep(600);guard();
            const initial=await readStable();
            if(host.scrollTop>6||initial[0]?.id!==observedFirstId)throw Error('重載後原取證開頭未核對');
            historyPrefixMerge(previous,initial);
            if(initial.some(r=>!previous.some(old=>old.id===r.id)))throw Error('重載開頭視窗超出原取證，未核對續掃尾端');
            current=initial;replay=true;replayMax=previous.findIndex(r=>r.id===initial.at(-1)?.id);
            resumeNavigation.push({kind:'replay-known-prefix',verified:true,knownIndex:replayMax,top:host.scrollTop,height:host.scrollHeight});
          }
        }
        anchorRows=current;windows++;
      }else{
      if(host.scrollTop>6)throw Error('請先使用直衝到頂，或手動抵達真正開頭');
      let since=null,signature=null;
      const openingDeadline=Date.now()+60000;
      while(Date.now()<openingDeadline){
        guard();if(!host.isConnected||host.scrollTop>6)throw Error('已離開頂端，請重新定位');
        const x=historyTopNavigationSnapshot(host,expectedId,names),sig=JSON.stringify([x.firstId,x.found,host.scrollHeight]);
        const validFirst=/^user\|turn:[a-zA-Z0-9_-]+$/.test(x.firstId);
        const loading=historyLoading(host),nativeFailure=historyNativeFailure(host);
        openingTrace.push({elapsedMs:60000-(openingDeadline-Date.now()),top:host.scrollTop,height:host.scrollHeight,firstId:x.firstId||null,match:!!x.match,validFirst,loading:!!loading,nativeFailure:nativeFailure?(nativeFailure.reason||'retry-available'):null});
        if(!x.match||!validFirst||loading||nativeFailure){since=null;signature=null}
        else if(signature!==sig||since===null){signature=sig;since=Date.now()}
        else if(Date.now()-since>=8000){observedTopVerified=true;observedFirstId=x.firstId;openingVerified=!observedOnly;break}
        report(observedOnly?'觀測頂端及原生首則，等待穩定（非真開頭證明）':'核對已知開頭及附件，等待穩定');await sleep(600);
      }
      if(!observedTopVerified)throw Error(observedOnly?'候選頂端未穩定核對，不開始補掃':'真正開頭條件未核對，不開始補掃');
      const initial=await readStable();
      if(host.scrollTop>6||initial[0]?.id!==observedFirstId||!historyTopNavigationSnapshot(host,observedFirstId,names).match)throw Error('首則原文與已核對頂端不符');
      rows=historyPrefixMerge([],initial);anchorRows=initial;windows++;
      }
      let lastProgress=Date.now(),anchorTop=host.scrollTop,anchorHeight=host.scrollHeight,step=Math.max(24,Math.floor(host.clientHeight*.65)),retries=0;
      const recordRecovery=(event,details={})=>{recoveryTrace.push({event,at:new Date().toISOString(),top:host.scrollTop,height:host.scrollHeight,count:rows.length,...details});if(recoveryTrace.length>200)recoveryTrace.shift()};
      const acceptWindow=(live,next)=>{
        if(replay){
          const tail=previous.slice(-2),at=live.findIndex(r=>r.id===tail[0].id);
          const verified=at>=0&&live[at+1]?.id===tail[1].id&&tail.every((r,i)=>pc.compareRow(r,live[at+i]).equal);
          if(next.length>rows.length&&!verified)throw Error('重載續掃未核對原取證最後兩則，禁止新增');
          const max=Math.max(-1,...live.map(r=>previous.findIndex(p=>p.id===r.id)));
          if(max>replayMax){lastProgress=Date.now();replayMax=max}
          if(verified){replay=false;lastProgress=Date.now();resumeNavigation.push({kind:'replay-tail-verified',verified:true,tailIds:tail.map(r=>r.id),top:host.scrollTop,height:host.scrollHeight})}
        }
        if(next.length>rows.length){lastProgress=Date.now();rows=next}
        anchorTop=host.scrollTop;anchorHeight=host.scrollHeight;anchorRows=live;windows++;
        if(trace.length<500)trace.push({top:anchorTop,height:anchorHeight,count:rows.length});
      };
      // A coordinate is only a hint. Restore and verify the old window before
      // taking another downward step; never merge a distant bottom window.
      const restoreWindow=async()=>{
        const oldTop=anchorTop,oldHeight=anchorHeight,tail=anchorRows.at(-1)?.id;
        if(!tail)throw Error('缺少前一視窗原生錨點');
        let why='無法回到已核對視窗';
        for(let attempt=1;attempt<=3;attempt++){
          guard();if(!host.isConnected)throw Error('捲動容器已更換');
          if(Date.now()-lastProgress>=180000)throw Error('180秒無新增連續訊息');
          const bottom=historyAtBottom(host)&&host.scrollTop-oldTop>host.clientHeight*4;
          if(bottom&&attempt>1){
            const nudge=Math.max(0,host.scrollTop-Math.max(24,Math.floor(host.clientHeight*.5)));
            recordRecovery('bottom-escape-nudge',{attempt,target:nudge,anchorTop:oldTop,anchorId:tail});historyScroll(host,nudge);await sleep(600);guard();
          }
          const height=host.scrollHeight,adjusted=oldTop+height-oldHeight;
          const hint=attempt===1?oldTop:attempt===2?adjusted:Math.min(oldTop,adjusted)-Math.floor(host.clientHeight*.25);
          const target=Math.max(0,Math.min(height-host.clientHeight,hint));
          recordRecovery('restore-attempt',{attempt,target,anchorTop:oldTop,anchorHeight:oldHeight,anchorId:tail});
          report('復原已核對視窗 '+attempt+'/3｜先確認原生錨點，不繼續向下');
          historyScroll(host,target);await sleep(attempt===1?600:1000);guard();
          try{
            const live=await readStable();
            if(!live.some(r=>r.id===tail))throw Error('復原視窗未找到原生錨點');
            const next=historyPrefixMerge(rows,live);
            recordRecovery('restore-verified',{attempt,anchorId:tail,firstId:live[0]?.id,lastId:live.at(-1)?.id});
            acceptWindow(live,next);return;
          }catch(e){why=String(e.message||e);recordRecovery('restore-rejected',{attempt,anchorId:tail,reason:why});guard();}
        }
        throw Error('無法復原已核對向下視窗：'+why);
      };
      while(true){
        guard();join=historyPrefixJoin(rows,saved);
        if(join){status=observedOnly?'joined-observed-prefix':'joined-evidence';break}
        if(Date.now()-lastProgress>=180000)throw Error('180秒無新增連續訊息');
        if(rows.length>5000)throw Error('局部補掃超過5000則安全上限');
        const target=Math.min(Math.max(0,host.scrollHeight-host.clientHeight),anchorTop+step);
        report(replay?'重載已保全前綴｜核對 '+(replayMax+1)+'/'+previous.length+'｜不重複新增':'已保全 '+rows.length+' 個顯示單元｜原保全 '+saved.length+'｜向下尋找連續重疊');
        historyScroll(host,target);await sleep(350);
        let live=null;
        try{
          live=await readStable();const next=historyPrefixMerge(rows,live);
          acceptWindow(live,next);retries=0;step=Math.max(24,Math.floor(host.clientHeight*.65));
          if(historyAtBottom(host)&&!historyPrefixJoin(rows,saved))throw Object.assign(Error('已到觀測底端但未接到保全前沿'),{terminal:true});
        }catch(e){
          lastConflict={reason:String(e.message||e),top:host.scrollTop,height:host.scrollHeight,rows:live||[]};
          if(e.terminal||cancel()||!host.isConnected||++retries>=4)throw e;
          recordRecovery('forward-conflict',{target,anchorTop,anchorHeight,anchorId:anchorRows.at(-1)?.id,reason:lastConflict.reason,liveIds:(live||[]).map(r=>r.id)});
          await restoreWindow();
          step=Math.max(24,Math.floor(step/2));
        }
      }
    }catch(e){error=String(e.message||e);status=cancel()?'cancelled':'failed'}
    finally{if(state.bulk===b)state.bulk=null;lock.remove()}
    const candidateRows=join?join.candidate.map((r,index)=>({...r,index})):null;
    const data={format:'gal-predecessor-prefix-supplement-evidence',version:1,canonical:false,importable:false,continuity:false,fidelity:'rendered-dom',status,runId,title,chatId:pc.sourceId(source),sourceUrl:source,startedAt,finishedAt:new Date().toISOString(),scannerVersion:chrome.runtime.getManifest().version,count:rows.length,rows:rows.map((r,index)=>({...r,index})),error,base:{runId:checkpoint.data.runId,count:saved.length,sha256:checkpoint.hash,firstId:saved[0].id},evidence:{generatedImageAssets:historyGeneratedImageExport(b,candidateRows||rows),generatedImageOverflow:b.generatedImageOverflow||0,expectedId,expectedAttachments:names,openingVerified,observedTopVerified,observedFirstId,openingBasis:observedOnly?'observed-top-only':'specified-opening',windows,trace,openingTrace,recoveryTrace,conflictDom,resumeNavigation,nativeHistoryRetry:b.nativeHistoryRetry||null,folds,lastConflict,matched:join?.matched||0,added:join?.added||0,joinedCandidateCount:candidateRows?.length||0,originalCheckpointUnchanged:true,...(prior?{prefixResume:{runId:prior.data.runId,sha256:prior.hash,count:previous.length,tailIds:previous.slice(-2).map(r=>r.id),openingProof:'inherited-observed-only'}}:{})},candidateRows};
    const filename=historyDownload(data);
    return {ok:!!join,message:join?(observedOnly?'候選頂端重疊核對成功（真開頭未驗證）｜新增 ':'局部重疊核對成功｜新增 ')+join.added+'｜候選 '+candidateRows.length+' 個顯示單元（非正式匯入）｜'+filename:'未接合，已下載獨立取證｜'+filename,error:join?null:error+'｜已下載獨立取證 '+filename};
  }


  // Diagnostic only. Capture immutable strings while the matching native DOM
  // is still mounted, not after a sleep, scroll, or second historyRead.
  function historyAnchorDomSnapshot(entry){
    const {row,el,owner,body}=entry;
    if(row.role!=='assistant'||row.identityBasis!=='native-dom-id'||!body||!el.isConnected||!body.isConnected||!owner.contains(body))return {status:'unavailable',reason:'native assistant body not mounted'};
    const MAX_TOTAL=1000000,MAX_FIELD=120000,MAX_NODES=120;
    let used=0,truncated=false;
    const bounded=(value,limit=MAX_FIELD)=>{
      const text=String(value??''),take=Math.max(0,Math.min(limit,MAX_TOTAL-used,text.length));
      used+=take;if(take<text.length)truncated=true;
      return {text:text.slice(0,take),length:text.length,truncated:take<text.length};
    };
    const attrs=node=>{const all=Array.from(node.attributes||[]);if(all.length>100)truncated=true;return all.slice(0,100).map(a=>({name:a.name,value:bounded(a.value,4000)}))};
    const snap=(node,html=true)=>({tag:node.tagName?.toLowerCase()||null,attributes:attrs(node),innerText:bounded(node.innerText),textContent:bounded(node.textContent),...(html?{outerHTML:bounded(node.outerHTML)}:{})});
    const response=snap(body);
    const selector='blockquote,pre,code,[data-code-block],[data-code-block-source],[data-markdown-copy],button,[role="button"]';
    const nodes=[...body.querySelectorAll(selector)];
    if(nodes.length>MAX_NODES)truncated=true;
    const details=nodes.slice(0,MAX_NODES).map(node=>{
      const ancestors=[];
      for(let n=node.parentElement;n&&n!==body&&body.contains(n)&&ancestors.length<16;n=n.parentElement)ancestors.push({tag:n.tagName?.toLowerCase()||null,attributes:attrs(n)});
      if(ancestors.length===16&&node.parentElement!==body)truncated=true;
      return {node:snap(node),ancestors};
    });
    const result={status:'captured',messageId:row.id,observedAt:new Date().toISOString(),scope:'matched-assistant-body-only',ownerTurnKey:owner.getAttribute('data-turn-key'),response,details,nodeCount:nodes.length,capturedNodeCount:details.length,truncated,characterBudget:MAX_TOTAL};
    return result;
  }
  function historyAnchorReadWindow(host,onFold,expected,uniqueText){
    let observation=null;
    const rows=historyRead(host,onFold,entries=>{
      const hit=pc.anchorTextMatch(expected,entries.map(e=>e.row),uniqueText);
      if(!hit||!hit.identityVerified||hit.row.role!=='assistant')return;
      const matching=entries.filter(e=>e.row.id===hit.row.id);
      if(matching.length!==1)return;
      const entry=matching[0],index=entries.indexOf(entry),neighbors=entries.slice(Math.max(0,index-2),index+3).map(e=>e.row);
      const r=entry.el.getBoundingClientRect();
      let rawDom;
      try{rawDom=historyAnchorDomSnapshot(entry)}catch(e){rawDom={status:'unavailable',reason:String(e.message||e).slice(0,300)}}
      observation={row:entry.row,neighborIds:neighbors.map(r=>r.id),neighborRows:neighbors,images:[],controls:[],rect:{x:r.x,y:r.y,width:r.width,height:r.height},ownerTurnKey:entry.owner.getAttribute('data-turn-key'),rawDom};
    });
    return {rows,observation};
  }

  async function historyAnchorCapture(target,requestedTitle,report,captureOnly=false,cancel=()=>false,options={}){
    if(!pc||!valid()||state.bulk||state.scanning||state.activeSends||state.timeBusy||isGenerating()||document.getElementById(HISTORY_PANEL))return {ok:false,error:'請先結束本聊天其他工作及掃描面板'};
    const chat=path(),source=location.origin+chat,title=pc.chatTitle(requestedTitle||document.title);
    if(!title||!/^(?:user\|(?:turn|message)|assistant\|message):[a-zA-Z0-9_-]+$/.test(target))return {ok:false,error:'請填入完整玩家或 GPT 原生訊息ID及聊天名稱'};
    const assistantTarget=target.startsWith('assistant|');
    const b={mode:'predecessor-anchor',chat,anchorId:target,get cancelled(){return cancel()},
      rows:[],scrollTrace:[],stabilityIssues:[],foldObservations:new Map(),foldObservationOverflow:0,
      attachmentChanges:[],attachmentChangeKeys:new Set(),attachmentChangeOverflow:0,
      scrollStats:{scrollResets:0,loadingPolls:0,loadingNudges:0,fingerprintChanges:0},
      breakthrough:{resets:0,attempts:0,frontier:null}};state.bulk=b;
    const evidence={format:'gal-predecessor-anchor-evidence',version:1,canonical:false,importable:false,continuity:false,status:'not-located',title,chatId:pc.sourceId(source),sourceUrl:source,runId:crypto.randomUUID(),scannerVersion:chrome.runtime.getManifest().version,startedAt:new Date().toISOString(),target,trace:[]};
    let attempted=false;
    const recoveryEvidence=()=>{evidence.recovery={stats:b.scrollStats,trace:b.scrollTrace,traceOverflow:b.recoveryTraceOverflow||0,bottomEscapeTrace:b.bottomEscapeTrace||[],bottomEscapeTraceOverflow:b.bottomEscapeTraceOverflow||0,nativeRetry:b.nativeHistoryRetry||null,lastReadIssue:b.lastReadIssue?{at:b.lastReadIssue.at,reason:b.lastReadIssue.reason,scrollTop:b.lastReadIssue.scrollTop,scrollHeight:b.lastReadIssue.scrollHeight}:null}};
    const guard=()=>{if(cancel()||state.bulk!==b||path()!==chat||!valid()||isGenerating())throw Error('定位已停止或聊天狀態變更')};
    const capture=(host,rows,folds,actualId,atomic=null)=>{
      const index=rows.findIndex(r=>r.id===actualId);if(index<0)return null;
      if(actualId.startsWith('assistant|')){
        if(!atomic||atomic.row.id!==actualId||atomic.row.text!==rows[index].text)throw Error('指定 GPT 首次掛載容器無法唯一核對');
        return {...atomic,folds:folds.filter(x=>x.messageId===actualId)};
      }
      const roots=[...new Set([...historyRoot(host).querySelectorAll('[data-message-author-role="user"]'),...outerUsers()])].filter(el=>historyRoot(host).contains(el)&&historyVisible(el));
      const matching=roots.filter(el=>{
        const owner=historyOwner(el),candidates=[...el.querySelectorAll(USER_BUBBLE_SELECTOR+', .whitespace-pre-wrap')],bodies=candidates.filter(n=>!candidates.some(other=>other!==n&&other.contains(n))),body=bodies.length===1?bodies[0]:el;
        const native=el.closest('[data-message-id]')?.getAttribute('data-message-id')||el.getAttribute('data-message-id')||body.getAttribute('data-dil-message-id')||el.closest('[data-source-message-id]')?.getAttribute('data-source-message-id');
        const turn=owner.getAttribute('data-turn-key');
        return actualId==='user|'+(native?'message:'+native:'turn:'+turn);
      });
      const outer=matching.filter(el=>!matching.some(other=>other!==el&&other.contains(el)));
      if(outer.length!==1)throw Error('指定ID可見但無法確認唯一玩家容器');
      const el=outer[0],owner=historyOwner(el);
      const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const images=[]; // no image capture in predecessor anchor diagnostics
      const controls=expandButtons(owner).filter(historyVisible).map(n=>({label:String(n.innerText||n.textContent||n.getAttribute('aria-label')||'').trim(),rect:rect(n)}));
      return {row:rows[index],neighborIds:rows.slice(Math.max(0,index-2),index+3).map(r=>r.id),neighborRows:rows.slice(Math.max(0,index-2),index+3),folds:folds.filter(x=>x.messageId===actualId),images,controls,rect:rect(el),ownerTurnKey:owner.getAttribute('data-turn-key'),element:el};
    };
    try{
      // An explicitly selected baseline is read-only and never replaces a
      // remembered checkpoint. Invalid or mismatched selection cannot fall back.
      const maxScreens=Number(options.maxScreens??24);
      if(!Number.isInteger(maxScreens)||maxScreens<1||maxScreens>64)throw Error('粗定位視窗數須為1至64');
      let checkpoint;
      if(options.file){
        if(options.file.size>GalCheckpointMemory.MAX)throw Error('定位基準超過100MiB');
        const expectedHash=String(options.expectedHash||'').trim().toLowerCase();
        if(expectedHash&&!/^[a-f0-9]{64}$/.test(expectedHash))throw Error('定位基準 SHA-256 格式錯誤');
        checkpoint=await GalCheckpointMemory.decode(await options.file.arrayBuffer(),source,pc,expectedHash||undefined);
      }else{
        checkpoint=await GalCheckpointMemory.read(chrome.storage.local,source,pc);
      }
      guard();
      if(!checkpoint&&!assistantTarget)throw Error('請先記住本聊天已驗證的原始保全');
      const baselineRows=(checkpoint?.data.rows||[]).map(pc.withoutImages),rank=new Map(baselineRows.map((r,i)=>[r.id,i])),targetIndex=rank.get(target);
      if(targetIndex===undefined&&(!assistantTarget||options.file))throw Error('指定ID不在選用的定位基準內');
      const idOnly=targetIndex===undefined;
      evidence.baseline=checkpoint?{runId:checkpoint.data.runId,sha256:checkpoint.hash,count:checkpoint.data.count,index:targetIndex??null,source:options.file?'selected-file-read-only':'remembered'}:null;
      const {watch={}}=await chrome.storage.local.get('watch');guard();
      if(watch[chat]===true){delete watch[chat];await chrome.storage.local.set({watch})}
      state.enabled=false;state.watchedPath=null;candidates.clear();guard();
      attempted=true;
      const expected=idOnly?{id:target,role:'assistant',text:null}:baselineRows[targetIndex],uniqueText=!assistantTarget&&!!expected.text&&baselineRows.filter(r=>r.role==='user'&&r.text===expected.text).length===1;
      evidence.search={method:idOnly?'native-id-coarse-probe':'baseline-rank-coarse-local',expectedText:expected.text,uniqueText,identityRequired:true,positionBasis:'current-session-only; no saved scan coordinates',maxScreens,coarseProbeMaySkip:true};
      const budget=pc.anchorBudget(captureOnly),began=Date.now(),deadline=began+budget.hardMs;
      let lastProgress=began,previousHost=null,lastWindow=null,stalls=0,previousBottom=false,pending=null,policy={},settleFailures=0;
      const seen=new Set(),visited=new Map();
      evidence.navigation={idleMs:budget.idleMs,hardMs:budget.hardMs,traceLimit:budget.traceLimit,hostWaitPolls:0,loadingPolls:0,readIssuePolls:0,observedWindows:0,traceOverflow:0,stallPolls:0,interWindowBottomReturns:0,uniqueObserved:0,relativeSteps:0,bestIndex:null,bestDistance:null,directionChanges:0,settleFailures:0,liveRecoveryAttempts:0,firstMatchAt:null};
      const elapsed=()=>Math.floor((Date.now()-began)/1000);
      const progress=message=>report(message+'｜'+elapsed()+' 秒｜無新ID '+Math.floor((Date.now()-lastProgress)/1000)+'/'+Math.round(budget.idleMs/1000)+'秒');
      b.anchorProgress=progress;
      const appendTrace=entry=>{if(evidence.trace.length>=budget.traceLimit){evidence.trace.shift();evidence.navigation.traceOverflow++}evidence.trace.push(entry)};
      while(Date.now()<deadline&&Date.now()-lastProgress<budget.idleMs){
        guard();const host=historyHost();if(!host){evidence.navigation.hostWaitPolls++;progress('等待聊天捲動容器');await sleep(budget.pollMs);continue}
        if(previousHost&&previousHost!==host){lastWindow=null;previousBottom=false;pending=null;policy={};visited.clear();settleFailures=0;b.breakthrough={resets:0,attempts:0,frontier:null}}
        previousHost=host;b.host=host;
        let rows,atomic=null,folds=[];
        const readWindow=(readHost=host)=>{folds=[];const read=historyAnchorReadWindow(readHost,x=>folds.push(x),expected,uniqueText);rows=read.rows;atomic=read.observation;return read};
        if(!captureOnly){
          // Check the currently mounted window before any recovery can move it.
          // Only use the proven live navigation to reach more history, never
          // as proof of matching a target. Old checkpoint geometry is unused.
          if(!historyLoading(host)){
            try{readWindow()}catch(e){evidence.lastReadIssue=String(e.message||e).slice(0,300)}
          }
          if(!rows||!pc.anchorTextMatch(expected,rows,uniqueText)){
            try{
              const stable=await historySettled(b,{deadline:Math.min(deadline,lastProgress+budget.idleMs),upward:pending?.direction!==1,target:pending?.top??null,targetHeight:pending?.height??null,allowBoost:true,anchorRead:assistantTarget?readWindow:null});
              guard();if(!atomic)readWindow();
              // A matching live row must not be discarded because a neighbor
              // changed during hydration. Otherwise require stable fingerprint.
              if(!pc.anchorTextMatch(expected,rows,uniqueText)&&pc.fingerprint(stable)!==pc.fingerprint(rows)){evidence.navigation.readIssuePolls++;await sleep(350);continue}
              pending=null;
            }catch(e){
              guard();const reason=String(e.message||e);
              if(e.code!=='HISTORY_RECOVERY_RETRY'&&!reason.startsWith('等待逾時：'))throw e;
              evidence.navigation.settleFailures++;settleFailures++;
              historyTrace(b,'anchor-settle-failed',{reason,attempt:settleFailures});
              pc.alternateRecoveryPolicy(b.breakthrough);pending=null;await sleep(350);continue;
            }
          }
        }else{
          // Capture-only is strictly passive: no scrolling or retry click.
          if(historyLoading(host)){evidence.navigation.loadingPolls++;progress('等待目前畫面載入，不捲動');await sleep(budget.pollMs);continue}
          try{readWindow()}catch(e){evidence.lastReadIssue=String(e.message||e).slice(0,300);evidence.navigation.readIssuePolls++;await sleep(budget.pollMs);continue}
        }
        const indices=rows.map(r=>rank.get(r.id)).filter(Number.isInteger),newIds=rows.filter(r=>!seen.has(r.id));
        for(const r of newIds)seen.add(r.id);
        if(newIds.length){lastProgress=Date.now();historyNativeProgress(b,'anchor-new-live-id')}
        evidence.navigation.uniqueObserved=seen.size;
        for(const i of indices){const d=Math.abs(i-targetIndex);if(evidence.navigation.bestDistance===null||d<evidence.navigation.bestDistance){evidence.navigation.bestDistance=d;evidence.navigation.bestIndex=i}}
        const atBottom=historyAtBottom(host);
        if(lastWindow!==null&&!previousBottom&&atBottom)evidence.navigation.interWindowBottomReturns++;
        previousBottom=atBottom;
        const hit=pc.anchorTextMatch(expected,rows,uniqueText);
        evidence.navigation.observedWindows++;
        const record={at:new Date().toISOString(),elapsedMs:Date.now()-began,knownMin:indices.length?Math.min(...indices):null,knownMax:indices.length?Math.max(...indices):null,firstId:rows[0]?.id,lastId:rows.at(-1)?.id,newIds:newIds.length,atBottom,match:hit?.kind??null};
        appendTrace(record);
        progress('原文搜尋｜已讀 '+seen.size+' 個不同ID｜最接近 '+(evidence.navigation.bestIndex??'未命中'));
        if(hit){
          // Stop moving on the first match. Preserve even a single
          // observation if virtualization removes it before the second read.
          evidence.match={kind:hit.kind,actualId:hit.row.id,identityVerified:hit.identityVerified,textExact:hit.textExact};
          evidence.status='matched-unconfirmed';evidence.matchedRow=hit.row;evidence.navigation.firstMatchAt=Date.now()-began;pending=null;
          let found=null;
          try{found=capture(host,rows,folds,hit.row.id,atomic)}catch(e){evidence.firstCaptureIssue=String(e.message||e).slice(0,300)}
          if(!found){if(assistantTarget)evidence.domCapture={status:'unavailable',observations:0,truncated:false};evidence.finishedAt=new Date().toISOString();recoveryEvidence();historyDownload(evidence);return {ok:true,message:'已命中並停止；原文列已保存，訊息容器細節待核對。'}}
          const {element:ignored,...first}=found;evidence.observations=[first];
          const updateDomCapture=()=>{if(assistantTarget)evidence.domCapture={status:evidence.observations.some(o=>o.rawDom?.status==='captured')?'captured':'unavailable',observations:evidence.observations.filter(o=>o.rawDom?.status==='captured').length,truncated:evidence.observations.some(o=>o.rawDom?.truncated===true)}};
          updateDomCapture();
          progress('已命中原文或指定ID，停止捲動並再次核對（不重新置中）');
          await sleep(650);guard();
          try{
            const currentHost=historyHost(),currentFolds=[];
            if(currentHost&&!historyLoading(currentHost)){
              const current=historyAnchorReadWindow(currentHost,x=>currentFolds.push(x),{id:hit.row.id,role:hit.row.role,text:null},false);
              const second=capture(currentHost,current.rows,currentFolds,hit.row.id,current.observation);
              if(second){const {element:ignored2,...latest}=second;evidence.observations.push(latest)}
            }
          }catch(e){evidence.secondReadIssue=String(e.message||e).slice(0,300)}
          const confirmed=evidence.observations.length===2&&hit.identityVerified;
          evidence.status=confirmed?'located':'matched-unconfirmed';
          updateDomCapture();
          evidence.finishedAt=new Date().toISOString();recoveryEvidence();historyDownload(evidence);
          return {ok:true,message:(confirmed?'已停止捲動並保存指定ID雙次證據（原文差異另記錄）。':'已停止捲動並保存首次命中證據，ID或第二次觀測待核對；不會重新搜尋。')+(assistantTarget?' DOM：'+(evidence.domCapture.status==='captured'?'已保存':'未取得')+(evidence.domCapture.truncated?'（有截斷）':''):'')};
        }
        if(captureOnly)throw Error('目前掛載範圍未命中原文或指定ID；未捲動');
        // Start from the current viewport. A selected source provides rank,
        // not saved pixel coordinates; coarse movement never proves coverage.
        const geo={top:host.scrollTop,height:host.scrollHeight,client:host.clientHeight};
        const visitKey=JSON.stringify([Math.round(geo.height),Math.round(geo.top/Math.max(1,geo.client)),rows[0]?.id,rows.at(-1)?.id]);
        const repeat=newIds.length?0:(visited.get(visitKey)||0);
        if(visited.size>=4096&&!visited.has(visitKey))visited.delete(visited.keys().next().value);
        visited.set(visitKey,repeat+1);
        const hint=pc.anchorDiagnosticHint(targetIndex,indices,geo,policy,maxScreens,repeat);
        if(hint.improved){
          b.breakthrough.resets=0;b.breakthrough.attempts=0;pc.clearRecoveryPolicy(b.breakthrough);settleFailures=0;
          b.breakthrough.frontier={top:hint.best.top,height:hint.best.height,id:baselineRows[hint.best.index].id};
          historyTrace(b,'anchor-rank-progress',{index:hint.best.index,distance:hint.best.distance});
        }
        if(hint.restore){evidence.navigation.liveRecoveryAttempts++;historyTrace(b,'anchor-live-recovery',{bestIndex:hint.best.index,target:hint.top})}
        if(policy.direction&&hint.direction!==policy.direction)evidence.navigation.directionChanges++;
        const signature=JSON.stringify([geo.top,geo.height,rows[0]?.id,rows.at(-1)?.id,hint.top]);
        stalls=signature===lastWindow?stalls+1:0;lastWindow=signature;policy=hint;
        Object.assign(record,{...geo,destination:hint.top,bestIndex:evidence.navigation.bestIndex,restoring:!!hint.restore,mode:hint.mode,repeat});
        if(stalls>=8&&!hint.restore){evidence.navigation.stallPolls++;progress('等待目前視窗穩定');await sleep(2000);continue}
        if(Math.abs(hint.top-geo.top)>2){pending={top:hint.top,height:geo.height,direction:hint.top>geo.top?1:-1};historyScroll(host,hint.top);evidence.navigation.relativeSteps++;await sleep(180)}
        else await sleep(budget.stepMs);
      }
      throw Error(captureOnly?'目前錨點擷取逾時，未證明目標不存在':Date.now()>=deadline?'原文搜尋達60分鐘安全上限，未證明目標不存在':'原文搜尋10分鐘未觀測新ID，未證明目標不存在');
    }catch(e){
      evidence.error=String(e.message||e);evidence.finishedAt=new Date().toISOString();recoveryEvidence();
      if(attempted)historyDownload(evidence);
      return {ok:false,error:evidence.error};
    }finally{if(state.bulk===b)state.bulk=null}
  }
  const HISTORY_LAUNCHER='ga-predecessor-page-launcher--'+chrome.runtime.id,HISTORY_CONFIG='ga-predecessor-page-config--'+chrome.runtime.id;
  const historyPageId=name=>'ga-predecessor-page-'+name+'--'+chrome.runtime.id;
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
    button.textContent='📚 前輩聊天掃描 V'+chrome.runtime.getManifest().version;
    button.setAttribute('aria-label','開啟前輩聊天掃描助手');
    button.title='獨立 ChatGPT 完整聊天 JSON 掃描（此安裝版本）';
    button.style.cssText='position:fixed!important;left:18px!important;right:auto!important;bottom:108px!important;z-index:2147483645!important;padding:10px 14px!important;min-height:42px!important;border:1px solid #c0afff!important;border-radius:12px!important;background:#5145a4!important;color:white!important;font:600 14px system-ui,sans-serif!important;box-shadow:0 3px 16px #0005!important;cursor:pointer!important;touch-action:manipulation!important';
    button.onclick=()=>{
      const active=document.getElementById(HISTORY_PANEL);
      if(active){if(active.dataset?.gaExtensionId===chrome.runtime.id)active.gaShowHistoryDetails?.();else button.title='此頁已有其他版本掃描或保全面板，請勿同頁重複掃描';return}
      if(document.getElementById(HISTORY_CONFIG)){if(state.bulk?.mode==='predecessor-top-navigation')return;document.getElementById(HISTORY_CONFIG).remove();return}
      const pane=document.createElement('section');pane.id=HISTORY_CONFIG;pane.dataset.chat=path();
      pane.setAttribute('role','dialog');pane.setAttribute('aria-label','前輩完整聊天掃描設定');
      pane.style.cssText='position:fixed!important;left:18px!important;right:auto!important;bottom:160px!important;z-index:2147483646!important;width:min(360px,calc(100vw - 36px))!important;max-height:calc(100vh - 180px)!important;overflow:auto!important;box-sizing:border-box!important;background:#202840!important;color:white!important;border:1px solid #9ba9cb!important;padding:14px!important;border-radius:12px!important;font:14px system-ui,sans-serif!important;box-shadow:0 3px 20px #0006!important';
      const heading=document.createElement('strong');heading.textContent='前輩聊天掃描助手';
      const version=document.createElement('p');version.textContent='V'+chrome.runtime.getManifest().version+'｜獨立 JSON，不上傳正史';
      const mode=document.createElement('div');mode.id=historyPageId('mode');mode.setAttribute('role','status');mode.style.cssText='position:sticky;top:0;z-index:2;padding:10px;margin:6px 0 12px;background:#111827;border:1px solid #8edcd3;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere';mode.textContent='目前模式：尚未開始｜請選擇原文搜尋、完整掃描或保全續掃';
      const label=document.createElement('label');label.textContent='聊天名稱（請確認）';label.htmlFor=historyPageId('title');
      const input=document.createElement('input');input.id=historyPageId('title');input.type='text';input.maxLength=512;
      input.value=pc.chatTitle(document.title);
      input.style.cssText='display:block;width:100%;margin:6px 0 12px;padding:8px;background:#111827;color:white;border:1px solid #9ba9cb;border-radius:7px';
      const minLabel=document.createElement('label');minLabel.textContent='已知最低訊息數（完整掃描，未知填0）';minLabel.htmlFor=historyPageId('minimum');
      const minimum=document.createElement('input');minimum.id=historyPageId('minimum');minimum.type='number';minimum.min='0';minimum.step='1';minimum.value='0';minimum.style.cssText=input.style.cssText;
      const checkpointLabel=document.createElement('label');checkpointLabel.textContent='選擇舊完整掃描保全 JSON（首次或替換用，可略過）';
      const checkpointFile=document.createElement('input');checkpointFile.id=historyPageId('checkpoint');checkpointFile.type='file';checkpointFile.accept='.json,application/json';checkpointFile.style.cssText=input.style.cssText;
      const resumeButton=document.createElement('button');resumeButton.id=historyPageId('resume');resumeButton.type='button';resumeButton.textContent='⚡ 完整聊天續掃（使用已記住的保全）';
      const candidateButton=document.createElement('button');candidateButton.id=historyPageId('resume-candidate');candidateButton.type='button';candidateButton.textContent='使用較新候選保全續掃（需核定）';candidateButton.hidden=true;
      const currentPositionLabel=document.createElement('label');currentPositionLabel.style.cssText='display:block;margin:8px 0;color:#bcebe4';
      const currentPosition=document.createElement('input');currentPosition.type='checkbox';currentPosition.id=historyPageId('resume-current-position');
      currentPositionLabel.append(currentPosition,document.createTextNode(' 從目前位置接續（不先跳底；核對前沿，最後驗尾端）'));
      const savedInfo=document.createElement('p');savedInfo.id=historyPageId('saved-checkpoint');savedInfo.textContent='尚未讀取本機保全記憶';
      const hashInput=document.createElement('input');hashInput.id=historyPageId('checkpoint-hash');hashInput.type='text';hashInput.maxLength=64;hashInput.placeholder='免選檔匯入：原檔 SHA-256';hashInput.style.cssText=input.style.cssText;
      const localImport=document.createElement('button');localImport.id=historyPageId('local-import');localImport.type='button';localImport.textContent='從安裝目錄讀取並記住保全';
      const savedSource=()=>location.origin+pane.dataset.chat;
      const manualImport=document.createElement('button');manualImport.id=historyPageId('manual-import');manualImport.type='button';manualImport.textContent='手動離線分段匯入（備用）';
      const showSaved=async()=>{
        try{
          const source=savedSource(),storage=chrome.storage.local;
          const keys=['pinned','candidate'].map(slot=>GalCheckpointMemory.key(source,slot)),records=await storage.get(keys);
          const pinned=records[keys[0]],candidate=records[keys[1]];
          savedInfo.textContent=pinned?'已記住 '+pinned.count+' 則｜'+pinned.runId+'\nSHA-256 '+pinned.hash:'尚無已記住保全，可首次選檔或從安裝目錄匯入';
          candidateButton.hidden=!candidate||(pinned&&candidate.count<=pinned.count);
          if(candidate&&!candidateButton.hidden)savedInfo.textContent+='\n另有候選 '+candidate.count+' 則｜'+candidate.runId;
        }catch(e){savedInfo.textContent='本機保全記憶暫不可用：'+String(e.message||e)}
      };
      const importCheckpoint=async(manual=false)=>{
        if(pane.dataset.chat!==path())return;
        localImport.disabled=true;manualImport.disabled=true;anchorLocate.disabled=true;anchorCapture.disabled=true;resumeButton.disabled=true;candidateButton.disabled=true;start.disabled=true;trial.disabled=true;twenty.disabled=true;close.disabled=true;rushTop.disabled=true;prefixStart.disabled=true;
        try{
          const expectedHash=hashInput.value.trim().toLowerCase();
          if(!/^[a-f0-9]{64}$/.test(expectedHash))throw Error('請輸入原始檔 SHA-256');
          const result=await chrome.runtime.sendMessage({type:manual?'predecessor-open-checkpoint-import':'predecessor-installed-checkpoint-import',expectedHash});
          if(!result?.ok)throw Error(result?.error||'本機保全匯入失敗');
          if(!manual&&(!result.readback||result.hash!==expectedHash))throw Error('本機保全回讀不符');
          feedback.textContent=manual?'已開啟擴充功能獨立匯入頁。完成後返回此頁。':'已記住 '+result.count+' 則｜'+result.runId+'｜SHA-256 已回讀核對；未啟動掃描。';
          await showSaved();
        }catch(e){feedback.textContent='⛔ '+String(e.message||e)}
        finally{localImport.disabled=false;manualImport.disabled=false;anchorLocate.disabled=false;anchorCapture.disabled=false;resumeButton.disabled=false;candidateButton.disabled=false;start.disabled=false;trial.disabled=false;twenty.disabled=false;close.disabled=false;rushTop.disabled=false;prefixStart.disabled=false}
      };
      localImport.onclick=()=>importCheckpoint(false);manualImport.onclick=()=>importCheckpoint(true);
      // Keep the form (including selected file and anchors) alive, but hide it
      // during local operations so the history viewport is not covered.
      const localProgress=(stop,operation)=>{
        const originalStyle=pane.style.cssText,originalHeading=heading.textContent;
        const children=[...pane.children].map(n=>[n,n.hidden]);
        const keep=new Set([heading,mode,stop]);
        for(const [node] of children)node.hidden=!keep.has(node);
        heading.textContent='V'+chrome.runtime.getManifest().version+'｜'+operation;
        pane.style.cssText='position:fixed!important;left:12px!important;right:auto!important;bottom:156px!important;top:auto!important;z-index:2147483646!important;width:min(300px,calc(100vw - 24px))!important;max-height:min(35vh,calc(100vh - 180px))!important;overflow:auto!important;box-sizing:border-box!important;background:#202840!important;color:white!important;border:1px solid #9ba9cb!important;padding:10px!important;border-radius:12px!important;font:13px system-ui,sans-serif!important;box-shadow:0 3px 20px #0006!important';
        // Some form children have display:block!important. Hidden alone cannot
        // override those rules, so use a temporary inline important declaration.
        const styles=children.filter(([node])=>!keep.has(node)).map(([node])=>[node,node.style.cssText]);
        for(const [node] of styles)node.style.cssText+=';display:none!important';
        pane.scrollTop=0;
        return ()=>{
          for(const [node,style] of styles)node.style.cssText=style;
          for(const [node,hidden] of children)node.hidden=hidden;
          heading.textContent=originalHeading;pane.style.cssText=originalStyle;
          pane.scrollTop=0;
        };
      };
      const topLabel=document.createElement('strong');topLabel.textContent='⓪ 直衝到頂・只導航（不掃描）';
      const topId=document.createElement('input');topId.id=historyPageId('top-id');topId.type='text';topId.maxLength=160;topId.placeholder='已知開頭 user|turn:…（選填）';topId.style.cssText=input.style.cssText;
      const topFiles=document.createElement('input');topFiles.id=historyPageId('top-files');topFiles.type='text';topFiles.maxLength=4200;topFiles.placeholder='首則附件檔名，逗號分隔（選填）';topFiles.style.cssText=input.style.cssText;
      const rushTop=document.createElement('button');rushTop.id=historyPageId('rush-top');rushTop.type='button';rushTop.textContent='↑ 直衝到頂（不掃描）';
      const rushStop=document.createElement('button');rushStop.id=historyPageId('rush-stop');rushStop.type='button';rushStop.textContent='停止導航';rushStop.hidden=true;
      let rushCancelled=false;
      rushStop.onclick=()=>{rushCancelled=true;mode.textContent='目前模式：直衝到頂｜正在停止'};
      rushTop.onclick=async()=>{
        if(pane.dataset.chat!==path()||rushTop.disabled)return;
        rushCancelled=false;
        const controls=[start,trial,twenty,resumeButton,candidateButton,localImport,manualImport,anchorLocate,anchorCapture,anchorInput,topId,topFiles,rushTop,prefixStart,close];
        controls.forEach(n=>n.disabled=true);rushStop.hidden=false;
        const restore=localProgress(rushStop,'直衝到頂（不掃描）');
        const status=message=>{mode.textContent='目前模式：直衝到頂（不掃描）\n'+message;feedback.textContent=message};
        try{status('準備導航');const r=await historyRushTop(topId.value,topFiles.value,status,()=>rushCancelled||!pane.isConnected);status(r.ok?r.message:'⛔ '+r.error)}
        catch(e){status('⛔ '+String(e.message||e))}
        finally{restore();controls.forEach(n=>n.disabled=false);rushStop.hidden=true}
      };
      const prefixLabel=document.createElement('strong');prefixLabel.textContent='⓪-2 頂端向下補掃（與原保全接合）';
      const prefixSlot=document.createElement('select');prefixSlot.id=historyPageId('prefix-slot');prefixSlot.style.cssText=input.style.cssText;
      for(const [value,label] of [['file','選擇原保全 JSON（建議）'],['pinned','已記住的原保全'],['candidate','已記住的候選保全']]){const option=document.createElement('option');option.value=value;option.textContent=label;prefixSlot.append(option)}
      prefixSlot.value='file';
      const prefixFile=document.createElement('input');prefixFile.id=historyPageId('prefix-file');prefixFile.type='file';prefixFile.accept='.json,application/json';prefixFile.style.cssText=input.style.cssText;
      const prefixPriorLabel=document.createElement('label');prefixPriorLabel.textContent='續掃已保存的頂端取證（選填；自動核對尾端，必要時重新載入歷史）';
      const prefixPrior=document.createElement('input');prefixPrior.id=historyPageId('prefix-prior');prefixPrior.type='file';prefixPrior.accept='.json,application/json';prefixPrior.style.cssText=input.style.cssText;
      const prefixPriorHash=document.createElement('input');prefixPriorHash.id=historyPageId('prefix-prior-hash');prefixPriorHash.type='text';prefixPriorHash.maxLength=64;prefixPriorHash.placeholder='頂端取證原件 SHA-256（續掃必填）';prefixPriorHash.style.cssText=input.style.cssText;
      let prefixObservedMode=false;
      const prefixObserved=document.createElement('button');prefixObserved.id=historyPageId('prefix-observed');
      historyPanelButton(prefixObserved,'#334155');
      prefixObserved.style.cssText+=';display:block!important;width:100%!important;min-width:44px!important;min-height:44px!important;margin:8px 0!important';
      const renderPrefixMode=()=>{
        prefixObserved.setAttribute('aria-pressed',String(prefixObservedMode));
        prefixObserved.textContent=(prefixObservedMode?'已選擇：':'未選擇：')+'候選頂端補掃（未驗證真開頭，僅取證；清空開頭ID與附件）';
      };
      renderPrefixMode();
      prefixObserved.onclick=()=>{if(prefixObserved.disabled||pane.dataset.chat!==path())return;prefixObservedMode=!prefixObservedMode;renderPrefixMode()};
      const prefixStart=document.createElement('button');prefixStart.id=historyPageId('prefix-start');prefixStart.type='button';prefixStart.textContent='↓ 從頂端向下補掃（無總時限，接合即停）';
      const prefixStop=document.createElement('button');prefixStop.id=historyPageId('prefix-stop');prefixStop.type='button';prefixStop.textContent='停止並下載局部取證';prefixStop.hidden=true;
      let prefixCancelled=false;
      prefixStop.onclick=()=>{prefixCancelled=true;mode.textContent='目前模式：頂端補掃｜正在停止並保全'};
      prefixStart.onclick=async()=>{
        if(pane.dataset.chat!==path()||prefixStart.disabled)return;
        prefixCancelled=false;
        const controls=[start,trial,twenty,resumeButton,candidateButton,localImport,manualImport,anchorLocate,anchorCapture,anchorInput,topId,topFiles,rushTop,prefixStart,prefixFile,prefixSlot,prefixObserved,prefixPrior,prefixPriorHash,close];
        controls.forEach(n=>n.disabled=true);prefixStop.hidden=false;
        const restore=localProgress(prefixStop,'頂端向下補掃');
        const status=message=>{mode.textContent='目前模式：頂端向下補掃\n'+message;feedback.textContent=message};
        try{
          const source=savedSource(),file=prefixFile.files?.[0];
          let checkpoint=null;
          if(prefixSlot.value==='file'){if(!file||file.size>GalCheckpointMemory.MAX)throw Error('請選擇原保全 JSON（100MiB以下）');checkpoint=await GalCheckpointMemory.decode(await file.arrayBuffer(),source,pc)}
          else checkpoint=await GalCheckpointMemory.read(chrome.storage.local,source,pc,prefixSlot.value);
          if(!checkpoint)throw Error('找不到指定保全');
          if(prefixCancelled||pane.dataset.chat!==path()||!pane.isConnected)throw Error('補掃已停止或聊天切換');
          status('核對原保全 '+checkpoint.data.count+' 個顯示單元');
          let prior=null;const priorFile=prefixPrior.files?.[0],expectedPriorHash=String(prefixPriorHash.value||'').trim().toLowerCase();
          if(priorFile||expectedPriorHash){
            if(!prefixObservedMode||topId.value.trim()||topFiles.value.trim())throw Error('頂端取證續掃需選候選模式並清空開頭條件');
            if(!priorFile||priorFile.size>GalCheckpointMemory.MAX||!/^[a-f0-9]{64}$/.test(expectedPriorHash))throw Error('請選擇頂端取證原件並輸入完整SHA-256');
            const raw=await priorFile.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),n=>n.toString(16).padStart(2,'0')).join('');
            if(hash!==expectedPriorHash)throw Error('頂端取證SHA-256不一致');
            prior={hash,data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
          }
          if(prefixCancelled||pane.dataset.chat!==path()||!pane.isConnected)throw Error('補掃已停止或聊天切換');
          const r=await historyPrefixSupplement(topId.value,topFiles.value,input.value.trim(),checkpoint,status,()=>prefixCancelled||!pane.isConnected,prefixObservedMode,prior);
          status(r.ok?r.message:'⛔ '+r.error);
        }catch(e){status('⛔ '+String(e.message||e))}
        finally{restore();controls.forEach(n=>n.disabled=false);prefixStop.hidden=true}
      };
      const anchorLabel=document.createElement('strong');anchorLabel.textContent='① 局部取證・原文搜尋（只找指定訊息）';
      const anchorInput=document.createElement('input');anchorInput.id=historyPageId('anchor-id');anchorInput.type='text';anchorInput.maxLength=160;anchorInput.placeholder='原文搜尋：玩家或 GPT 原生訊息 ID';anchorInput.style.cssText=input.style.cssText;
      const anchorFileLabel=document.createElement('label');anchorFileLabel.textContent='定位基準 JSON（唯讀，不替換保全；建議選同聊天原始斷點）';
      const anchorFile=document.createElement('input');anchorFile.id=historyPageId('anchor-file');anchorFile.type='file';anchorFile.accept='.json,application/json';anchorFile.style.cssText=input.style.cssText;
      const anchorHash=document.createElement('input');anchorHash.id=historyPageId('anchor-hash');anchorHash.type='text';anchorHash.maxLength=64;anchorHash.placeholder='定位基準 SHA-256（選填）';anchorHash.style.cssText=input.style.cssText;
      const anchorStepLabel=document.createElement('label');anchorStepLabel.textContent='遠距粗定位最大視窗數（1–64，接近目標自動縮步）';
      const anchorStep=document.createElement('input');anchorStep.id=historyPageId('anchor-step');anchorStep.type='number';anchorStep.min='1';anchorStep.max='64';anchorStep.step='1';anchorStep.value='24';anchorStep.style.cssText=input.style.cssText;
      const anchorLocate=document.createElement('button');anchorLocate.id=historyPageId('anchor-locate');anchorLocate.type='button';anchorLocate.textContent='依原文搜尋（10分鐘無進展停止）';
      const anchorCapture=document.createElement('button');anchorCapture.id=historyPageId('anchor-capture');anchorCapture.type='button';anchorCapture.textContent='擷取目前錨點（不捲動）';
      const anchorStop=document.createElement('button');anchorStop.id=historyPageId('anchor-stop');anchorStop.type='button';anchorStop.textContent='停止定位';anchorStop.hidden=true;
      const anchorStyle='display:block!important;width:100%!important;box-sizing:border-box!important;padding:10px!important;margin:6px 0!important;background:#166b65!important;color:white!important;border:1px solid #8edcd3!important;border-radius:8px!important;cursor:pointer!important;text-align:center!important';
      prefixStart.style.cssText=anchorStyle;prefixStop.style.cssText='padding:8px;color:white;background:#9f3131;border-radius:7px;margin:6px 0';
      rushTop.style.cssText=anchorStyle;rushStop.style.cssText='padding:8px;color:white;background:#9f3131;border-radius:7px;margin:6px 0';
      anchorLocate.style.cssText=anchorStyle;anchorCapture.style.cssText=anchorStyle;anchorStop.style.cssText='padding:8px;color:white;background:#9f3131;border-radius:7px;margin:6px 0';
      let anchorCancelled=false;
      anchorStop.onclick=()=>{anchorCancelled=true;mode.textContent='目前模式：原文局部取證｜正在停止並保全';feedback.textContent='正在停止定位…'};
      const anchorRun=async(captureOnly)=>{
        if(pane.dataset.chat!==path())return;
        anchorCancelled=false;
        const activeMode=captureOnly?'目前錨點擷取（不捲動）':'原文搜尋（只找指定訊息）';
        const target=anchorInput.value.trim();
        const status=message=>{mode.textContent='目前模式：'+activeMode+'\n目標：'+target+'\n目前動作：'+message;feedback.textContent=message};
        status('準備讀取原文');
        const controls=[start,trial,twenty,resumeButton,candidateButton,localImport,manualImport,anchorLocate,anchorCapture,anchorInput,anchorFile,anchorHash,anchorStep,rushTop,prefixStart,close];
        controls.forEach(n=>n.disabled=true);anchorStop.hidden=false;
        try{const r=await historyAnchorCapture(target,input.value.trim(),status,captureOnly,()=>anchorCancelled||!pane.isConnected,{file:anchorFile.files?.[0],expectedHash:anchorHash.value,maxScreens:Number(anchorStep.value)});status(r.ok?r.message:'⛔ '+r.error)}
        catch(e){status('⛔ '+String(e.message||e))}
        finally{controls.forEach(n=>n.disabled=false);anchorStop.hidden=true}
      };
      anchorLocate.onclick=()=>anchorRun(false);anchorCapture.onclick=()=>anchorRun(true);
      const fullLabel=document.createElement('strong');fullLabel.textContent='② 完整聊天保全（不是原文搜尋）';
      const note=document.createElement('p');note.textContent='建議先測試最近10則（玩家及GPT各算一則），再完整掃描至頂端。載入最多等待60秒；本聊天的原監看將停止。';
      const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.style.whiteSpace='pre-wrap';
      const start=document.createElement('button');start.type='button';start.id=historyPageId('start');start.textContent='↑ 從最底端向上完整掃描';
      start.style.cssText='display:block;width:100%;padding:10px;background:#6456b8;color:white;border:1px solid #c0afff;border-radius:8px;cursor:pointer';
      const trial=document.createElement('button');trial.type='button';trial.id=historyPageId('test-ten');trial.textContent='🧪 測試掃描 10 則';
      trial.style.cssText='display:block;width:100%;padding:10px;margin-bottom:8px;background:#166b65;color:white;border:1px solid #8edcd3;border-radius:8px;cursor:pointer';
      const twenty=document.createElement('button');twenty.type='button';twenty.id=historyPageId('test-twenty');twenty.textContent='🧪 測試掃描 20 則';twenty.style.cssText=trial.style.cssText;
      const close=document.createElement('button');close.type='button';close.textContent='關閉';close.style.cssText='margin-top:8px;padding:7px 12px;background:#374151;color:white;border-radius:7px;cursor:pointer';
      close.onclick=()=>pane.remove();
      const launch=async(sample,resume=false)=>{
        if(pane.dataset.chat!==path()){pane.remove();return}
        if(!pc.chatTitle(input.value)){feedback.textContent='請填寫聊天實際名稱，不能使用新對話等預設名稱';return}
        start.disabled=true;trial.disabled=true;twenty.disabled=true;resumeButton.disabled=true;candidateButton.disabled=true;localImport.disabled=true;manualImport.disabled=true;anchorLocate.disabled=true;anchorCapture.disabled=true;close.disabled=true;rushTop.disabled=true;prefixStart.disabled=true;feedback.textContent='正在開啟掃描…';mode.textContent='目前模式：'+(resume?'完整聊天・保全續掃':sample?'測試掃描':'完整聊天・從底端向上掃描')+'｜準備中';
        try{
          let checkpoint=null;
          if(resume){
            const source=savedSource(),storage=chrome.storage.local,file=checkpointFile.files?.[0];
            if(file&&resume!=='candidate'){
              if(file.size>GalCheckpointMemory.MAX)throw Error('斷點超過100MiB，請保留原檔並回報');
              const bytes=await file.arrayBuffer();
              checkpoint=await GalCheckpointMemory.decode(bytes,source,pc);
              await GalCheckpointMemory.save(storage,bytes,source,pc,checkpoint.hash);
            }else{
              checkpoint=await GalCheckpointMemory.read(storage,source,pc,resume==='candidate'?'candidate':'pinned');
              if(!checkpoint)throw Error('尚無已記住的保全，請先選檔或從安裝目錄匯入');
            }
            if(pane.dataset.chat!==path())throw Error('聊天已切換，停止續掃');
          }
          const result=await (sample?historyBegin(input.value.trim(),sample):historyBegin(input.value.trim(),false,pc.minimumCount(minimum.value),checkpoint,!!resume&&currentPosition.checked));
          if(result?.ok){pane.remove();return}
          feedback.textContent='⛔ '+(result?.error||'無法啟動掃描');
        }catch(e){feedback.textContent='⛔ '+String(e.message||e)}
        finally{start.disabled=false;trial.disabled=false;twenty.disabled=false;resumeButton.disabled=false;candidateButton.disabled=false;localImport.disabled=false;manualImport.disabled=false;anchorLocate.disabled=false;anchorCapture.disabled=false;close.disabled=false;rushTop.disabled=false;prefixStart.disabled=false}
      };
      resumeButton.style.cssText=start.style.cssText;resumeButton.onclick=()=>launch(false,true);
      candidateButton.style.cssText=start.style.cssText;candidateButton.onclick=()=>launch(false,'candidate');
      start.onclick=()=>launch(false);trial.onclick=()=>launch(true);twenty.onclick=()=>launch(20);
      pane.append(heading,version,mode,label,input,savedInfo,topLabel,topId,topFiles,rushTop,rushStop,prefixLabel,prefixSlot,prefixFile,prefixObserved,prefixPriorLabel,prefixPrior,prefixPriorHash,prefixStart,prefixStop,anchorLabel,anchorInput,anchorFileLabel,anchorFile,anchorHash,anchorStepLabel,anchorStep,anchorLocate,anchorCapture,anchorStop,fullLabel,minLabel,minimum,checkpointLabel,checkpointFile,hashInput,localImport,manualImport,currentPositionLabel,resumeButton,candidateButton,note,trial,twenty,start,close,feedback);document.body.append(pane);showSaved();
    };
    document.body.append(button);
  }

  // The toolbar reuses the same chat-scoped memory and historyBegin entry point.
  // It must not clear a running scan, close a pending export, or fall back to a fresh scan.
  async function historyPopupCommand(message){
    const chat=path();
    if(!pc||!valid()||message.chat!==chat)throw Error('聊天已切換或不是具體 ChatGPT 聊天');
    const busy=()=>!!(state.bulk||state.scanning||state.activeSends||state.timeBusy||isGenerating()||document.getElementById(HISTORY_PANEL));
    if(message.type==='predecessor-popup-status'){
      const source=location.origin+chat,keys=['pinned','candidate'].map(slot=>GalCheckpointMemory.key(source,slot));
      const records=await chrome.storage.local.get(keys);
      if(path()!==chat)throw Error('聊天已切換');
      const meta=record=>record?{count:record.count,runId:record.runId,hash:record.hash}:null;
      return {ok:true,pinned:meta(records[keys[0]]),candidate:meta(records[keys[1]]),busy:busy()||!!document.getElementById(HISTORY_CONFIG)};
    }
    if(busy())throw Error('本聊天正在操作或尚有保全面板，請勿中斷');
    if(message.type==='predecessor-popup-config'){
      if(!document.getElementById(HISTORY_CONFIG)){
        historyLauncher();
        const button=document.getElementById(HISTORY_LAUNCHER);
        if(!button)throw Error('找不到頁面掃描助手');
        button.click();
      }
      if(!document.getElementById(HISTORY_CONFIG))throw Error('無法開啟完整掃描設定');
      return {ok:true};
    }
    if(message.type!=='predecessor-popup-resume')throw Error('未知掃描入口');
    if(document.getElementById(HISTORY_CONFIG))throw Error('請在已開啟的完整設定操作續掃');
    const checkpoint=await GalCheckpointMemory.read(chrome.storage.local,location.origin+chat,pc,'pinned');
    if(!checkpoint)throw Error('尚無已記住的保全，請先從完整掃描設定匯入');
    if(path()!==chat||!valid())throw Error('聊天已切換，停止續掃');
    if(busy())throw Error('本聊天正在操作或尚有保全面板，請勿中斷');
    if(document.getElementById(HISTORY_CONFIG))throw Error('請在已開啟的完整設定操作續掃');
    return historyBegin(message.title,false,0,checkpoint);
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if(['predecessor-popup-status','predecessor-popup-config','predecessor-popup-resume'].includes(message?.type)){historyPopupCommand(message).then(respond,e=>respond({ok:false,error:String(e.message||e)}));return true}
    if(message?.type==='predecessor-history-up'){historyBegin(message.title,message.sample).then(respond,e=>respond({ok:false,error:String(e.message||e)}));return true}
    if(['predecessor-history','predecessor-anchor','predecessor-top-navigation','predecessor-prefix-supplement'].includes(state.bulk?.mode)&&['bulk-down','bulk-range','backfill-visible','begin-watch','end-watch','test-last-time'].includes(message?.type)){respond({ok:false,error:'前輩聊天掃描中，不得開始其他操作'});return;}

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