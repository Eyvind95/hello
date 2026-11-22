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
 let pending=null,pairs=0,previousMs=null;
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
  if(pending===null){errors.push('第 '+(i+1)+' 則 Gal AI 沒有相鄰的「我」');continue}
  // Both player and Gal AI use the game's own clock, never ChatGPT/capture/received clocks.
  pending.gameTime=clock.iso;
  canon.push({role:'ai',text:t,scanIndex:i,gameTime:clock.iso});
  if(previousMs!==null&&Date.parse(clock.iso)<previousMs)
    warnings.push('第 '+(i+1)+' 則遊戲時間早於前一回合（可能是劇情倒流，需核對原文）');
  previousMs=Date.parse(clock.iso);
  pending=null;pairs++;
 }
 if(pending!==null)errors.push('掃描尾端只有「我」，沒有對應 Gal AI 回覆');
 if(pairs===0)errors.push('沒有任何完整「我／他」回合');
 const sourceNames=[...new Set(events.map(x=>x.worldName).filter(Boolean))];
 if(expectedWorld&&sourceNames.length&&sourceNames.some(x=>normalizedWorld(x)!==normalizedWorld(expectedWorld)))
   errors.push('事件世界觀與綁定世界觀不一致');
 return {ok:errors.length===0,errors,warnings,opening,messages:canon,events,pairs,
  worldNames:sourceNames,scannedRows:rows.length};
}
function copyRangeWithLiveStyles(range){
 const root=range.commonAncestorContainer;
 const base=root.nodeType===Node.ELEMENT_NODE?root:root.parentElement;
 const props=[
  ['bg','backgroundColor'],['italic','fontStyle'],['display','display'],
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
 if(originals.length!==copies.length||originals.some((el,i)=>el.tagName!==copies[i].tagName)){
  return {fragment,mapped:false,reason:'range-structure-diff',originals:originals.length,copies:copies.length};
 }
 for(let i=0;i<copies.length;i++){
  for(const [name,value] of snapshots[i])copies[i].setAttribute('data-gal-source-'+name,value);
 }
 return {fragment,mapped:true,sourceElements:originals.length};
}
function markdownFromDom(node,options={}){
 if(!node)return '';
 const T=Node.TEXT_NODE,E=Node.ELEMENT_NODE,player=options.role==='me';
 const skip=/^(BUTTON|SVG|PATH|SCRIPT|STYLE|NOSCRIPT|INPUT|TEXTAREA|SELECT)$/i;
 const source=(n,key,fallback='')=>n?.getAttribute?.('data-gal-source-'+key)||fallback;
 const style=(n,key,prop)=>source(n,key)||(n?.nodeType===E?getComputedStyle(n)[prop]:'');
 const color=n=>style(n,'bg','backgroundColor');
 const italicStyle=n=>style(n,'italic','fontStyle');
 const display=n=>style(n,'display','display');
 const borderWidth=n=>style(n,'border-width','borderLeftWidth');
 const borderStyle=n=>style(n,'border-style','borderLeftStyle');
 const borderColor=n=>style(n,'border-color','borderLeftColor');
 function quoteColor(src){
  const s=String(src||'').trim().toLowerCase().replace(/\s+/g,'');
  if(/^#250c57(?:ff)?$/.test(s)||/^rgba?\(37,12,87(?:,1)?\)$/.test(s))return 'me';
  if(/^#2a2a34(?:ff)?$/.test(s)||/^rgba?\(42,42,52(?:,1)?\)$/.test(s))return 'ai';
  return null;
 }
 const bubble='span.message-bubble-text';
 const body='[data-message-content],[data-testid*="message-content"],.markdown,.prose,.message-content,.bubble-content';
 function quoteCard(n,inQuote){
  if(inQuote||n===node||source(n,'complete')==='no'||quoteColor(color(n))!==(player?'me':'ai'))return false;
  if(quoteColor(source(n,'parent-bg')||color(n.parentElement))===(player?'me':'ai'))return false;
  if(player)return true;
  // A gray message surface can use the same color as an embedded quote.
  // Require an observed bubble-text element within a body with sibling content.
  return n.matches(bubble)&&!n.matches(body)&&!n.querySelector(bubble)&&
   [...n.parentElement.childNodes].some(peer=>peer!==n&&clean(peer.textContent)&&
    (peer.nodeType===T||(peer.nodeType===E&&!skip.test(peer.tagName)&&!peer.matches('[role="button"],[role="toolbar"]'))));
 }
 const quoteText=value=>{
  const t=clean(value);
  if(!t||t.startsWith('「')&&t.endsWith('」'))return t;
  return '「'+t+'」';
 };
 const walk=(n,inQuote=false,inItalic=false)=>{
  if(n.nodeType===T)return n.nodeValue||'';
  if(n.nodeType!==E||skip.test(n.tagName))return '';
  if(n!==node&&n.matches?.('[role="toolbar"],[aria-label*="操作"],[data-role="toolbar"],[contenteditable="true"]'))return '';
  const tag=n.tagName.toLowerCase();
  if(tag==='br')return '\n';
  const quoted=quoteCard(n,inQuote);
  const italicNow=(tag==='em'||tag==='i'||italicStyle(n)==='italic')
    &&!inItalic&&(n===node||italicStyle(n.parentElement)!=='italic');
  const nextItalic=inItalic||italicNow||italicStyle(n)==='italic';
  let inner='';
  for(const child of n.childNodes){
   const part=walk(child,inQuote||quoted,nextItalic);
   const block=child.nodeType===E&&/^(?:block|flow-root|flex|grid|list-item|table)$/.test(display(child));
   if(block&&part.trim()&&inner&&!inner.endsWith('\n')&&!part.startsWith('\n'))inner+='\n';
   inner+=part;
   if(block&&part.trim()&&!inner.endsWith('\n'))inner+='\n';
  }
  if(quoted)return quoteText(inner);
  if(tag==='blockquote'){
   const t=clean(inner);
   return '\n'+t.split('\n').map(line=>'> '+line).join('\n')+'\n';
  }
  let out=inner;
  if(italicNow&&out.trim())out=out.replace(/\S[\s\S]*\S|\S/,t=>'*'+t+'*');
  if((tag==='strong'||tag==='b')&&out.trim())out='**'+out.trim()+'**';
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
globalThis.GalArchiveCore={clean,normalizedWorld,parseGameTime,worldInText,isEvent,meaningful,validate,copyRangeWithLiveStyles,markdownFromDom,version:'0.7.9'};
})();
