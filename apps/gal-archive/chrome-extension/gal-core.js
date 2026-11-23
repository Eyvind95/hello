/* Gal AI native scanner: shared pure parser. No ChatGPT DOM rules here. */
(() => {
'use strict';
if(globalThis.GalArchiveCore)return;
const txt=x=>String(x==null?'':x);
const clean=x=>txt(x).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
const normalizedWorld=x=>clean(x).replace(/[《》〈〉「」『』\s　，,。．·・！!]/g,'').toLowerCase();
function parseGameTime(input){
  const head=clean(input).split('\n').slice(0,18).join('\n').slice(0,1600);
  // A Gal AI event may place the entire status header on ONE rendered line.
  // Keep the search in the header and prefer the clock closest after its date.
  const date=head.match(/(?:^|\n|[｜|│]\s*)(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u)
    ||head.match(/(?:^|\n|[｜|│]\s*)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?=\D|$)/u);
  const afterDate=date?head.slice((date.index||0)+date[0].length,(date.index||0)+date[0].length+260):'';
  const time=afterDate.match(/(?:[｜|│]\s*|\n\s*|^\s*)(?:[^\d\n]{0,48}?)?(\d{1,2})\s*[：:]\s*(\d{2})(?:[.:：](\d{1,2}))?(?=\D|$)/u);
  if(!date||!time)return null;
  const y=+date[1],mo=+date[2],d=+date[3],h=+time[1],mi=+time[2],sec=+(time[3]||0);
  if(y<100||mo<1||mo>12||d<1||d>31||h>23||mi>59||sec>59)return null;
  const ms=Date.UTC(y,mo-1,d,h-8,mi,sec),check=new Date(ms+8*3600000);
  if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==mo||check.getUTCDate()!==d
   ||check.getUTCHours()!==h||check.getUTCMinutes()!==mi)return null;
  return {iso:new Date(ms).toISOString(),civil:[y,String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('/')
    +' '+String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0')+(time[3]?':'+String(sec).padStart(2,'0'):''),
    year:y,month:mo,day:d,hour:h,minute:mi,second:sec};
}
function worldInText(content){
 const t=clean(content);
 const m=t.match(/與\s*《([^》]{2,120})》\s*的\s*(?:世界|事件)/u);
 return m?clean(m[1]):null;
}
function isEvent(content){
 const t=clean(content);
 // An event must be presented as a notification, not merely mentioned in prose.
 return /^(?:[⚠❗❕!！\uFE0F\s　]*)?(?:事件(?:到達|通知|發生|觸發)|與\s*《[^》]{2,120}》\s*的\s*事件)/u.test(t)
   || /^[!！⚠\uFE0F\s　]+與\s*《[^》]{2,120}》\s*的\s*世界/u.test(t)
   || /^.{0,45}(?:世界事件|緊急事件)\s*(?:到達|通知|觸發)/u.test(t);
}
function meaningful(str){return clean(str).replace(/\s+/g,' ')}
function validate(rows,expectedWorld){
 const errors=[],warnings=[],canon=[],events=[];
 if(!Array.isArray(rows)||!rows.length)return {ok:false,errors:['沒有掃到任何可辨識訊息'],warnings,opening:'',messages:[],events:[],pairs:0};
 const opener=rows[0];
 if(opener.role!=='ai'||parseGameTime(opener.text)||isEvent(opener.text))
   errors.push('首則不是「左側、無劇情時間、非事件」的輪迴開場；請回到真正的開場重新掃描');
 const opening=opener.role==='ai'?clean(opener.text):'';
 if(opening.length<8)errors.push('輪迴開場過短，可能選到工具列或不完整訊息');
 let pending=null,pairs=0,previousMs=null,autoContinues=0;
 for(let i=1;i<rows.length;i++){
  const row=rows[i],role=row.role,t=clean(row.text);
  if(!t){errors.push('第 '+(i+1)+' 則是空訊息');continue}
  const domain=worldInText(t);
  if(domain&&expectedWorld&&normalizedWorld(domain)!==normalizedWorld(expectedWorld))
    errors.push('第 '+(i+1)+' 則事件／世界名稱「'+domain+'」與綁定世界觀「'+expectedWorld+'」不符；不能覆蓋其他世界觀');
  if(role==='ai'&&(row.eventType==='event'||isEvent(t))){
   const eventTime=parseGameTime(t);
   if(!eventTime)warnings.push('第 '+(i+1)+' 則 Gal AI 事件沒有可確認的劇情時間，保留原文但不推測時間');
   events.push({role:'ai',text:t,title:(t.split('\n').find(Boolean)||'事件').slice(0,70),
    status:'accepted',scanIndex:i,worldName:row.worldName||domain||null,
    gameTime:eventTime?.iso||null});
   continue;
  }
  if(role==='me'){
   if(pending!==null)errors.push('第 '+(i+1)+' 則玩家訊息前一回合沒有 Gal AI 回覆');
   pending={role:'me',text:t,scanIndex:i};
   canon.push(pending);
   continue;
  }
  if(role!=='ai'){errors.push('第 '+(i+1)+' 則左右身份不明');continue}
  const clock=parseGameTime(t);
  if(!clock){errors.push('第 '+(i+1)+' 則 Gal AI 回覆缺少可辨識的劇情日期和時間');continue}
  const continued=pending===null&&row.autoContinue===true&&canon.at(-1)?.role==='ai'&&canon.at(-1).scanIndex===i-1;
  if(pending===null&&!continued){errors.push('第 '+(i+1)+' 則 Gal AI 沒有相鄰的「我」');continue}
  // Both player and Gal AI use the game's own clock, never ChatGPT/capture/received clocks.
  if(pending)pending.gameTime=clock.iso;
  canon.push({role:'ai',text:t,scanIndex:i,gameTime:clock.iso,...(continued?{autoContinue:true}:{})});
  if(previousMs!==null&&Date.parse(clock.iso)<previousMs)
    warnings.push('第 '+(i+1)+' 則遊戲時間早於前一回合（可能是劇情倒流，需核對原文）');
  previousMs=Date.parse(clock.iso);
  if(continued)autoContinues++;else pairs++;
  pending=null;
 }
 if(pending!==null)errors.push('掃描尾端只有「我」，沒有對應 Gal AI 回覆');
 if(pairs===0)errors.push('沒有任何完整「我／他」回合');
 const sourceNames=[...new Set(events.map(x=>x.worldName).filter(Boolean))];
 if(expectedWorld&&sourceNames.length&&sourceNames.some(x=>normalizedWorld(x)!==normalizedWorld(expectedWorld)))
   errors.push('事件世界觀與綁定世界觀不一致');
 return {ok:errors.length===0,errors,warnings,opening,messages:canon,events,pairs,autoContinues,
  worldNames:sourceNames,scannedRows:rows.length};
}
function copyRangeWithLiveStyles(range,trace){
 const root=range.commonAncestorContainer;
 const base=root.nodeType===Node.ELEMENT_NODE?root:root.parentElement;
 const props=[
  ['bg','backgroundColor'],['italic','fontStyle'],['font-weight','fontWeight'],['display','display'],['white-space','whiteSpace'],
  ['border-width','borderLeftWidth'],['border-style','borderLeftStyle'],['border-color','borderLeftColor']
 ];
 const originals=[...(base?.querySelectorAll('*')||[])].filter(el=>range.intersectsNode(el));
 const snapshots=originals.map(el=>{
  const computed=getComputedStyle(el);
  return [...props.map(([name,prop])=>[name,computed[prop]]),
   ['parent-bg',getComputedStyle(el.parentElement).backgroundColor],
   ['complete',range.isPointInRange(el,0)&&range.isPointInRange(el,el.childNodes.length)?'yes':'no']];
 });
 const fragment=range.cloneContents();
 const copies=[...fragment.querySelectorAll('*')];
 if(trace){
  trace.liveGray=originals.flatMap((el,i)=>{
   const bg=snapshots[i][0][1];
   return grayBackground(bg)?[{tag:el.localName,classes:el.getAttribute('class'),parent:el.parentElement.getAttribute('class')}]:[];
  }).slice(0,20);
  const blankLines=text=>(text.replace(/\r\n?/g,'\n').match(/\n[ \t]*\n/g)||[]).length;
  trace.range={originals:originals.length,copies:copies.length,mapped:false,
   liveTextBlankLines:blankLines(range.toString()),clonedTextBlankLines:blankLines(fragment.textContent)};
 }
 if(originals.length!==copies.length||originals.some((el,i)=>el.tagName!==copies[i].tagName)){
  return {fragment,mapped:false,reason:'range-structure-diff',originals:originals.length,copies:copies.length};
 }
 for(let i=0;i<copies.length;i++){
  for(const [name,value] of snapshots[i])copies[i].setAttribute('data-gal-source-'+name,value);
 }
 if(trace)trace.range.mapped=true;
 return {fragment,mapped:true,sourceElements:originals.length};
}
function grayBackground(value){
 return /^(?:#2a2a34(?:ff)?|rgba?\(42,42,52(?:,1)?\))$/i.test(String(value||'').replace(/\s+/g,''));
}
function markdownFromDom(node,options={}){
 if(!node)return '';
 const T=Node.TEXT_NODE,E=Node.ELEMENT_NODE,player=options.role==='me';
 const skip=/^(BUTTON|SVG|PATH|SCRIPT|STYLE|NOSCRIPT|INPUT|TEXTAREA|SELECT)$/i;
 const source=(n,key,fallback='')=>n?.getAttribute?.('data-gal-source-'+key)||fallback;
 const style=(n,key,prop)=>source(n,key)||(n?.nodeType===E?getComputedStyle(n)[prop]:'');
 const color=n=>style(n,'bg','backgroundColor');
 const italicStyle=n=>style(n,'italic','fontStyle');
 const fontWeight=n=>style(n,'font-weight','fontWeight');
 const isBoldWeight=value=>{
  const raw=String(value||'').trim().toLowerCase();
  if(raw==='bold'||raw==='bolder')return true;
  const numeric=parseInt(raw,10);
  return Number.isFinite(numeric)&&numeric>=600;
 };
 const display=n=>style(n,'display','display');
 const whiteSpace=n=>style(n,'white-space','whiteSpace');
 const borderWidth=n=>style(n,'border-width','borderLeftWidth');
 const borderStyle=n=>style(n,'border-style','borderLeftStyle');
 const borderColor=n=>style(n,'border-color','borderLeftColor');
 function quoteColor(src){
  const s=String(src||'').trim().toLowerCase().replace(/\s+/g,'');
  if(/^#250c57(?:ff)?$/.test(s)||/^rgba?\(37,12,87(?:,1)?\)$/.test(s))return 'me';
  if(grayBackground(s))return 'ai';
  return null;
 }
 const bubble='span.message-bubble-text';
 const body='[data-message-content],[data-testid*="message-content"],.markdown,.prose,.message-content,.bubble-content';
 function quoteCard(n,inQuote,nativeQuote=false){
  if(inQuote||n===node||source(n,'complete')==='no'||quoteColor(color(n))!==(player?'me':'ai'))return false;
  if(quoteColor(source(n,'parent-bg')||color(n.parentElement))===(player?'me':'ai'))return false;
  if(player)return true;
  // A gray message surface can use the same color as an embedded quote.
  // Require an observed bubble-text element within a body with sibling content.
  return n.matches(bubble)&&!n.matches(body)&&!n.querySelector(bubble)&&
   (nativeQuote||[...n.parentElement.childNodes].some(peer=>peer!==n&&clean(peer.textContent)&&
    (peer.nodeType===T||(peer.nodeType===E&&!skip.test(peer.tagName)&&!peer.matches('[role="button"],[role="toolbar"]')))));
 }
 const quoteText=value=>{
  const t=clean(value);
  if(!t||t.startsWith('「')&&t.endsWith('」'))return t;
  return '「'+t+'」';
 };
 const blockDisplay=/^(?:block|flow-root|flex|grid|list-item|table)$/;
 const paragraph='p,[role="paragraph"]';
 const templated='span.message-bubble-text.TemplatedText';
 const status=templated+'.font-mono.text-xs';
 const narration=templated+'.text-text-neutral-subtle';
 const grayCard=templated+'.bg-bg-neutral-subtle.rounded-lg.p-3.rounded-es-none';
 function templateLeaf(n){
  // Gal AI puts a single text fragment inside layout wrappers. Keep the
  // wrapper intact if unwrapping would discard any sibling content.
  while(n?.matches('div,span')&&!n.matches(templated)&&n.children.length===1&&
   [...n.childNodes].every(child=>child===n.firstElementChild||
    child.nodeType===Node.COMMENT_NODE||child.nodeType===T&&!clean(child.nodeValue))){
   n=n.firstElementChild;
  }
  return n?.matches(templated)?n:null;
 }
 const trace=options.trace;
 if(trace)trace.serialized={graySeen:0,grayQuoted:0,nativeTemplates:0};
 const walk=(n,inQuote=false,inItalic=false,fragmentLeaf=null)=>{
  if(n.nodeType===T)return n.nodeValue||'';
  if(n.nodeType!==E||skip.test(n.tagName))return '';
  if(n!==node&&n.matches?.('[role="toolbar"],[aria-label*="操作"],[data-role="toolbar"],[contenteditable="true"]'))return '';
  const tag=n.tagName.toLowerCase();
  if(tag==='br')return '\n';
  const quoted=quoteCard(n,inQuote,n===fragmentLeaf&&n.matches(grayCard));
  if(trace&&grayBackground(color(n))){
   trace.serialized.graySeen++;
   if(quoted)trace.serialized.grayQuoted++;
  }
  const italicNow=(tag==='em'||tag==='i'||italicStyle(n)==='italic')
    &&!inItalic&&(n===node||italicStyle(n.parentElement)!=='italic');
  const nextItalic=inItalic||italicNow||italicStyle(n)==='italic';
  const boldNow=(tag==='strong'||tag==='b'||isBoldWeight(fontWeight(n)))&&
    (n===node||!isBoldWeight(fontWeight(n.parentElement)));
  if(options.metadata&&n.matches(status)&&/^(?:pre|pre-wrap)$/.test(whiteSpace(n))){
   (options.metadata.codeBlocks??=[]).push(n.textContent);
   if(parseGameTime(n.textContent))options.metadata.statusText||=n.textContent;
  }
  // The native template lays out the status and each text fragment as a
  // separate visual box. Paragraph breaks in its prose come from the text.
  const header=n.firstElementChild;
  const nativeLayout=!player&&n.matches('div.w-full.space-y-2');
  const statusLeaf=nativeLayout?(options.event
   ?[...n.children].map(templateLeaf).find(leaf=>leaf?.matches(status))
   :templateLeaf(header)):null;
  const nativeTemplate=statusLeaf?.matches(status)&&
   /^(?:rgb\(28,\s*28,\s*39\)|#1c1c27)$/i.test(color(statusLeaf))&&whiteSpace(statusLeaf)==='pre-wrap';
  const nativeReply=nativeTemplate&&!options.event;
  if(options.metadata&&nativeTemplate&&parseGameTime(statusLeaf.textContent))
   options.metadata.statusText||=statusLeaf.textContent;
  if(trace&&nativeLayout&&header&&!trace.templateHeader)
   trace.templateHeader={tag:header.localName,classes:header.getAttribute('class'),background:color(header),whiteSpace:whiteSpace(header)};
  if(trace&&nativeReply)trace.serialized.nativeTemplates++;
  const leaves=nativeTemplate?new Map([...n.children].map(child=>[child,templateLeaf(child)])):null;
  const proseLeaf=leaf=>leaf?.matches(narration)&&whiteSpace(leaf)==='pre-wrap'&&color(leaf)==='rgba(0, 0, 0, 0)';
  const cardLeaf=leaf=>leaf?.matches(grayCard)&&whiteSpace(leaf)==='pre-wrap'&&quoteCard(leaf,inQuote||quoted,true);
  const eventNarration=child=>{
   const leaf=leaves?.get(child);
   return proseLeaf(leaf)&&!/^[｜|│][\s\S]*[｜|│]$/.test(clean(leaf.textContent));
  };
  // Event status rows always keep their block boundaries. In the native
  // layout, a gray card between two narration fragments is an inline quote.
  const eventInlineCard=child=>Boolean(options.event&&cardLeaf(leaves?.get(child))&&
   eventNarration(child.previousElementSibling)&&eventNarration(child.nextElementSibling));
  let inner='';
  let previousParagraph=false;
  for(const child of n.childNodes){
   const leaf=leaves?.get(child);
   const nativeCard=cardLeaf(leaf);
   const nativeProse=nativeReply&&proseLeaf(leaf);
   const joinBefore=child.nodeType===E&&options.event&&leaves&&
    (eventInlineCard(child)||eventNarration(child)&&eventInlineCard(child.previousElementSibling));
   const joinAfter=child.nodeType===E&&options.event&&leaves&&
    (eventInlineCard(child)||eventNarration(child)&&eventInlineCard(child.nextElementSibling));
   const eventFragment=options.event&&(nativeCard||joinBefore||joinAfter);
   const childFragment=fragmentLeaf&&n!==fragmentLeaf&&child===n.firstElementChild
    ?fragmentLeaf:(nativeCard||nativeProse||eventFragment?leaf:null);
   const part=walk(child,inQuote||quoted,nextItalic,childFragment);
   const block=child.nodeType===E&&(!childFragment||eventFragment)&&blockDisplay.test(display(child));
   // A recognized AI quote inside an explicit paragraph can be visually
   // block-level while still belonging to the paragraph's source text.
   const inlineQuote=block&&!player&&n.matches(paragraph)&&quoteCard(child,inQuote||quoted);
   const startsParagraph=block&&child.matches(paragraph)&&!!part.trim();
   if(previousParagraph&&startsParagraph&&!/\n[ \t]*\n[ \t]*$/.test(inner)&&!/^\s*\n/.test(part))inner+='\n';
   if(block&&!inlineQuote&&!joinBefore&&part.trim()&&inner&&!inner.endsWith('\n')&&!part.startsWith('\n'))inner+='\n';
   inner+=part;
   if(block&&!inlineQuote&&!joinAfter&&part.trim()&&!inner.endsWith('\n'))inner+='\n';
   if(part.trim()||child.tagName==='BR')previousParagraph=startsParagraph;
  }
  if(quoted)return quoteText(inner);
  if(tag==='blockquote'){
   const t=clean(inner);
   return '\n'+t.split('\n').map(line=>'> '+line).join('\n')+'\n';
  }
  let out=inner;
  if(italicNow&&out.trim())out=out.replace(/\S[\s\S]*\S|\S/,t=>'*'+t+'*');
  if(boldNow&&out.trim())out='**'+out.trim()+'**';
  // WHIF event/dialogue quotes are rendered with <q>; the browser-generated
  // quotation marks are not part of textContent, so serialize them explicitly.
  // Preserve the inner text exactly and only add the visible Chinese quote pair.
  if(tag==='q')out='「'+out+'」';
  if(tag==='code'&&n.parentElement?.tagName!=='PRE')return String.fromCharCode(96)+out+String.fromCharCode(96);
  if(tag==='pre')return '\n'+String.fromCharCode(96).repeat(3)+'\n'+out+'\n'+String.fromCharCode(96).repeat(3)+'\n';
  if(tag==='li')return '\n- '+out;
  if(/^h[1-6]$/.test(tag))return '\n'+'#'.repeat(+tag[1])+' '+out+'\n';
  if((tag==='div'||tag==='section')&&n!==node){
   if(parseFloat(borderWidth(n))>=3&&borderStyle(n)==='solid'&&borderColor(n)!=='transparent'){
    const t=clean(out);if(t)return '\n'+t.split('\n').map(line=>'> '+line).join('\n')+'\n';
   }
  }
  return out;
 };
 return clean(walk(node)).replace(/\n{4,}/g,'\n\n');
}
function compareNativeParagraphs(scanned,nativeCopy,options={}){
 const statusFence=/^[ \t]*\x60{3}[ \t]*(?:[a-z][\w+-]*)?[ \t]*\n([\s\S]+?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/i;
 const imageMarker=/(?:[ \t]*\n)?\{\{(?:img|image):+[^{}\n]+\}\}[ \t]*$/i;
 const preamble=/^\{\{([^{}\n]{1,200})\}\}[ \t]*\n(?:[ \t]*\n)*/u;
 let text=clean(nativeCopy);
 const original=text;
 const unspaced=value=>value.replace(/\s/g,'');
 const count=value=>[...unspaced(value)].length;
 const markers=[];
 const record=(kind,tokens,before,after)=>markers.push({kind,tokens,nonWhitespaceChars:count(before)-count(after)});
 const visibleTitle=options.event?clean(options.eventTitle):'';
 const titleKey=unspaced(visibleTitle);
 let statusText=options.statusText||'';
 if(options.event&&visibleTitle){
  const lines=scanned.split('\n');
  if(clean(lines[0])===visibleTitle){
   const rows=[];
   for(const line of lines.slice(1)){
    if(!/^[｜|│][\s\S]*[｜|│]$/.test(clean(line)))break;
    rows.push(line);
   }
   const joined=rows.join('\n');
   if(parseGameTime(joined))statusText=joined;
  }
 }
 const statusKey=unspaced(statusText);
 const leading=text.match(preamble);
 let preambleMetadata='not-present';
 let eventQuoteProjection=null;
 // Untimed WHIF events can still carry one or two hidden leading templates.
 // Strip them only when the remaining native text becomes an exact full-text
 // match (ignoring whitespace), so a real content difference can never be
 // accepted just because the event has no game clock.
 if(options.source==='whif-event-content'&&options.event&&!statusKey&&leading&&!preamble.test(scanned)){
  let candidate=text,removed=0;
  while(removed<2){
   const template=candidate.match(preamble);
   if(!template)break;
   const label=template[1].trim();
   if(/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(label))break;
   candidate=candidate.slice(template[0].length);
   removed++;
   const candidateKey=unspaced(candidate),scannedKey=unspaced(scanned);
   if(candidateKey===scannedKey){
    record('leading-whif-event-hidden-template',removed,text,candidate);
    text=candidate;
    break;
   }
   // Restore only omitted native Chinese quote pairs. Quotes still visible
   // in the DOM, including a pre-existing unmatched closer, must survive.
   // Reject any other text difference instead of guessing the original.
   const scannedChars=[...scannedKey];
   let matched=0,omitted='',projected='',valid=true;
   for(const char of candidate){
    if(/\s/u.test(char)){projected+=char;continue}
    if(matched<scannedChars.length&&char===scannedChars[matched]){
     projected+=char;matched++;continue;
    }
    if(char==='「'||char==='」'){omitted+=char;continue}
    valid=false;break;
   }
   let balance=0;
   for(const quote of omitted){
    balance+=quote==='「'?1:-1;
    if(balance<0){valid=false;break}
   }
   if(valid&&matched===scannedChars.length&&omitted.length>0&&balance===0){
    record('leading-whif-event-hidden-template',removed,text,candidate);
    record('native-event-dialogue-quotes',omitted.length,candidate,projected);
    text=candidate;
    eventQuoteProjection={pairs:[...omitted].filter(char=>char==='「').length,
     comparableText:projected,preservedVisibleQuotes:(scanned.match(/[「」]/g)||[]).length};
    break;
   }
  }
 }
 if(options.source==='whif-message-content'&&leading&&!preamble.test(scanned)){
  const label=leading[1].trim();
  const after=text.slice(leading[0].length);
  const header=after.match(statusFence)?.[1]??after;
  preambleMetadata=options.chapterTitle
   ?(clean(options.chapterTitle)===label?'title-matched':'title-differs'):'title-unavailable';
  // The site hides a standalone leading template before the rendered
  // status. Keep placeholders, attachments, and the message body intact.
  if(label&&!/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(label)&&
   preambleMetadata!=='title-differs'&&statusKey&&unspaced(header).startsWith(statusKey)){
   record('leading-whif-template',1,text,after);
   text=after;
  }
 }
 // Event wrappers are distinct from ordinary reply preambles. A leading
 // template is eligible only if followed by the already visible event title.
 if(options.source==='whif-event-content'&&titleKey&&statusKey&&unspaced(scanned).startsWith(titleKey+statusKey)){
  // A WHIF context wrapper and its companion can share the event title
  // line. Work only before the independently verified status fence.
  const openingFence=/^[ \t]*\x60{3}[^\n]*\n/m.exec(text);
  if(openingFence){
   const fencedStatus=text.slice(openingFence.index).match(statusFence);
   const prefix=text.slice(0,openingFence.index);
   const pattern=/\{\{([^{}]+)\}\}/g;
   const templates=[...prefix.matchAll(pattern)];
   if(fencedStatus&&unspaced(fencedStatus[1])===statusKey&&templates.length===2&&
    !prefix.slice(0,templates[0].index).trim()&&/^\s*below context is\b/i.test(templates[0][1])&&
    !/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(templates[1][1].trim())){
    const visibleLines=prefix.replace(pattern,'').split('\n').filter(line=>line.trim());
    const visiblePrefix=visibleLines[0]?.trimStart()||'';
    const rest=text.slice(openingFence.index+fencedStatus[0].length);
    if(visibleLines.length===1&&unspaced(visiblePrefix)===titleKey&&
     unspaced(visiblePrefix+fencedStatus[1]+rest)===unspaced(scanned)){
     const withoutContext=text.slice(templates[0][0].length);
     const candidate=visiblePrefix+'\n'+text.slice(openingFence.index);
     record('leading-whif-event-context',1,text,withoutContext);
     record('whif-event-title-companion-template',1,withoutContext,candidate);
     text=candidate;
    }
   }
  }
  const eventTemplate=/^\{\{([^{}]+)\}\}[ \t]*\n(?:[ \t]*\n)*/u;
  let candidate=text,templates=0;
  while(templates<2){
   const template=candidate.match(eventTemplate);
   if(!template||/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(template[1].trim()))break;
   candidate=candidate.slice(template[0].length);
   templates++;
  }
  const candidateHead=candidate.match(statusFence)?.[1]??candidate.split('\n')[0];
  if(templates&&unspaced(candidateHead)===titleKey){
   record('leading-whif-event-template',templates,text,candidate);
   text=candidate;
  }
 }
 const fencedTitle=options.event&&titleKey?text.match(statusFence):null;
 if(fencedTitle&&unspaced(fencedTitle[1])===titleKey&&statusKey&&
  unspaced(scanned).startsWith(titleKey+statusKey)&&
  unspaced(text.slice(fencedTitle[0].length)).startsWith(statusKey)){
  const after=fencedTitle[1]+text.slice(fencedTitle[0].length);
  record('event-title-code-fence',2,text,after);
  text=after;
 }
 const eventFenceStart=options.event&&!statusFence.test(text)
  ?text.indexOf('\n'+String.fromCharCode(96).repeat(3))+1:0;
 const unfenced=text.slice(eventFenceStart).match(statusFence);
 if(unfenced&&!statusFence.test(scanned.slice(eventFenceStart))&&parseGameTime(unfenced[1])&&
  (!options.event||statusKey===unspaced(unfenced[1]))){
  const rest=text.slice(eventFenceStart+unfenced[0].length);
  // The closing fence makes the status a distinct block even if the
  // source uses a single newline before the next paragraph.
  const after=text.slice(0,eventFenceStart)+unfenced[1]+rest.replace(/^\n(?![ \t]*\n)(?=[\s\S]*\S)/,'\n\n');
  record('status-code-fence',2,text,after);
  statusText=unfenced[1];
  text=after;
 }
 if(imageMarker.test(text)&&!imageMarker.test(scanned)){
  const after=text.replace(imageMarker,'').trimEnd();
  record('terminal-image-marker',1,text,after);
  text=after;
 }
 // Project only balanced fences for code blocks actually rendered without
 // literal fences, at the aligned location, and only if the entire reply matches.
 const scannedKey=unspaced(scanned);
 const codeKeys=new Set((options.codeBlocks||[]).map(unspaced).filter(Boolean));
 if(!options.event&&codeKeys.size&&scannedKey!==unspaced(text)){
  const bodyFence=/^[ \t]*\x60{3}[ \t]*(?:[a-z][\w+-]*)?[ \t]*\n([\s\S]+?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/gim;
  let removed=0,blocks=0;
  const projected=text.replace(bodyFence,(match,body,offset)=>{
   const key=unspaced(body);
   if(!codeKeys.has(key)||!scannedKey.startsWith(key,unspaced(text.slice(0,offset)).length-removed))
    return match;
   removed+=unspaced(match).length-key.length;
   blocks++;
   return body;
  });
  if(blocks&&scannedKey===unspaced(projected)){
   record('rendered-body-code-fence',blocks*2,text,projected);
   text=projected;
  }
 }
 // WHIF hides non-placeholder templates even inside narration. Walk the
 // known syntax in order and require a complete visible-text match before
 // committing any projection. Fenced code remains an indivisible block.
 if(options.source==='whif-message-content'&&statusKey&&scannedKey!==unspaced(text)){
  const syntax=/^[ \t]*\x60{3}([^\n\x60]*)\n([\s\S]*?)^[ \t]*\x60{3}[ \t]*(?=\n|$)|\{\{([^{}\n]+)\}\}/gim;
  const changes=[];
  let cursor=0,aligned=0,projected='',valid=true;
  for(const match of text.matchAll(syntax)){
   const between=text.slice(cursor,match.index),key=unspaced(between);
   if(!scannedKey.startsWith(key,aligned)){valid=false;break}
   projected+=between;aligned+=key.length;
   const written=unspaced(match[0]);
   const fenceHeader=match[1]?.trim();
   const fenceBody=match[2]?.replace(/\n$/,'');
   const template=match[3]?.trim();
   let replacement=match[0],kind=null;
   if(!scannedKey.startsWith(written,aligned)){
    // WHIF can place visible code text directly on the opening fence line.
    // When that line could be a language label, the rendered block decides.
    const codeCandidates=fenceHeader?[fenceBody?[fenceHeader,fenceBody].join('\n'):fenceHeader]:[fenceBody];
    if(fenceBody&&/^[a-z][\w+-]*$/i.test(fenceHeader))codeCandidates.push(fenceBody);
    const code=codeCandidates.find(candidate=>candidate&&codeKeys.has(unspaced(candidate))&&
     scannedKey.startsWith(unspaced(candidate),aligned));
    if(code!==undefined){
     replacement=code;
     kind=unspaced(code)===statusKey?'aligned-status-code-fence':'aligned-body-code-fence';
    }else if(template&&!/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(template)){
     replacement='';
     kind='aligned-hidden-whif-template';
    }else{valid=false;break}
   }
   if(kind)changes.push({kind,tokens:template?1:2,nonWhitespaceChars:count(match[0])-count(replacement)});
   projected+=replacement;aligned+=unspaced(replacement).length;cursor=match.index+match[0].length;
  }
  if(valid&&changes.length){
   projected+=text.slice(cursor);
   if(scannedKey===unspaced(projected)){
    markers.push(...changes);
    text=projected;
   }
  }
 }
 const comparableText=eventQuoteProjection?eventQuoteProjection.comparableText:text;
 const scanChars=[...unspaced(scanned)],nativeChars=[...unspaced(comparableText)];
 const whitespaceOnlyEqual=unspaced(scanned)===unspaced(original);
 const contentEqual=scanChars.join('')===nativeChars.join('');
 const clock=parseGameTime(scanned)?.iso;
 const nativeClock=parseGameTime(text)?.iso;
 const clockEqual=options.event
  ?(clock===nativeClock&&(Boolean(clock)||(!clock&&!nativeClock)))
  :Boolean(clock&&clock===nativeClock);
 const statusCompact=unspaced(statusText);
 const positions=[...text.matchAll(/(\S)(\s*)/gu)];
 const statusPrefix=options.event&&titleKey&&unspaced(text).startsWith(titleKey+statusCompact)
  ?titleKey+statusCompact:statusCompact;
 const bodyStart=statusCompact&&unspaced(text).startsWith(statusPrefix)?count(statusPrefix):0;
 const bodyOffset=bodyStart?positions[bodyStart]?.index:undefined;
 const comparison={scannedLength:[...scanned].length,nativeLength:[...nativeCopy].length,
  scannedNonWhitespace:scanChars.length,nativeNonWhitespace:count(original),
  comparableNativeNonWhitespace:nativeChars.length,whitespaceOnlyEqual,contentEqual,clockEqual,
  preambleMetadata,formatMarkers:markers,formatMarkerCount:markers.reduce((sum,m)=>sum+m.tokens,0),
  explainedNonWhitespace:markers.reduce((sum,m)=>sum+m.nonWhitespaceChars,0),
  remainingUnexplained:{scanned:0,native:0},
  nativeBodyParagraphs:bodyOffset===undefined?null:text.slice(bodyOffset).split(/\n(?:[ \t]*\n)+/).length,
  nativeStatusBlankLines:bodyStart?(positions[bodyStart-1][2].match(/\n[ \t]*\n/g)||[]).length:null,
  ignoredDifferences:[...markers.map(marker=>marker.kind),...(scanned!==text&&contentEqual?['whitespace']:[])]};
 if(options.event){
  const findStatus=value=>statusKey?unspaced(value).indexOf(statusKey):-1;
  const nativeStatus=findStatus(original),scannedStatus=findStatus(scanned);
  const nativeStatusOffset=nativeStatus<0?undefined:
   [...original.matchAll(/\S/gu)][[...unspaced(original).slice(0,nativeStatus)].length]?.index;
  const fenceOffset=original.indexOf(String.fromCharCode(96).repeat(3));
  const prefix=original.slice(0,nativeStatusOffset??(fenceOffset<0?0:fenceOffset));
  const eventTitle=unspaced(options.eventTitle||'');
  comparison.eventStructure={
   renderedCodeBlocks:codeKeys.size,visibleStatusMatched:nativeStatus>=0&&scannedStatus>=0,
   scannedPrefixLength:scannedStatus<0?null:[...unspaced(scanned).slice(0,scannedStatus)].length,
   nativePrefixLength:nativeStatus<0?null:[...unspaced(original).slice(0,nativeStatus)].length,
   nativeLeadingTemplate:original.startsWith('{{'),
   nativePrefixTemplates:[...prefix.matchAll(/\{\{([^{}]*)\}\}/g)].map(match=>({
    kind:/^\s*below context is\b/i.test(match[1])?'whif-leading-context':
     eventTitle&&unspaced(match[1])===eventTitle?'visible-title':'unclassified-template',
    characters:count(match[0]),lines:match[0].split('\n').length
   })),
   visibleTitleInNativePrefix:Boolean(eventTitle&&unspaced(prefix).includes(eventTitle))
  };
 }
 if(!contentEqual){
  const features=value=>({
   markdownHeadings:(value.match(/^\s*#{1,6}[ \t]/gm)||[]).length,
   markdownEmphasis:(value.match(/\*{1,3}[^*\n]+\*{1,3}/g)||[]).length,
   codeFences:(value.match(/^\s*(?:\x60{3,}|~{3,})/gm)||[]).length,
   inlineCode:(value.match(/(?<!\x60)\x60[^\x60\n]+\x60(?!\x60)/g)||[]).length,
   templateMarkers:(value.match(/\{\{[^{}]*\}\}/g)||[]).length,
   imageMarkers:(value.match(/\{\{(?:img|image):+[^{}]*\}\}/gi)||[]).length,
   quoteOpeners:(value.match(/[「『“«]/g)||[]).length,
   newlineCount:(value.match(/\n/g)||[]).length,
   labels:{terminal:/戰術終端/u.test(value),trending:/熱搜/u.test(value),
    groupMessage:/群組|群聊|群訊/u.test(value),taskNotification:/任務通知/u.test(value)}
  });
  comparison.features={scanned:features(scanned),native:features(original)};
  let index=0;
  while(index<scanChars.length&&index<nativeChars.length&&scanChars[index]===nativeChars[index])index++;
  let suffix=0;
  while(suffix<scanChars.length-index&&suffix<nativeChars.length-index&&
   scanChars[scanChars.length-1-suffix]===nativeChars[nativeChars.length-1-suffix])suffix++;
  comparison.remainingUnexplained={scanned:scanChars.length-index-suffix,native:nativeChars.length-index-suffix};
  const a=scanChars[index],b=nativeChars[index],pair=(a||'')+(b||'');
  const kind=scanChars.join('').normalize('NFC')===nativeChars.join('').normalize('NFC')?'unicode-normalization':
   /[「」『』“”‘’"'«»]/u.test(pair)?'quote-symbol':
   pair.includes(String.fromCharCode(96))?'code-fence-or-inline-code':
   /[*_~#{}\[\]\\]/u.test(pair)?'format-marker':
   /[\p{Cf}\p{M}\uFFFD]/u.test(pair)?'special-unicode':'text';
  const codePoint=c=>c?'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'):null;
  comparison.firstDifference={nonWhitespaceIndex:index+1,kind,scannedCodePoint:codePoint(a),nativeCodePoint:codePoint(b)};
  const context=chars=>chars.slice(Math.max(0,index-6),index+7).join('');
  return {text:null,comparison,localContext:{scanned:context(scanChars),native:context(nativeChars)}};
 }
 if(!text||!clockEqual)return {text:null,comparison};
 if(eventQuoteProjection){
  comparison.eventQuoteProjection={pairs:eventQuoteProjection.pairs,restoredFromNative:true,
   preservedVisibleQuotes:eventQuoteProjection.preservedVisibleQuotes};
  return {text,comparison};
 }
 // Content and time match. Only move line boundaries at corresponding
 // character positions; keep all scanned characters and other whitespace.
 let index=0;
 const restored=scanned.replace(/(\S)(\s*)/gu,(_match,char,space)=>{
  const nativeGap=positions[index++][2];
  return char+(/\n/.test(nativeGap)||/\n/.test(space)?nativeGap:space);
 });
 if(parseGameTime(restored)?.iso!==clock){
  comparison.clockEqual=false;
  return {text:null,comparison};
 }
 return {text:restored,comparison};
}
function restoreNativeParagraphs(scanned,nativeCopy){return compareNativeParagraphs(scanned,nativeCopy).text}
globalThis.GalArchiveCore={clean,normalizedWorld,parseGameTime,worldInText,isEvent,meaningful,validate,copyRangeWithLiveStyles,markdownFromDom,compareNativeParagraphs,restoreNativeParagraphs,version:'0.8.22'};
})();