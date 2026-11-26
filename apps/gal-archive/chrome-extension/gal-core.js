/* Gal AI native scanner: shared pure parser. No ChatGPT DOM rules here. */
(() => {
'use strict';
if(globalThis.GalArchiveCore)return;
const txt=x=>String(x==null?'':x);
const clean=x=>txt(x).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
const normalizedWorld=x=>clean(x).normalize('NFKC').replace(/[《》〈〉「」『』\s，,。．·・！!－—–-]|🔞/gu,'').toLowerCase();

// Adventure-world profile: a single clock/location line and three named HUD sections.
// Do not parse an arbitrary date in narrative prose, or cap a large inventory line.
const ADVENTURE_WORLD='身為冒險者就可以這樣那樣';
const ADVENTURE_OPENING_ISO='3000-01-01T00:00:00.000Z';
const ADVENTURE_FENCE='\x60\x60\x60';
const isAdventureWorld=world=>normalizedWorld(world)===normalizedWorld(ADVENTURE_WORLD);
const adventureHeaderPattern=/^(\d{4})年(\d{1,2})月(\d{1,2})日[ \t]+(\d{1,2})[：:](\d{2})分?(?:（[^（）\n]+）)?[ \t]+[I｜|][ \t]+(\S.*)$/u;
function adventureHeader(line){
 const t=clean(line);
 if(t.startsWith('**')!==t.endsWith('**'))return null;
 return (t.startsWith('**')?t.slice(2,-2).trim():t).match(adventureHeaderPattern);
}
function adventureHudColor(lines){
 const blue=lines.includes('🔹【基礎】🔹')&&lines.includes('🔹【共鳴契】🔹')&&(lines.includes('🔹【狀態】🔹')||lines.includes('🔹【狀態】'));
 const orange=lines.includes('🔸【基礎】🔸')&&lines.includes('🔸【共鳴契】🔸')&&lines.includes('🔸【狀態】🔸');
 return blue===orange?null:blue?'🔹':'🔸';
}
function adventureClockEvidence(input){
 const lines=clean(input).split('\n');
 const markers=new Set(lines.map(line=>line.trim()));
 if(adventureHudColor([...markers]))return true;
 return lines.some((line,i)=>/^(?:\*\*)?\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}[：:]\d{2}/u.test(line.trim())&&
  (/[ \t]+[I｜|][ \t]+\S/u.test(line)||['🔹【基礎】🔹','🔸【基礎】🔸'].includes(lines[i+1]?.trim())));
}
// A single, bounded context marker immediately before the fenced HUD.
function adventureContextLine(line){
 const m=String(line||'').trim().match(/^\{\{([^{}\n]{1,200})\}\}$/u);
 return !!m&&!!m[1].trim()&&!/^(?:user|char|character|img|image)(?:\s*(?:[:|=]|$))/iu.test(m[1].trim());
}
// WHIF renders a quoted place name on its own line inside a bold HUD title.
 // Only reassemble quote-adjacent boundaries before the first named HUD section.
// Exact observed WHIF world-label variants. The label itself is visible
// and must survive projection; only an adjacent bounded context may be hidden.
function adventureWorldPrefix(line){
 const m=String(line||'').trim().match(/^(身為冒(?:險者|-冒險者|-|者|憂者)就可以這樣那樣[:：])(?:[ \t]*(\{\{[^{}\n]{1,200}\}\}))?$/u);
 return m&&(!m[2]||adventureContextLine(m[2]))?{label:m[1],context:m[2]||''}:null;
}
function adventureClockTitle(lines){
 const direct=adventureHeader(lines[0]);
 const basic=x=>x==='🔹【基礎】🔹'||x==='🔸【基礎】🔸';
 if(direct&&basic(lines[1]))return {match:direct,headerRows:1};
 const end=lines.findIndex(basic);
 if(end<2||end>12||!/^\*\*\d{4}年\d{1,2}月\d{1,2}日[ \t]+\d{1,2}[：:]\d{2}/u.test(lines[0]))return null;
 const pieces=lines.slice(0,end);
 if(!pieces.at(-1).endsWith('**')||pieces.some((x,i)=>!x||x.slice(i===0?2:0,i===end-1?-2:undefined).includes('**')))return null;
 const quote=x=>/^「[^「」\n]+」(?:\*\*)?$/u.test(x);
 for(let i=1;i<pieces.length;i++){
  if(!quote(pieces[i])&&!quote(pieces[i-1]))return null;
 }
 const match=adventureHeader(pieces.join(''));
 return match?{match,headerRows:end}:null;
}
const ADVENTURE_EVENT_CONTEXT='{{Below context is an event which has just occurred. '+ADVENTURE_WORLD+' should not skip this moment — chime in naturally as '+ADVENTURE_WORLD+' would react. This event is to make the story dynamic and fresh.}}';
function adventureEventPrefix(input){
 const lines=clean(input).split('\n');
 if(lines[0].trim()!==ADVENTURE_EVENT_CONTEXT)return null;
 let i=1;while(i<=3&&!lines[i]?.trim())i++;
 const prefix=adventureWorldPrefix(lines[i]);
 if(!prefix?.context||prefix.label!==ADVENTURE_WORLD+':')return null;
 return {label:prefix.label,context:prefix.context,body:lines.slice(i+1).join('\n'),projected:prefix.label+'\n'+lines.slice(i+1).join('\n')};
}
function adventureClockDetails(input){
 const eventPrefix=adventureEventPrefix(input);
 let lines=clean(eventPrefix?.projected||input).split('\n').map(line=>line.trim());
 if(isEvent(lines[0])){lines.shift();while(lines[0]==='')lines.shift()}
 const prefix=adventureWorldPrefix(lines[0]);
 // A literal malformed marker observed identically in both projections.
 // Parse the following HUD but never remove or repair this marker in text.
 const literalContext=lines[0]?.match(/^\{\{([^{}\n【】]{1,200})】】$/u);
 const visibleMalformed=!!literalContext&&adventureContextLine('{{'+literalContext[1]+'}}');
 if(adventureContextLine(lines[0])||prefix||visibleMalformed){
  let at=1;
  while(at<=3&&lines[at]==='')at++;
  if(lines[at]===ADVENTURE_FENCE||((prefix&&!prefix.context||visibleMalformed)&&adventureClockTitle(lines.slice(at))))lines=lines.slice(at);
 }
 const fenced=lines[0]===ADVENTURE_FENCE;
 if(fenced)lines.shift();
 const title=adventureClockTitle(lines);
 if(!title)return null;
 const {match,headerRows}=title;
 const end=lines.indexOf(ADVENTURE_FENCE,headerRows+1);
 // Only the proven world-label event shape may have a visible unclosed HUD.
 // Comparison must still prove the literal opening fence and complete body.
 if(fenced&&end<0&&(!prefix||prefix.label!==ADVENTURE_WORLD+':'||lines.some(x=>x.startsWith(ADVENTURE_FENCE))))return null;
 const allHud=lines.slice(0,end<0?undefined:end),color=adventureHudColor(allHud);
 if(!color||allHud[headerRows]!==color+'【基礎】'+color)return null;
 const hud=allHud.slice(headerRows+1),co=hud.indexOf(color+'【共鳴契】'+color),st=hud.findIndex(x=>x===color+'【狀態】'+color||color==='🔹'&&x==='🔹【狀態】');
 if(co<0||st<=co||!hud.slice(0,co).some(x=>/^等級[：:]/u.test(x))||
  !hud.slice(0,co).some(x=>/^血量[：:]/u.test(x))||
  !hud.slice(co+1,st).some(x=>/^對象[：:]/u.test(x))||
  !hud.slice(co+1,st).some(x=>/^深度[：:]/u.test(x)))return null;
 const [year,month,day,hour,minute]=match.slice(1,6).map(Number);
 const local=new Date(Date.UTC(year,month-1,day,hour,minute));
 if(year<100||month<1||month>12||day<1||day>31||hour>23||minute>59)return null;
 const pad=n=>String(n).padStart(2,'0');
 const civil=year+'/'+pad(month)+'/'+pad(day)+' '+pad(hour)+':'+pad(minute);
 if(local.getUTCFullYear()!==year||local.getUTCMonth()+1!==month||local.getUTCDate()!==day)
  return {iso:null,civil,invalidDate:true,header:match[0],profile:'adventure'};
 return {iso:new Date(local.getTime()-8*3600000).toISOString(),
  civil,
  year,month,day,hour,minute,second:0,location:match[6],profile:'adventure'};
}
function parseAdventureClock(input){const result=adventureClockDetails(input);return result?.invalidDate?null:result;}
function adventureOpening(text){
 const clock=parseAdventureClock(text);
 return clock?.iso===ADVENTURE_OPENING_ISO&&clock.location==='冒險者公會';
}
// Only remove proven visual block delimiters. A block may be rendered as a
// monospace box or as a literal fenced block. Every block and all surrounding
// prose must match in order. Return native text including original fences,
// titles, placeholder tokens, punctuation, and all inventory characters.
function systemBoxProof(raw,domKey){
 const key=raw.replace(/\s/gu,'');
 // Each alternative is confined to an actual paired delimiter or a known
 // emoticon spelling in a system box. Bold pairs cannot be split.
 const choices=new Map();
 for(const m of raw.matchAll(/(?<!\*)\*\*([^*\n]+)\*\*(?!\*)/gu)){
  const start=raw.slice(0,m.index).replace(/\s/gu,'').length,v=m[0].replace(/\s/gu,'');
  choices.set(start,{end:start+v.length,variants:[v,m[1].replace(/\s/gu,'')]});
 }
 for(const m of key.matchAll(/☆\*ヾ\([・•]ω[・•]\*\)ノ\*☆|✧\*｡٩\(ˊᗜˋ\*\)و✧\*｡|٩\(ˊᗜˋ\*\)و|\(\*\/ω＼\*\)|\(\*´ω`\*\)|\(\*¯꒳¯\*\)/gu)){
  const v=m[0],stars=[...v.matchAll(/\*/g)].map(x=>x.index);
  const variants=[v];
  // Only the known renderings of these punctuation patterns are admitted.
  if(stars.length===2)variants.push(v.replace(/\*/g,''));
  else if(stars.length===3)variants.push(v.replace('*','').replace('*',''),v.replace(/\*/g,''));
  else if(stars.length===1)variants.push(v.replace('*',''));
  choices.set(m.index,{end:m.index+v.length,variants});
 }
 let positions=new Set([0]);
 for(let i=0;i<key.length;){
  const choice=choices.get(i)||{end:i+1,variants:[key[i]]};
  const next=new Set();
  for(const pos of positions)for(const v of choice.variants)if(domKey.startsWith(v,pos))next.add(pos+v.length);
  if(!next.size)return false;
  positions=next;i=choice.end;
 }
 return positions.has(domKey.length);
}
function compareAdventureParagraphs(scanned,nativeCopy,options){
 const visible=clean(scanned),original=clean(nativeCopy),compact=v=>v.replace(/\s/gu,'');
 const eventPrefix=options.event===true&&options.source==='whif-event-content'?adventureEventPrefix(original):null;
 const eventProven=eventPrefix&&visible.split('\n')[0].trim()===eventPrefix.label&&clean(options.eventTitle)===eventPrefix.label&&!visible.includes(eventPrefix.context)&&!visible.includes(ADVENTURE_EVENT_CONTEXT);
 const projection=eventProven?eventPrefix.projected:original;
 const actual=compact(visible),nativeClock=parseAdventureClock(original),clock=parseAdventureClock(visible);
 const invalidA=adventureClockDetails(visible),invalidB=adventureClockDetails(original);
 const invalidClock=options.allowInvalidNativeDate===true&&options.source==='whif-message-content'&&!options.event&&!options.opening&&invalidA?.invalidDate&&invalidB?.invalidDate&&invalidA.header===invalidB.header;
 const clockEqual=Boolean(invalidClock||clock&&nativeClock&&clock.iso===nativeClock.iso&&
  (!options.opening||(adventureOpening(visible)&&adventureOpening(original))));
 const blocks=[...projection.matchAll(/^[ \t]*\x60{3}[ \t]*\n([\s\S]*?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/gm)];
 const fenceLines=projection.split('\n').filter(l=>l.trim().startsWith(ADVENTURE_FENCE));
 const openTail=(options.source==='whif-message-content'&&!options.event||eventProven)&&fenceLines.length===blocks.length*2+1&&fenceLines.every(l=>l.trim()===ADVENTURE_FENCE)&&
  (blocks.length>0||eventProven)&&projection.slice((blocks.at(-1)?.index??0)+(blocks.at(-1)?.[0].length??0)).split('\n').filter(l=>l.trim()===ADVENTURE_FENCE).length===1;
 const validFences=(fenceLines.length===blocks.length*2&&blocks.length>0)||openTail;
 const proof=Array.isArray(options.codeBlocks)?options.codeBlocks:[];
 let matched=false,omitted=0,headings=0,offset=0,sourceOffset=0,hiddenContext='',postContext='',quotePairs=0,systemBoxProjections=0;
 const bounded=options.source==='whif-message-content'&&!options.event;
 // Only whole visible dialogue lines may prove omission of a paired
 // native quote. Never apply to HUD/other code blocks or unknown sources.
 const lineStarts=new Set(),lineEnds=new Set();
 let lineOffset=0;
 for(const line of visible.split('\n')){
  const value=compact(line);
  if(value){lineStarts.add(lineOffset);lineOffset+=value.length;lineEnds.add(lineOffset);}
 }
 const leadingWorld=adventureWorldPrefix(projection.split('\n')[0]);
 // Project only a single standalone leading context immediately before a
 // proven HUD fence from a bounded native reply, never a body marker.
 const firstLine=projection.split('\n')[0];
 if(bounded&&(adventureContextLine(firstLine)||leadingWorld?.context)&&
    blocks[0]&&/^\n(?:[ \t]*\n){0,2}$/u.test(projection.slice(firstLine.length,blocks[0].index))&&
    adventureHeader(blocks[0][1].split('\n')[0])&&
    !visible.includes(leadingWorld?.context||firstLine)&&
    (leadingWorld?visible.split('\n')[0].trim()===leadingWorld.label:!actual.startsWith(compact(firstLine)))){
  hiddenContext=leadingWorld?.context||firstLine;sourceOffset=blocks[0].index;
  if(leadingWorld)offset=compact(leadingWorld.label).length;
 }
 const take=(value,prose=false)=>{
  const v=compact(value);
  if(actual.startsWith(v,offset)){offset+=v.length;return true}
  if(!prose||!bounded)return false;
  let pos=offset,from=0,pairs=0;
  const eat=str=>{const q=compact(str);if(!actual.startsWith(q,pos))return false;pos+=q.length;return true};
  for(const m of value.matchAll(/「([^「」\n]+)」/gu)){
   if(!eat(value.slice(from,m.index)))return false;
   if(!eat(m[0])){
    const q=compact(m[1]);
    if(!q||!lineStarts.has(pos)||!lineEnds.has(pos+q.length)||!eat(m[1]))return false;
    pairs++;
   }
   from=m.index+m[0].length;
  }
  if(!pairs||!eat(value.slice(from)))return false;
  offset=pos;quotePairs+=pairs;return true;
 };
 // A single hidden marker in the gap immediately after the proven HUD,
 // before any narrative. Keep all visible tokens, including any later marker.
 const gap=(value,afterHud=false)=>{
  if(afterHud&&bounded&&!hiddenContext){
   const m=value.match(/^\n(?:[ \t]*\n){0,2}[ \t]*(\{\{[^{}\n]{1,200}\}\})[ \t]*\n(?:[ \t]*\n){0,2}(?=\S)/u);
   if(m&&adventureContextLine(m[1])&&!visible.includes(m[1])&&!/^\s*\{\{/u.test(value.slice(m[0].length))){
    if(take(value.slice(m[0].length),true)){postContext=m[1];return true}
   }
  }
  return take(value,true);
 };
 if(validFences&&proof.length===blocks.length){
  matched=true;
  for(let i=0;i<blocks.length;i++){
   const b=blocks[i],raw=b[1],first=raw.split('\n')[0],heading=first.trim();
   const knownBold=heading.startsWith('**')&&heading.endsWith('**')&&
    (i===0&&!!adventureHeader(heading)||/^\*\*(?:【[^】\n]+】|此次戰鬥損益！|系統對話框|共鳴契對象階段變化！|冒險者階級考核結果！|本次委託結果！|冒險者階級考核進行中！)\*\*$/u.test(heading));
   const stripped=knownBold?raw.replace(first,heading.slice(2,-2).trim()):raw;
   // The system box can be parsed as rich text in DOM textContent even
   // though the independent serialized Markdown preserves the exact source.
   // Prove only paired bold delimiters and stars in observed kaomoji; no
   // arbitrary body character can disappear. The raw form is still required
   // for these richer projections in the serialized DOM below.
   const domKey=compact(String(proof[i]??''));
   const standard=[raw,stripped].filter(v=>compact(v)===domKey);
   const systemProof=heading==='**系統對話框**'&&systemBoxProof(raw,domKey);
   const domProven=standard.length>0||systemProof;
   if(!standard.length&&systemProof)systemBoxProjections++;
   const variants=[...new Set([raw,...standard])];
   if(!domProven||!gap(projection.slice(sourceOffset,b.index),i===1)){matched=false;break}
   let consumed=false;
   for(const v of variants){
    if(take(ADVENTURE_FENCE+'\n'+v+'\n'+ADVENTURE_FENCE)){consumed=true;if(v!==raw)headings++;break}
    if(take(v)){consumed=true;omitted+=2;if(v!==raw)headings++;break}
   }
   if(!consumed){matched=false;break}
   sourceOffset=b.index+b[0].length;
  }
  // An open tail must be visible verbatim (apart from whitespace), including its opening delimiter.
  matched=matched&&(openTail?take(projection.slice(sourceOffset),false):gap(projection.slice(sourceOffset),blocks.length===1))&&offset===actual.length;
 }
 // Exact native text needs no removed-delimiter evidence; malformed or
 // unmatched fences are still rejected, even on an otherwise equal body.
 const literal=validFences&&!openTail&&actual===compact(original);
 const contentEqual=Boolean(literal||matched);
 const formatMarkers=[];
 if(contentEqual&&eventProven)formatMarkers.push({kind:'adventure-proven-event-title-companion',tokens:2,nonWhitespaceChars:compact(ADVENTURE_EVENT_CONTEXT+eventPrefix.context).length});
 if(contentEqual&&openTail)formatMarkers.push({kind:'adventure-visible-unclosed-tail',tokens:0,nonWhitespaceChars:0});
 if(contentEqual&&systemBoxProjections)formatMarkers.push({kind:'adventure-system-box-dom-text-projection',tokens:systemBoxProjections,nonWhitespaceChars:0});
 if(contentEqual&&!literal&&hiddenContext)formatMarkers.push({kind:'adventure-leading-context-template',tokens:1,nonWhitespaceChars:compact(hiddenContext).length});
 if(contentEqual&&!literal&&postContext)formatMarkers.push({kind:'adventure-post-hud-context-template',tokens:1,nonWhitespaceChars:compact(postContext).length});
 if(contentEqual&&!literal&&quotePairs)formatMarkers.push({kind:'adventure-proven-dialogue-quote-pair',tokens:quotePairs*2,nonWhitespaceChars:quotePairs*2});
 if(contentEqual&&!literal&&omitted)formatMarkers.push({kind:'adventure-ordered-dom-code-fence',tokens:omitted,nonWhitespaceChars:omitted*3});
 if(contentEqual&&!literal&&headings)formatMarkers.push({kind:'adventure-proven-code-heading-bold',tokens:headings*2,nonWhitespaceChars:headings*4});
 const comparison={scannedLength:[...visible].length,nativeLength:[...original].length,
  scannedNonWhitespace:[...actual].length,nativeNonWhitespace:[...compact(original)].length,
  comparableNativeNonWhitespace:contentEqual?[...actual].length:[...compact(original)].length,
  whitespaceOnlyEqual:literal,contentEqual,clockEqual,formatMarkers,
  formatMarkerCount:formatMarkers.reduce((n,x)=>n+x.tokens,0),
  explainedNonWhitespace:formatMarkers.reduce((n,x)=>n+x.nonWhitespaceChars,0),
  remainingUnexplained:{scanned:contentEqual?0:Math.max(0,actual.length-offset),native:contentEqual?0:Math.max(0,compact(original).length-offset)},
  ignoredDifferences:formatMarkers.map(x=>x.kind),adventureProjection:{nativeBlocks:blocks.length,domBlocks:proof.length,allOrdered:contentEqual,systemBoxProjections}};
 return {text:contentEqual&&clockEqual?original:null,comparison:{...comparison,...(invalidClock&&contentEqual?{invalidNativeDate:{civil:invalidA.civil,header:invalidA.header}}:{})}};
}

// A clock-shaped HUD anywhere is evidence against an untimed classification,
// even when the bounded primary parser cannot resolve its location or value.
function hasHudClockEvidence(input){
 if(roadClockEvidence(input)||adventureClockEvidence(input))return true;
 const lines=clean(input).split('\n').map(line=>line.trim());
 return lines.some((line,i)=>{
  if(!/^[｜|│]\s*\d{4}\s*(?:年|[-/])/u.test(line))return false;
  const next=lines.slice(i+1,i+5).find(Boolean)||'';
  return /^[｜|│]\s*(?:🕒\s*)?\d{1,2}\s*[：:]\s*\d{2}/u.test(next);
 });
}
// Strict alternative to the historical *** separator: the prefix must be a
// complete numbered news list, with each item carrying its heat and comment.
function structuredNewsPrefix(prefix){
 const fence=String.fromCharCode(96).repeat(3);
 let rows=prefix.split('\n').map(line=>line.trim());
 while(rows.at(-1)==='')rows.pop();
 const fenced=rows[0]===fence;
 if(fenced)rows.shift();
 if(rows.shift()!=='【基甫納熱搜】')return false;
 const contextOK=s=>/^\{\{[^{}\n]{1,200}\}\}$/u.test(s||'')&&
  !/^\{\{\s*(?:user|char|character|img|image)(?:\s*[:|=}]|\s*$)/iu.test(s);
 if(fenced){
  const close=rows.indexOf(fence);
  if(close<0)return false;
  const suffix=rows.slice(close+1).filter(Boolean);
  if(!(suffix.length===1&&suffix[0]===fence)&&
     !(suffix.length===2&&contextOK(suffix[0])&&suffix[1]===fence))return false;
  rows=rows.slice(0,close);
 }else{
  while(rows.at(-1)==='')rows.pop();
  if(rows.at(-1)===fence)rows.pop();
  while(rows.at(-1)==='')rows.pop();
  if(contextOK(rows.at(-1)))rows.pop();
 }
 const heading=/^(?:\*{2})?#(\d+)[ \t]+.+$/u;
 const heat=/^(?:\*{2})?🔥(?:\uFE0F)?熱度[：:]\s*[\d,]+(?:\*{2})?$/u;
 const comment=/^(?:\*{2})?💬(?:\uFE0F)?匿名留言[：:]\s*\S/u;
 const boundary=s=>!s||/^(?:\*{2})?#\d+|^(?:\*{2})?[🔥💬]|^[｜|│]|^\x60{3}|^\{\{|^【|^>/u.test(s);
 let pos=0,n=0;
 const skip=()=>{while(rows[pos]==='')pos++};
 // Only adjacent balanced Chinese quote wrapping may extend these fields.
 const take=pattern=>{
  let line=rows[pos];
  if(!line||!pattern.test(line))return null;
  pos++;
  while(/^「[^「」\n]+」$/u.test(rows[pos]||'')){
   line+=rows[pos++];
   if(!boundary(rows[pos])&&!/^「[^「」\n]+」$/u.test(rows[pos]))line+=rows[pos++];
  }
  return line;
 };
 skip();
 while(pos<rows.length){
  const h=take(heading);
  if(!h||+h.match(heading)[1]!==++n)return false;
  skip();
  if(!heat.test(rows[pos++]||''))return false;
  skip();
  if(!take(comment))return false;
  skip();
 }
 return n>=2;
}
// Road survival has no calendar year. The ISO is only a reversible
// day-index sorting coordinate, NOT a claimed Gregorian story date.
const ROAD_WORLD='公路求生－我是求生者！';
const ROAD_CLOCK_ENCODING='synthetic-2000-01-01-local-day-1';
const isRoadWorld=w=>normalizedWorld(w)===normalizedWorld(ROAD_WORLD);
const clockProfile=w=>isRoadWorld(w)?'road':isAdventureWorld(w)?'adventure':'sentinel';
const roadHead=/^⏰\uFE0F?\s*[：:]\s*來到公路第\s*(\d{1,6})\s*日\s*[｜|]\s*(\d{1,2})[.．/](\d{1,2})\s*[.．]\s*(\d{1,2})[：:](\d{2})\s*[.．]\s*天氣[：:]\s*(\S.*)$/u;
const roadClockEvidence=input=>clean(input).split('\n').some(line=>/^(?:\*\*)?⏰\uFE0F?\s*[：:]?\s*來到公路第/u.test(line.trim()));
const roadFields=[
 /^(?:🚗|🚙)\uFE0F?[：:]\s*(?:未選擇\s*[｜|]\s*未解鎖|\S.*[｜|]\s*(?:等級\s*\d+|[A-FS]級)(?:（[^\n]{1,2000}）)?)\s*$/u,
 /^🔋\uFE0F?[：:]\s*\S.*[｜|]/u,
 /^🔧\uFE0F?[：:]\s*\d+(?:\.\d+)?\s*[／/]\s*\d+(?:\.\d+)?/u,
 /^(?:🚐|📦|🛢|🚚|🛻|🛈)\uFE0F?[：:]\s*\d+(?:\.\d+)?\s*[／/]\s*\d+(?:\.\d+)?/u,
 /^🧩\uFE0F?[：:]\s*\d+\s*[／/]\s*\d+/u,
 /^🛣\uFE0F?[：:]\s*(?:今日剩餘里程[：:]\s*)?\d+(?:\.\d+)?公里\s*[／/]\s*每日規定\s*\d+(?:\.\d+)?公里/u,
 /^(?:(?:🍖|🥩)\uFE0F?[：:]\s*飢餓度[：:]\s*\d+\s*[｜|]\s*💧\uFE0F?\s*[：:]?\s*口渴度[：:]\s*\d+|♂\uFE0F?[：:]\s*(?:精液|痕跡)[：:]\s*\d+(?:\.\d+)?\s*[／/]\s*\d+(?:\.\d+)?)/u,
 /^⚡\uFE0F?[：:]\s*\d+(?:\.\d+)?\s*[／/]\s*\d+(?:\.\d+)?/u,
 /^❤\uFE0F?[：:]\s*\S/u,
 /^🎒\uFE0F?[：:]\s*\S/u,
 /^⚔\uFE0F?[：:]\s*\S/u,
 /^(?:💰|🪙)\uFE0F?[：:]\s*\S/u,
 /^📜\uFE0F?[：:]\s*\S/u,
 /^💦\uFE0F?[：:]\s*\S/u,
 /^📐\uFE0F?[：:]\s*\S/u
];
function parseRoadClock(input){
 const lines=clean(input).split('\n').map(x=>x.trim()).filter(Boolean);
 const at=lines.flatMap((x,i)=>/^(?:\*\*)?⏰\uFE0F?\s*[：:]?\s*來到公路第/u.test(x)?[i]:[]);
 if(at.length!==1)return null;
 const i=at[0],head=lines[i],m=(head.startsWith('**')&&head.endsWith('**')?head.slice(2,-2):head).match(roadHead);
 if(!m)return null;
 const fields=lines.slice(i+1);
 // A terminal WHIF image template is metadata only when it follows the
 // closing HUD fence. It must never hide arbitrary trailing narrative.
 if(/^\{\{(?:img|image)::[A-Za-z0-9_-]{1,100}\}\}$/iu.test(fields.at(-1)||'')&&fields.at(-2)===ADVENTURE_FENCE)fields.pop();
 if(fields.at(-1)===ADVENTURE_FENCE)fields.pop();
 else if(lines[i-1]===ADVENTURE_FENCE&&/^\x60{3}[，。][^\n]{1,500}$/u.test(fields.at(-1)||''))fields.pop();
 // Exact observed variant omits both inventory and weapon fields. No
 // inferred or rewritten values. Every present field must stay in order.
 const patterns=[roadFields,roadFields.filter((_,i)=>i!==9&&i!==10)];
 if(!patterns.some((p,i)=>fields.length>=10&&fields.length<=p.length&&(!i||fields.length===p.length)&&fields.every((x,j)=>p[j].test(x))))return null;
 const [survivalDay,month,day,hour,minute]=m.slice(1,6).map(Number);
 const max=[31,29,31,30,31,30,31,31,30,31,30,31];
 if(survivalDay<1||survivalDay>100000||month<1||month>12||day<1||day>max[month-1]||hour>23||minute>59)return null;
 const pad=n=>String(n).padStart(2,'0');
 const civil='第'+survivalDay+'日｜'+pad(month)+'.'+pad(day)+' '+pad(hour)+':'+pad(minute);
 const iso=new Date(Date.UTC(2000,0,1,hour-8,minute)+(survivalDay-1)*86400000).toISOString();
 return {iso,civil,survivalDay,month,day,hour,minute,second:0,weather:m[6],profile:'road',encoding:ROAD_CLOCK_ENCODING};
}
function roadOpening(input){
 const t=clean(input);
 return !roadClockEvidence(t)&&!parseGameTime(t)&&['世界規則正在重構','唯一公路','請選擇你的初始能源'].every(x=>t.includes(x))&&t.includes('公路求生');
}
function compareRoadParagraphs(scanned,nativeCopy,options){
 const visible=clean(scanned),nativeOriginal=clean(nativeCopy),compact=v=>v.replace(/\s/gu,''),actual=compact(visible);
 // A same-line terminal fence suffix is not deleted from the native text.
 // Permit this event-only render projection only with accepted-source proof,
 // a proven complete box and full remaining-text equality below.
 const ev=options.nativeEventProof;
 const suffix=options.event===true&&options.source==='whif-event-content'&&isRoadWorld(options.worldName)&&ev?.kind==='event-message'&&ev.sender==='deg_event'&&ev.accepted===true&&typeof ev.messageId==='string'&&ev.messageId?
  nativeOriginal.match(/^[ \t]*\x60{3}([，。][^\n`]{1,500})$/mu):null;
 const tailSuffix=suffix&&suffix.index+suffix[0].length===nativeOriginal.length&&!visible.includes(suffix[1])?suffix:null;
 const original=tailSuffix?nativeOriginal.slice(0,-tailSuffix[1].length):nativeOriginal;
 const a=parseRoadClock(visible),b=parseRoadClock(nativeOriginal);
 const clockEqual=options.opening?roadOpening(visible)&&roadOpening(original):
  a&&b?a.civil===b.civil&&a.iso===b.iso:
  Boolean(!a&&!b&&!roadClockEvidence(visible)&&!roadClockEvidence(original)&&(options.event||options.verifiedUntimedNative));
 const blocks=[...original.matchAll(/^[ \t]*\x60{3}[ \t]*\n([\s\S]*?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/gm)];
 const fenceLines=original.split('\n').filter(l=>l.trim().startsWith(ADVENTURE_FENCE));
 // Only a genuine event source can project the exact WHIF event wrapper.
 const eventBound=options.event===true&&options.source==='whif-event-content'&&!options.opening&&isRoadWorld(options.worldName);
 const leadEvent=original.match(/^(\{\{Below context is an event which has just occurred\. ([^{}\n]{1,100}) should not skip this moment — chime in naturally as ([^{}\n]{1,100}) would react\. This event is to make the story dynamic and fresh\.\}\})[ \t]*\n(?:[ \t]*\n){0,2}/u);
 const eventWrapper=eventBound&&leadEvent&&leadEvent[2]===leadEvent[3]&&isRoadWorld(leadEvent[2])&&!visible.includes(leadEvent[1])?leadEvent:null;
 const afterClosed=blocks.length?blocks.at(-1).index+blocks.at(-1)[0].length:0;
 const openTail=(eventBound||options.source==='whif-message-content'&&!options.event&&!options.opening)&&fenceLines.length===2*blocks.length+1&&fenceLines.every(l=>l.trim()===ADVENTURE_FENCE)&&
  /(?:^|\n)[ \t]*\x60{3}[ \t]*\n⏰/u.test(original.slice(afterClosed))&&!!parseRoadClock(original.slice(afterClosed));
 const fencesValid=(fenceLines.length===2*blocks.length||openTail)&&fenceLines.every(l=>l.trim()===ADVENTURE_FENCE);
 const proof=Array.isArray(options.codeBlocks)?options.codeBlocks:[];
 let pos=0,sourcePos=0,omitted=0,quotePairs=0,hiddenContext='',hiddenImage='',worldContext='';
 const bounded=options.source==='whif-message-content'&&!options.event&&!options.opening;
 const starts=new Set(),ends=new Set();let linePos=0;
 for(const line of visible.split('\n')){const v=compact(line);if(v){starts.add(linePos);linePos+=v.length;ends.add(linePos);}}
 const take=(v,prose=false)=>{
  const key=compact(v);if(actual.startsWith(key,pos)){pos+=key.length;return true}
  if(!prose)return false;
  let cursor=pos,from=0,pairs=0;
  const eat=s=>{const k=compact(s);if(!actual.startsWith(k,cursor))return false;cursor+=k.length;return true};
  for(const m of v.matchAll(/「([^「」]+)」/gu)){
   if(!eat(v.slice(from,m.index)))return false;
   if(!eat(m[0])){const q=compact(m[1]);if(!q||!starts.has(cursor)||!ends.has(cursor+q.length)||!eat(m[1]))return false;pairs++;}
   from=m.index+m[0].length;
  }
  if(!pairs||!eat(v.slice(from)))return false;
  pos=cursor;quotePairs+=pairs;return true;
 };
 let matched=fencesValid&&proof.length===blocks.length;
 if(matched&&eventWrapper)sourcePos=eventWrapper[0].length;
 let eventCompanion='';
 const companion=original.slice(sourcePos).match(/^(\{\{[^{}\n]{1,200}\}\})[ \t]*\n(?:[ \t]*\n){0,2}/u);
 if(matched&&eventWrapper&&companion&&adventureContextLine(companion[1])&&!visible.includes(companion[1])&&blocks.length&&sourcePos+companion[0].length<=blocks[0].index){
  eventCompanion=companion[1];sourcePos+=companion[0].length;
 }
 // A visible world-name line is never removed. Only its adjacent hidden
 // context may be projected, and the entire remaining message must match.
 const label=original.slice(sourcePos).match(/^(<{0,2}🔞?公路求生[－—–-]我是求生者[！!]🔞?>{0,2}[:：])[ \t]+(\{\{[^{}\n]{1,200}\}\})[ \t]*(?=\n)/u);
 if(matched&&(bounded||eventWrapper)&&label&&(label[1].match(/^<*/u)[0].length===(label[1].match(/>*[:：]$/u)[0].length-1))&&adventureContextLine(label[2])&&!visible.includes(label[2])&&visible.split('\n')[0].trim()===label[1]&&take(label[1])){
  worldContext=label[2];sourcePos+=label[0].length;
 }
 // Project a single standalone leading context only for an independently
 // sourced ordinary reply, and only if ALL subsequent blocks/prose match.
 const leading=original.match(/^(\{\{[^{}\n]{1,200}\}\})[ \t]*\n(?:[ \t]*\n){0,2}/u);
 if(matched&&bounded&&!worldContext&&leading&&adventureContextLine(leading[1])&&!visible.includes(leading[1])&&blocks.length&&leading[0].length<=blocks[0].index){
  hiddenContext=leading[1];sourcePos=leading[0].length;
 }
 if(matched)for(let i=0;i<blocks.length;i++){
  const block=blocks[i],raw=block[1],dom=String(proof[i]??''),k=compact(dom);
  if(!take(original.slice(sourcePos,block.index),true)||!(compact(raw)===k||systemBoxProof(raw,k))){matched=false;break}
  const variants=[...new Set([raw,dom])];
  let ok=false;
  for(const v of variants){
   if(take(ADVENTURE_FENCE+'\n'+v+'\n'+ADVENTURE_FENCE)){ok=true;break}
   if(take(v)){omitted+=2;ok=true;break}
  }
  if(!ok){matched=false;break}
  sourcePos=block.index+block[0].length;
 }
 let tail=original.slice(sourcePos);
 const image=tail.match(/^\s*(\{\{(?:img|image)::[A-Za-z0-9_-]{1,100}\}\})\s*$/iu);
 if(matched&&bounded&&blocks.length&&image&&!visible.includes(image[1])&&parseRoadClock(blocks.at(-1)[1])){
  hiddenImage=image[1];tail='';
 }
 // An unclosed event HUD is literal source text, not a synthetic repaired box.
 if(openTail){
  const open=tail.match(/^[ \t]*\x60{3}[ \t]*\n⏰/mu);
  matched=matched&&!!open&&take(tail.slice(0,open.index),true)&&take(tail.slice(open.index),false)&&pos===actual.length;
 }else matched=matched&&take(tail,true)&&pos===actual.length;
 const literal=!tailSuffix&&fencesValid&&actual===compact(original);
 const contentEqual=Boolean(literal||matched&&(!tailSuffix||eventWrapper&&blocks.length&&proof.length===blocks.length));
 const markers=[];
 if(contentEqual&&!literal&&worldContext)markers.push({kind:'road-world-label-companion',tokens:1,nonWhitespaceChars:compact(worldContext).length});
 if(contentEqual&&!literal&&eventWrapper)markers.push({kind:'road-exact-event-context',tokens:1,nonWhitespaceChars:compact(eventWrapper[1]).length});
 if(contentEqual&&eventCompanion)markers.push({kind:'road-event-companion-context',tokens:1,nonWhitespaceChars:compact(eventCompanion).length});
 if(contentEqual&&tailSuffix)markers.push({kind:'road-accepted-event-terminal-fence-tail',tokens:1,nonWhitespaceChars:compact(tailSuffix[1]).length});
 if(contentEqual&&openTail)markers.push({kind:options.event?'road-literal-unclosed-event-hud':'road-literal-unclosed-reply-hud',tokens:0,nonWhitespaceChars:0});
 if(contentEqual&&!literal&&hiddenContext)markers.push({kind:'road-leading-context-template',tokens:1,nonWhitespaceChars:compact(hiddenContext).length});
 if(contentEqual&&!literal&&hiddenImage)markers.push({kind:'road-terminal-image-template',tokens:1,nonWhitespaceChars:compact(hiddenImage).length});
 if(contentEqual&&!literal&&omitted)markers.push({kind:'road-proven-ordered-code-fences',tokens:omitted,nonWhitespaceChars:omitted*3});
 if(contentEqual&&!literal&&quotePairs)markers.push({kind:'road-proven-dialogue-quote-pairs',tokens:quotePairs*2,nonWhitespaceChars:quotePairs*2});
 const comparison={scannedLength:visible.length,nativeLength:nativeOriginal.length,scannedNonWhitespace:actual.length,nativeNonWhitespace:compact(nativeOriginal).length,comparableNativeNonWhitespace:contentEqual?actual.length:compact(original).length,whitespaceOnlyEqual:literal,contentEqual,clockEqual:Boolean(clockEqual),formatMarkers:markers,formatMarkerCount:markers.reduce((n,x)=>n+x.tokens,0),explainedNonWhitespace:markers.reduce((n,x)=>n+x.nonWhitespaceChars,0),remainingUnexplained:{scanned:contentEqual?0:Math.max(0,actual.length-pos),native:contentEqual?0:Math.max(0,compact(original).length-pos)},ignoredDifferences:markers.map(x=>x.kind),roadProjection:{nativeBlocks:blocks.length,domBlocks:proof.length,allOrdered:contentEqual}};
 return {text:contentEqual&&clockEqual?nativeOriginal:null,comparison};
}

function parseGameTime(input){
 const road=parseRoadClock(input);
 if(road||roadClockEvidence(input))return road;
 const adventure=parseAdventureClock(input);
 if(adventure||adventureClockEvidence(input))return adventure;
  let lines=clean(input).split('\n');
  const lead=lines[0]?.match(/^\{\{([^{}\n]{1,200})\}\}$/u);
  if(lead&&!/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/iu.test(lead[1].trim())){
   const first=lines.findIndex((line,i)=>i>0&&line.trim());
   if(first>0&&lines[first].trim()==='【基甫納熱搜】')lines=lines.slice(first);
  }
  let head=lines.slice(0,18).join('\n').slice(0,1600);
  // Recognized notification/news headers may precede a real HUD by many
  // lines. Extend only for a unique consecutive date/time/location header.
  const fencedNews=lines[0]?.trim()===String.fromCharCode(96).repeat(3)&&lines[1]?.trim()==='【基甫納熱搜】';
  if(fencedNews||/^【(?:終端|基甫納熱搜)】$/u.test(lines[0]?.trim()||'')){
   const candidates=[];
   for(let i=1;i<Math.min(lines.length-2,48);i++){
    if(!/^[｜|│]\s*\d{4}(?:年|[-/])/u.test(lines[i].trim())||
       !/^[｜|│]\s*(?:🕒\s*)?\d{1,2}[：:]\d{2}(?:[.:：]\d{1,2})?\s*[｜|│]/u.test(lines[i+1].trim())||
       !/^[｜|│]\s*📍/u.test(lines[i+2].trim()))continue;
    const prefix=lines.slice(0,i).join('\n');
    if(prefix.length>4000)continue;
    if(fencedNews&&!structuredNewsPrefix(prefix))continue;
    if(lines[0].trim()==='【基甫納熱搜】'&&
       !/(?:^|\n)[ \t]*\*{3}[ \t]*(?:\n\s*\{\{[^{}\n]{1,200}\}\})?(?:\n\s*\x60{3})?\s*$/u.test(prefix)&&
       !structuredNewsPrefix(prefix))continue;
    if(lines[0].trim()==='【終端】'&&!/📨任務通知[：:]/u.test(prefix))continue;
    candidates.push(i);
   }
   if(candidates.length===1)head=lines.slice(candidates[0],candidates[0]+3).join('\n');
   else if(candidates.length>1)return null;
  }
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
 if(m)return clean(m[1]);
 const road=t.match(/^與\s*(🔞?公路求生[－—–-]我是求生者[！!]🔞?)\s*的\s*(?:世界|事件)/u);
 return road?clean(road[1]):null;
}
function isEvent(content){
 const t=clean(content);
 // An event must be presented as a notification, not merely mentioned in prose.
 return Boolean(worldInText(t)&&isRoadWorld(worldInText(t)))||/^(?:[⚠❗❕!！\uFE0F\s　]*)?(?:事件(?:到達|通知|發生|觸發)|與\s*《[^》]{2,120}》\s*的\s*事件)/u.test(t)
   || /^[!！⚠\uFE0F\s　]+與\s*《[^》]{2,120}》\s*的\s*世界/u.test(t)
   || /^.{0,45}(?:世界事件|緊急事件)\s*(?:到達|通知|觸發)/u.test(t);
}
function meaningful(str){return clean(str).replace(/\s+/g,' ')}
// A WHIF reply may explicitly say that both its date and time are unknown.
// Require an actual two-line status header; merely mentioning the phrases in
// story prose does not authorize a missing game clock.
function isExplicitUnknownGameTime(input){
 const lines=clean(input).split('\n').slice(0,7).map(line=>line.trim());
 const date=/^[｜|│]\s*日期不詳\s*[｜|│]$/u;
 const time=/^[｜|│]\s*(?:🕒\s*)?時間不詳\s*[｜|│]/u;
 const first=lines[0]?.startsWith('```')?1:0;
 return date.test(lines[first]||'')&&time.test(lines[first+1]||'');
}
// Only the first AI item may use this historical timed opener (2026/08/22 18:42 UTC+8).
// Do not treat other timed AI replies as openings or change their game clocks.
const LEGACY_OPENING_ISO='2026-08-22T10:42:00.000Z';
function isAllowedOpeningRow(row,expectedWorld){
 if(row?.role!=='ai'||isEvent(row.text)||isExplicitUnknownGameTime(row.text))return false;
 const clock=parseGameTime(row.text);
 if(isRoadWorld(expectedWorld))return roadOpening(row.text);
 if(clock?.profile==='road')return false;
 if(isAdventureWorld(expectedWorld))return adventureOpening(row.text);
 if(clock?.profile==='adventure')return !expectedWorld&&adventureOpening(row.text);
 return (!clock&&!hasHudClockEvidence(row.text))||clock?.iso===LEGACY_OPENING_ISO;
}

 // A historical reply with no visible time HUD must NOT inherit the opening
 // time. Accept it only when the unique WHIF React source confirms the
 // complete rendered message and the original source also has no time HUD.
 // Other missing-clock cases still fail closed.
 function verifiedUnclockedReply(row,rows){
  if(row?.role!=='ai'||row.eventType==='event'||isEvent(row.text)||
     parseGameTime(row.text)||isExplicitUnknownGameTime(row.text))
   return {ok:false,reason:'not-an-untimed-ordinary-reply'};
  const source=row.formatSource?.nativeReply;
  if(source?.reason!=='available'||typeof source.text!=='string'||
     source.text.length<8||source.text.length>30000||
     source.markerCount!==1||!source.messageId||
     source.scannedText!==row.text)
   return {ok:false,reason:'missing-matching-native-source'};
  if(rows.filter(item=>item.formatSource?.nativeReply?.messageId===source.messageId).length!==1)
   return {ok:false,reason:'non-unique-native-message-id'};
  const head=clean(source.text).split('\n').slice(0,12);
  if(parseGameTime(source.text)||isExplicitUnknownGameTime(source.text)||
     hasHudClockEvidence(row.text)||hasHudClockEvidence(source.text)||
     head.some(line=>/^[ \t]*[｜|│]\s*(?:\d{4}\s*(?:年|[-/])|日期|(?:🕒\s*)?時間|\d{1,2}:\d{2})/u.test(line)))
   return {ok:false,reason:'native-source-contains-time-header'};
  const verified=compareNativeParagraphs(row.text,source.text,{
   source:'whif-message-content',verifiedUntimedNative:true,
   chapterTitle:source.chapterTitle,
   statusText:row.formatSource?.statusText,codeBlocks:row.formatSource?.codeBlocks
  });
  return verified.text!==null&&verified.comparison.contentEqual&&verified.comparison.clockEqual
   ?{ok:true,reason:'native-text-confirmed-no-time'}
   :{ok:false,reason:verified.comparison.contentEqual?'native-clock-unverified':'native-text-mismatch'};
 }
function verifiedInvalidAdventureReply(row,rows){
 if(row?.role!=='ai'||row.eventType==='event'||isEvent(row.text))return null;
 const detail=adventureClockDetails(row.text),source=row.formatSource?.nativeReply;
 if(!detail?.invalidDate||source?.reason!=='available'||source.markerCount!==1||
    !source.messageId||source.scannedText!==row.text||typeof source.text!=='string'||
    source.text.length<8||source.text.length>30000||source.eventEvidence?.messageId!==source.messageId||
    source.eventEvidence?.kind!=='ordinary-message'||source.eventEvidence?.sender!=='character')return null;
 const ids=rows.flatMap(r=>[r.formatSource?.nativeReply?.messageId,...(r.formatSource?.playerSources||[]).map(x=>x.id)]);
 if(ids.filter(id=>id===source.messageId).length!==1)return null;
 const proof=compareNativeParagraphs(row.text,source.text,{source:'whif-message-content',allowInvalidNativeDate:true,
  chapterTitle:source.chapterTitle,statusText:row.formatSource?.statusText,codeBlocks:row.formatSource?.codeBlocks});
 if(proof.text===null||!proof.comparison.contentEqual||!proof.comparison.clockEqual||!proof.comparison.invalidNativeDate)return null;
 return {kind:'verified-original-invalid-calendar-date',civil:detail.civil,header:detail.header,
  sourceMessageId:source.messageId,markerCount:1,sender:'character',sourceKind:'ordinary-message'};
}
function invalidAdventureDate(input){const detail=adventureClockDetails(input);return detail?.invalidDate?{civil:detail.civil,header:detail.header}:null;}
function validate(rows,expectedWorld){
 const errors=[],warnings=[],canon=[],events=[];
 if(!Array.isArray(rows)||!rows.length)return {ok:false,errors:['沒有掃到任何可辨識訊息'],warnings,opening:'',messages:[],events:[],pairs:0};
 const opener=rows[0];
 if(!isAllowedOpeningRow(opener,expectedWorld))
   errors.push('首則不是可辨識的輪迴開場（依綁定世界觀驗收：原有開場規則或冒險者3000/01/01 08:00公會開場）；請回到真正的開場重新掃描');
 const opening=opener.role==='ai'?clean(opener.text):'';
 if(opening.length<8)errors.push('輪迴開場過短，可能選到工具列或不完整訊息');
 let pending=null,pairs=0,previousMs=null,autoContinues=0,unknownGameTimeCount=0,verifiedUntimedCount=0,invalidDateReplyCount=0,invalidDateRowCount=0;
 for(let i=1;i<rows.length;i++){
  const row=rows[i],role=row.role,t=clean(row.text);
  if(!t){errors.push('第 '+(i+1)+' 則是空訊息');continue}
  const domain=worldInText(t);
  if(domain&&expectedWorld&&normalizedWorld(domain)!==normalizedWorld(expectedWorld))
    errors.push('第 '+(i+1)+' 則事件／世界名稱「'+domain+'」與綁定世界觀「'+expectedWorld+'」不符；不能覆蓋其他世界觀');
  if(role==='ai'&&(row.eventType==='event'||isEvent(t))){
   const eventTime=parseGameTime(t);
   if(eventTime&&expectedWorld&&clockProfile(expectedWorld)!==(eventTime.profile||'sentinel'))errors.push('第 '+(i+1)+' 則事件的時間格式與綁定世界觀不一致');
   if(!eventTime&&hasHudClockEvidence(t))errors.push('第 '+(i+1)+' 則事件含有日期及時鐘欄位，但無法解析；禁止當成無時間事件');
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
  const explicitlyUnknown=isExplicitUnknownGameTime(t);
  if(explicitlyUnknown&&(hasHudClockEvidence(t)||hasHudClockEvidence(row.formatSource?.nativeReply?.text))){
   errors.push('第 '+(i+1)+' 則同時存在未知時間與明確時鐘欄位，無法安全判定');continue;
  }
  const clock=explicitlyUnknown?null:parseGameTime(t);
  if(clock&&expectedWorld&&clockProfile(expectedWorld)!==(clock.profile||'sentinel')){errors.push('第 '+(i+1)+' 則時間格式與綁定世界觀不一致');continue;}
  const invalidDate=!clock&&!explicitlyUnknown&&isAdventureWorld(expectedWorld)?verifiedInvalidAdventureReply(row,rows):null;
  const nativeUntimed=!clock&&!explicitlyUnknown&&!invalidDate?verifiedUnclockedReply(row,rows):null;
  if(!clock&&!explicitlyUnknown&&!invalidDate&&!nativeUntimed?.ok){
   errors.push('第 '+(i+1)+' 則 Gal AI 回覆沒有可辨識劇情時間，原生無時間來源未通過（'+
    (nativeUntimed?.reason||'unknown')+'）；不能自行沿用前一則時間');
   continue;
  }
  const continued=pending===null&&row.autoContinue===true&&canon.at(-1)?.role==='ai'&&canon.at(-1).scanIndex===i-1;
  if(pending===null&&!continued){errors.push('第 '+(i+1)+' 則 Gal AI 沒有相鄰的「我」');continue}
  // The explicit '日期不詳／時間不詳' header is evidence of an unknown
  // clock, NOT permission to borrow the previous reply's time.
  if(pending){pending.gameTime=clock?.iso||null;if(invalidDate)pending.nativePairedInvalidDate={civil:invalidDate.civil,sourceMessageId:invalidDate.sourceMessageId};}
  canon.push({role:'ai',text:t,scanIndex:i,gameTime:clock?.iso||null,...(nativeUntimed?.ok?{verifiedUntimedNative:true}:{}),...(invalidDate?{nativeInvalidDateEvidence:invalidDate}:{}),...(continued?{autoContinue:true}:{})});
  if(invalidDate){
   invalidDateReplyCount++;invalidDateRowCount+=pending?2:1;
   warnings.push('第 '+(i+1)+' 則原生日期無效（'+invalidDate.civil+'）；保留原文與掃描位置，禁止推定有效日期');
  }else if(explicitlyUnknown){
   unknownGameTimeCount+=pending?2:1;
   warnings.push('第 '+(i+1)+' 則 Gal AI 原文明示「日期不詳／時間不詳」；本回合時間保留空白，不推測時間');
  }else if(nativeUntimed?.ok){
   verifiedUntimedCount++;
   unknownGameTimeCount+=pending?2:1;
   warnings.push('第 '+(i+1)+' 則 Gal AI 來源 ID 唯一且原生全文核對一致，但原文未標記劇情時間；本回合保留 null，不借用開場時間');
  }else{
   if(previousMs!==null&&Date.parse(clock.iso)<previousMs)
    warnings.push('第 '+(i+1)+' 則遊戲時間早於前一回合（可能是劇情倒流，需核對原文）');
   previousMs=Date.parse(clock.iso);
  }
  if(continued)autoContinues++;else pairs++;
  pending=null;
 }
 if(pending!==null)errors.push('掃描尾端只有「我」，沒有對應 Gal AI 回覆');
 if(pairs===0)errors.push('沒有任何完整「我／他」回合');
 const sourceNames=[...new Set(events.map(x=>x.worldName).filter(Boolean))];
 if(expectedWorld&&sourceNames.length&&sourceNames.some(x=>normalizedWorld(x)!==normalizedWorld(expectedWorld)))
   errors.push('事件世界觀與綁定世界觀不一致');
 return {ok:errors.length===0,errors,warnings,opening,messages:canon,events,pairs,autoContinues,
  unknownGameTimeCount,verifiedUntimedCount,invalidDateReplyCount,invalidDateRowCount,worldNames:sourceNames,scannedRows:rows.length};
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
  if(options.metadata&&(isAdventureWorld(options.worldName)||isRoadWorld(options.worldName))&&tag==='pre'&&!n.querySelector?.(status)){
   (options.metadata.codeBlocks??=[]).push(n.textContent);
   if(parseAdventureClock(n.textContent)||parseRoadClock(n.textContent))options.metadata.statusText||=n.textContent;
  }
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
 if(isRoadWorld(options.worldName)||roadClockEvidence(scanned)||roadClockEvidence(nativeCopy)||options.opening&&(roadOpening(scanned)||roadOpening(nativeCopy)))return compareRoadParagraphs(scanned,nativeCopy,options);
 if(adventureClockEvidence(scanned)||adventureClockEvidence(nativeCopy))return compareAdventureParagraphs(scanned,nativeCopy,options);
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
 // Exact untimed adventure event wrapper and visible title companion.
 // Unique accepted native source is established by the caller.
 if(options.event===true&&options.source==='whif-event-content'&&!statusKey&&
    !(options.codeBlocks||[]).length&&titleKey&&!parseGameTime(scanned)&&
    !parseGameTime(original)&&!isExplicitUnknownGameTime(scanned)&&!isExplicitUnknownGameTime(original)&&
    !adventureClockEvidence(scanned)&&!adventureClockEvidence(original)){
  const world=ADVENTURE_WORLD;
  const context='{{Below context is an event which has just occurred. '+world+' should not skip this moment — chime in naturally as '+world+' would react. This event is to make the story dynamic and fresh.}}';
  const prefix=original.match(/^\{\{[^{}\n]{1,300}\}\}[ \t]*\n(?:[ \t]*\n){0,2}/u);
  const rest=prefix?original.slice(prefix[0].length):'';
  const header=rest.match(/^(身為冒險者就可以這樣那樣[:：])[ \t]+(\{\{([^{}\n]{1,200})\}\})[ \t]*(?=\n)/u);
  if(prefix&&prefix[0].trim()===context&&header&&adventureContextLine(header[2])&&
     visibleTitle===header[1]&&scanned.split('\n')[0].trim()===header[1]&&
     !scanned.includes(context)&&!scanned.includes(header[2])){
   const candidate=header[1]+rest.slice(header[0].length);
   const dom=[...unspaced(scanned)];let index=0,projected='',omitted=[],valid=true;
   for(const ch of candidate){
    if(/\s/u.test(ch)){projected+=ch;continue}
    if(ch===dom[index]){projected+=ch;index++;continue}
    if(ch==='「'||ch==='」'){omitted.push(ch);continue}
    valid=false;break;
   }
   let balance=0;for(const q of omitted){balance+=q==='「'?1:-1;if(balance<0){valid=false;break}}
   if(valid&&index===dom.length&&balance===0&&unspaced(projected)===unspaced(scanned)){
    record('leading-whif-event-context',1,text,rest);
    record('whif-untimed-adventure-event-title-companion',1,rest,candidate);
    if(omitted.length)record('native-event-dialogue-quotes',omitted.length,candidate,projected);
    text=candidate;
    eventQuoteProjection={pairs:omitted.length/2,comparableText:projected,preservedVisibleQuotes:(scanned.match(/[「」]/g)||[]).length};
   }
  }
 }
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
 // Opening text is a separate record, not an ordinary timed AI reply.
 // Permit one hidden contextual prefix only if the FULL visible opening can
 // be reconstructed after removing that prefix and a matching status fence.
 if(options.verifiedUntimedNative&&options.source==='whif-message-content'&&leading&&!preamble.test(scanned)){
  const label=leading[1].trim();
  const after=text.slice(leading[0].length);
  // This is only a trial transformation. The entire remaining message
  // still has to match, including all visible quotes, below.
  if(label&&!/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(label)){
   const candidate=unspaced(after);
   const visible=unspaced(scanned);
   if(candidate.replace(/[「」]/g,'')===visible.replace(/[「」]/g,'')){
    record('verified-untimed-leading-context',1,text,after);
    text=after;
   }
  }
 }
 if(options.opening&&options.source==='whif-message-content'&&leading&&!preamble.test(scanned)){
  const label=leading[1].trim();
  const after=text.slice(leading[0].length);
  const fence=after.match(statusFence);
  const projected=fence?fence[1]+after.slice(fence[0].length):after;
  if(label&&!/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(label)&&
     unspaced(projected)===unspaced(scanned)){
   record('opening-leading-whif-template',1,text,after);
   text=after;
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
 const openingStatusAligned=Boolean(options.opening&&unfenced&&
  unspaced(scanned).startsWith(unspaced(unfenced[1])));
 if(unfenced&&!statusFence.test(scanned.slice(eventFenceStart))&&
  (parseGameTime(unfenced[1])||openingStatusAligned)&&
  (!options.event||statusKey===unspaced(unfenced[1]))){
  const rest=text.slice(eventFenceStart+unfenced[0].length);
  // The closing fence makes the status a distinct block even if the
  // source uses a single newline before the next paragraph.
  const after=text.slice(0,eventFenceStart)+unfenced[1]+rest.replace(/^\n(?![ \t]*\n)(?=[\s\S]*\S)/,'\n\n');
  record('status-code-fence',2,text,after);
  statusText=unfenced[1];
  text=after;
 }
 // After WHIF's event HUD, a second *hidden* context marker can occur
 // directly before the event story. It is distinct from visible templates
 // elsewhere and from the previously verified leading event wrapper.
 // Never delete an arbitrary {{...}} token: the title, complete timestamped
 // status and every visible body character must align exactly. Missing
 // Chinese quotes are projected ONLY as balanced, whole-text-proven pairs.
 let eventPostStatusProjection=null;
 if(options.event===true&&options.source==='whif-event-content'&&
    !eventQuoteProjection&&titleKey&&statusKey&&
    parseGameTime(scanned)?.iso&&
    parseGameTime(scanned)?.iso===parseGameTime(text)?.iso){
  const eventHeader=titleKey+statusKey;
  if(unspaced(scanned).startsWith(eventHeader)&&
     unspaced(text).startsWith(eventHeader)){
   const sourceNonSpace=[...text.matchAll(/\S/gu)];
   const boundary=sourceNonSpace[[...eventHeader].length]?.index;
   const atBoundary=boundary===undefined?'':text.slice(boundary);
   const hidden=atBoundary.match(/^\{\{([^{}\n]{1,200})\}\}[ \t]*(?:\r?\n[ \t]*)*/u);
   const hiddenLabel=hidden?.[1]?.trim();
   if(hidden&&hiddenLabel&&
      !/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/i.test(hiddenLabel)&&
      !scanned.includes(hidden[0].trim())){
    const without=text.slice(0,boundary)+text.slice(boundary+hidden[0].length);
    const visible=[...unspaced(scanned)];
    let aligned=0,projected='',omitted=[],valid=true;
    for(const character of without){
     if(/\s/u.test(character)){projected+=character;continue}
     if(aligned<visible.length&&character===visible[aligned]){
      projected+=character;aligned++;continue;
     }
     if(character==='「'||character==='」'){omitted.push(character);continue}
     valid=false;break;
    }
    let depth=0;
    for(const quote of omitted){
     depth+=quote==='「'?1:-1;
     if(depth<0){valid=false;break}
    }
    if(valid&&aligned===visible.length&&depth===0&&
       omitted.length>0&&omitted.length%2===0&&
       unspaced(projected)===unspaced(scanned)){
     record('verified-event-post-status-hidden-template',1,text,without);
     record('verified-event-balanced-native-quotes',omitted.length,without,projected);
     text=without;
     eventPostStatusProjection={
      comparableText:projected,templateStartUtf16:boundary,
      templateNonWhitespaceChars:count(hidden[0]),
      omittedQuotePairs:omitted.filter(x=>x==='「').length,
      preservedVisibleQuotes:(scanned.match(/[「」]/g)||[]).length,
      provenEntireEventText:true
     };
    }
   }
  }
 }
 if(imageMarker.test(text)&&!imageMarker.test(scanned)){
  const after=text.replace(imageMarker,'').trimEnd();
  record('terminal-image-marker',1,text,after);
  text=after;
 }
 // A verified untimed WHIF reply can combine a LEADING hidden context
 // template, a TERMINAL image marker and two or more native Chinese dialogue
 // quotes which WHIF renders without quotation marks. The former must not be
 // checked before the independently recognizable terminal image is removed.
 // Make a single, reversible full-text projection, never globally deleting
 // arbitrary {{...}} blocks or changing the displayed story.
 let untimedCombinedProjection=null;
 if(options.verifiedUntimedNative===true&&options.source==='whif-message-content'&&
    !options.event&&!options.opening&&
    markers.some(marker=>marker.kind==='terminal-image-marker')&&
    !parseGameTime(scanned)&&!parseGameTime(original)&&
    !isExplicitUnknownGameTime(scanned)&&!isExplicitUnknownGameTime(original)){
  const hidden=text.match(preamble);
  const token=hidden?.[1]?.trim();
  if(hidden&&token&&!preamble.test(scanned)&&
     !scanned.includes(hidden[0].trim())&&
     !/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/i.test(token)){
   const after=text.slice(hidden[0].length);
   const visibleChars=[...unspaced(scanned)];
   let matched=0,comparable='',omitted=[],valid=true;
   for(const char of after){
    if(/\s/u.test(char)){comparable+=char;continue}
    if(matched<visibleChars.length&&char===visibleChars[matched]){
     comparable+=char;matched++;continue;
    }
    if(char==='「'||char==='」'){omitted.push(char);continue}
    valid=false;break;
   }
   let balance=0;
   for(const mark of omitted){
    balance+=mark==='「'?1:-1;
    if(balance<0){valid=false;break}
   }
   // Original native quotation marks are retained in 'text'; the projected
   // comparable string is used only for strict, complete DOM equivalence.
   if(valid&&matched===visibleChars.length&&balance===0&&
      omitted.length>0&&omitted.length%2===0&&
      unspaced(comparable)===unspaced(scanned)){
    record('verified-untimed-leading-context-after-image',1,text,after);
    record('verified-untimed-balanced-native-quotes',omitted.length,after,comparable);
    text=after;
    untimedCombinedProjection={comparableText:comparable,
     hiddenContextCount:1,terminalImageMarker:true,
     omittedQuotePairs:omitted.filter(x=>x==='「').length,
     preservedVisibleQuotes:(scanned.match(/[「」]/g)||[]).length,
     restoredFromUniqueNativeSource:true};
   }
  }
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

 // Historic WHIF chapters sometimes prepend a world-name label and one
 // hidden {{...}} context token to a fenced HUD. WHIF's DOM also renders
 // certain original 「」 pairs as separate unquoted lines. Compare the
 // ENTIRE rendered reply with an independently identified source, removing
 // only exactly one verified prefix token and the status fence, and projecting
 // only balanced Chinese quote characters. No arbitrary body text can change.
 let legacyMessageProjection=null;
 let legacyProjectionTrace=null;
 if(options.source==='whif-message-content'&&!options.event&&
    !unspaced(scanned).startsWith('{{')&&unspaced(scanned)!==unspaced(text)){
  const visibleLines=scanned.split('\n');
  const dateStart=visibleLines.findIndex(line=>
   /^[｜|│]\s*(?:\d{4}(?:年|[/-])|日期不詳)/u.test(line.trim()));
  legacyProjectionTrace={stage:'date-search',dateStart};
  if(dateStart>=0&&dateStart<=2){
   const visiblePrefix=visibleLines.slice(0,dateStart).join('\n');
   const statusRows=[];
   for(const line of visibleLines.slice(dateStart)){
    if(!/^[｜|│][\s\S]*[｜|│]$/u.test(line.trim()))break;
    statusRows.push(line);
   }
   const visibleStatusKey=unspaced(statusRows.join('\n'));
   const firstFence=/^[ \t]*\x60{3}[^\n]*\n/m.exec(text);
   legacyProjectionTrace={stage:'fence-search',dateStart,statusRows:statusRows.length,
    firstFence:Boolean(firstFence),visiblePrefixLength:count(visiblePrefix)};
   if(statusRows.length>=2&&firstFence){
    const fenced=text.slice(firstFence.index).match(statusFence);
    const hudEqual=Boolean(fenced&&unspaced(fenced[1])===visibleStatusKey);
    legacyProjectionTrace={...legacyProjectionTrace,stage:'hud-compare',
     fenced:Boolean(fenced),hudEqual,sourceHudLength:fenced?count(fenced[1]):null,
     visibleHudLength:count(visibleStatusKey)};
    if(hudEqual){
     const sourcePrefix=text.slice(0,firstFence.index);
     const syntax=/\{\{([^{}\n]{1,200})\}\}/gu;
     const hidden=[...sourcePrefix.matchAll(syntax)];
     const priorHiddenTemplate=markers.some(item=>item.kind==='leading-whif-template');
     const acceptable=hidden.length===1&&
      !/^(?:(?:user|char|character)$|(?:img|image)\s*:)/i.test(hidden[0][1].trim());
     const alreadyStripped=hidden.length===0&&priorHiddenTemplate;
     legacyProjectionTrace={...legacyProjectionTrace,stage:'template-check',
      templateCount:hidden.length,acceptable:acceptable||alreadyStripped,
      priorHiddenTemplate};
     if(acceptable||alreadyStripped){
      const plainPrefix=(acceptable?sourcePrefix.replace(hidden[0][0],''):sourcePrefix).trim();
      const prefixEqual=unspaced(plainPrefix)===unspaced(visiblePrefix);
      legacyProjectionTrace={...legacyProjectionTrace,stage:'prefix-compare',
       prefixEqual,sourcePrefixLength:count(plainPrefix)};
      if(prefixEqual){
       const noTemplate=(plainPrefix?plainPrefix+'\n':'')+text.slice(firstFence.index);
       const rest=text.slice(firstFence.index+fenced[0].length);
       const candidate=(plainPrefix?plainPrefix+'\n':'')+fenced[1]+
        rest.replace(/^\n(?![ \t]*\n)(?=[\s\S]*\S)/,'\n\n');
       const visibleKey=[...unspaced(scanned)],omitted=[];
       let aligned=0,comparable='',valid=true;
       for(const char of candidate){
        if(/\s/u.test(char)){comparable+=char;continue}
        if(aligned<visibleKey.length&&char===visibleKey[aligned]){
         comparable+=char;aligned++;continue;
        }
        if(char==='「'||char==='」'){omitted.push(char);continue}
        valid=false;break;
       }
       let balance=0;
       for(const char of omitted){
        balance+=char==='「'?1:-1;
        if(balance<0){valid=false;break}
       }
       const scannedClock=parseGameTime(scanned)?.iso;
       const candidateClock=parseGameTime(candidate)?.iso;
       const verifiedClock=Boolean(scannedClock&&scannedClock===candidateClock)||
        (!scannedClock&&!candidateClock&&
         isExplicitUnknownGameTime(scanned)&&isExplicitUnknownGameTime(candidate));
       legacyProjectionTrace={...legacyProjectionTrace,stage:'full-text-compare',
        valid,sourceAlignedChars:aligned,renderedChars:visibleKey.length,
        omittedQuoteMarks:omitted.length,balanced:balance===0,clockEqual:verifiedClock};
       if(valid&&balance===0&&aligned===visibleKey.length&&verifiedClock){
        if(acceptable)record('whif-legacy-hidden-template',1,text,noTemplate);
        record('whif-legacy-status-code-fence',2,noTemplate,candidate);
        if(omitted.length)
         record('whif-legacy-balanced-dialogue-quotes',omitted.length,candidate,comparable);
        text=candidate;
        legacyMessageProjection={comparableText:comparable,
         omittedQuotePairs:omitted.filter(char=>char==='「').length,
         preservedVisibleQuotes:(scanned.match(/[「」]/g)||[]).length,
         statusRows:statusRows.length,restoredFromNative:true};
        legacyProjectionTrace.stage='verified';
       }
      }
     }
    }
   }
  }
 }

 // WHIF renders some historic independent openings without any of their
 // native 「」 dialogue quotes. When the image marker has already been
 // independently stripped, restore these quotes and the original blank lines
 // ONLY if the full displayed text matches character-for-character after
 // projecting balanced missing quote pairs. Other text changes are rejected.
 let openingQuoteProjection=null;
 if(!untimedCombinedProjection&&(options.opening||options.verifiedUntimedNative)&&options.source==='whif-message-content'&&!options.event&&
    unspaced(scanned)!==unspaced(text)){
  const visibleChars=[...unspaced(scanned)];
  let matched=0,projected='',omitted=[],valid=true;
  for(const char of text){
   if(/\s/u.test(char)){projected+=char;continue}
   if(matched<visibleChars.length&&char===visibleChars[matched]){
    projected+=char;matched++;continue;
   }
   if(char==='「'||char==='」'){omitted.push(char);continue}
   valid=false;break;
  }
  let balance=0;
  for(const mark of omitted){
   balance+=mark==='「'?1:-1;
   if(balance<0){valid=false;break}
  }
  if(valid&&matched===visibleChars.length&&balance===0&&omitted.length>0){
   record('opening-balanced-dialogue-quotes',omitted.length,text,projected);
   openingQuoteProjection={comparableText:projected,
    omittedQuotePairs:omitted.filter(char=>char==='「').length,
    preservedVisibleQuotes:(scanned.match(/[「」]/g)||[]).length,
    restoredFromNative:true};
  }
 }


 // Historic untimed WHIF AI reply containing a hidden chapter/context token
 // near the beginning, one bare fenced block and a terminal image marker.
 // All three must be independently recognizable. This branch is only entered
 // after the ordinary validator verified a unique native WHIF source ID.
 // Commit NOTHING unless the ENTIRE resulting non-whitespace text equals the
 // DOM. Do not remove arbitrary prose or infer a game clock.
 let untimedWrappedProjection=null;
 if(options.verifiedUntimedNative===true&&
    options.source==='whif-message-content'&&!options.event&&!options.opening&&
    !parseGameTime(scanned)&&!parseGameTime(original)&&
    !isExplicitUnknownGameTime(scanned)&&!isExplicitUnknownGameTime(original)&&
    markers.some(item=>item.kind==='terminal-image-marker')&&
    unspaced(scanned)!==unspaced(text)){
  const wrappedTokens=[...text.matchAll(/\{\{([^{}\n]{1,300})\}\}/gu)];
  const eligible=wrappedTokens.filter(match=>{
   const label=match[1].trim();
   return match.index<=160&&
    !/^(?:user|char|character|img(?:age)?\s*:)/i.test(label)&&
    !/https?:\/\//i.test(label);
  });
  if(wrappedTokens.length===1&&eligible.length===1){
   const token=eligible[0];
   const withoutTemplate=text.slice(0,token.index)+text.slice(token.index+token[0].length);
   // Bare backticks only. Never strip a language-tagged fence or arbitrary
   // inline code: doing so could silently change real story content.
   const bareFence=/^[ \t]*\x60{3}[ \t]*\n([\s\S]*?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/gm;
   const blocks=[...withoutTemplate.matchAll(bareFence)];
   if(blocks.length===1&&blocks[0][1].trim()&&
      token.index<withoutTemplate.indexOf(String.fromCharCode(96).repeat(3))){
    const block=blocks[0];
    const candidate=withoutTemplate.slice(0,block.index)+block[1]+
     withoutTemplate.slice(block.index+block[0].length);
    if(unspaced(candidate)===unspaced(scanned)){
     record('untimed-verified-hidden-context',1,text,withoutTemplate);
     record('untimed-verified-bare-fence',2,withoutTemplate,candidate);
     text=candidate;
     untimedWrappedProjection={
      templateCount:1,bareFencePairs:1,
      terminalImageMarker:true,
      identicalVisibleNonWhitespace:true,
      restoredFromUniqueNativeSource:true
     };
    }
   }
  }
 }
 // V0.8.41: a verified timed HUD can coexist with a notification prefix,
 // or with a literal event fence on the title line. Use the original source
 // and commit all transformations only after exact segment-by-segment proof.
 let timedCompositeProjection=null;
 const existingComparable=eventPostStatusProjection?.comparableText??
  untimedCombinedProjection?.comparableText??openingQuoteProjection?.comparableText??
  legacyMessageProjection?.comparableText??eventQuoteProjection?.comparableText??text;
 if(!options.opening&&unspaced(existingComparable)!==unspaced(scanned)&&
    parseGameTime(scanned)?.iso&&parseGameTime(scanned)?.iso===parseGameTime(original)?.iso){
  const quoteProof=(native,visible)=>{
   const chars=[...unspaced(visible)];let pos=0,depth=0,omitted=0;
   for(const c of native){
    if(/\s/u.test(c))continue;
    if(pos<chars.length&&c===chars[pos]){pos++;continue}
    if(c==='「'){depth++;omitted++;continue}
    if(c==='」'&&depth>0){depth--;omitted++;continue}
    return null;
   }
   return pos===chars.length&&depth===0?{omitted}:null;
  };
  const hiddenAfter=tail=>{
   const m=tail.match(/^\s*(\{\{([^{}\n]{1,200})\}\})[ \t]*(?=\n|$)\s*/u);
   const label=m?.[2]?.trim();
   if(!label||/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/i.test(label)||
      scanned.includes(m[1]))return null;
   return {body:tail.slice(m[0].length),marker:m[1]};
  };
  const lines=scanned.split('\n');
  const dateIndex=lines.findIndex(line=>/^[｜|│]\s*\d{4}(?:年|[/-])/u.test(line.trim()));
  if(dateIndex>=0){
   const hud=[];
   for(const line of lines.slice(dateIndex)){
    if(!/^[｜|│][\s\S]*[｜|│]$/u.test(line.trim()))break;
    hud.push(line);
   }
   const hudKey=unspaced(hud.join('\n'));
   const prefix=lines.slice(0,dateIndex).join('\n');
   const restLines=lines.slice(dateIndex+hud.length);
   const fence=String.fromCharCode(96).repeat(3);
   let nativePrefix='',nativeHud='',nativeTail='',wrapper='',fenceRemoved=false;
   let visibleBody='',prefixProof=null,renderedHeader='';
   if(hud.length>=2&&parseGameTime(hud.join('\n'))&&
      options.event===true&&options.source==='whif-event-content'&&
      dateIndex===1&&titleKey===unspaced(prefix)&&prefix.endsWith(fence)&&
      restLines[0]?.trim()===fence){
    const lead=original.match(preamble);
    if(lead&&/^\s*below context is an event which has just occurred\./i.test(lead[1])){
     const source=original.slice(lead[0].length),sourceLines=source.split('\n');
     const head=sourceLines[0],close=sourceLines.findIndex((line,i)=>i>0&&line.trim()===fence);
     if(unspaced(head)===unspaced(prefix)&&close===hud.length+1&&
        unspaced(sourceLines.slice(1,close).join('\n'))===hudKey){
      wrapper=lead[0];nativePrefix=head;nativeHud=sourceLines.slice(1,close).join('\n');
      nativeTail=sourceLines.slice(close+1).join('\n');
      visibleBody=restLines.slice(1).join('\n');prefixProof={omitted:0};
      renderedHeader=nativePrefix+'\n'+nativeHud+'\n'+fence;
     }
    }
   }else if(hud.length>=2&&options.event!==true&&options.source==='whif-message-content'&&
      dateIndex>0&&dateIndex<=12&&/^\s*【終端】/u.test(prefix)&&
      statusKey===hudKey&&codeKeys.has(hudKey)){
    const firstFence=/^[ \t]*\x60{3}[ \t]*\n/m.exec(original);
    const nativeBlock=firstFence&&original.slice(firstFence.index).match(statusFence);
    if(nativeBlock&&unspaced(nativeBlock[1])===hudKey){
     nativePrefix=original.slice(0,firstFence.index).trimEnd();
     prefixProof=quoteProof(nativePrefix,prefix);
     nativeHud=nativeBlock[1];nativeTail=original.slice(firstFence.index+nativeBlock[0].length);
     visibleBody=restLines.join('\n');fenceRemoved=true;
     renderedHeader=nativePrefix+'\n\n'+nativeHud;
    }
   }
   const hidden=prefixProof&&hiddenAfter(nativeTail);
   const bodyProof=hidden&&quoteProof(hidden.body,visibleBody);
   if(bodyProof&&prefixProof.omitted+bodyProof.omitted>0){
    const candidate=renderedHeader+'\n\n'+hidden.body;
    const entire=quoteProof(candidate,scanned);
    if(entire&&entire.omitted===prefixProof.omitted+bodyProof.omitted&&
       parseGameTime(candidate)?.iso===parseGameTime(scanned)?.iso){
     markers.length=0;
     if(wrapper)markers.push({kind:'verified-timed-event-leading-context',tokens:1,nonWhitespaceChars:count(wrapper)});
     if(fenceRemoved)markers.push({kind:'verified-timed-notification-status-fence',tokens:2,nonWhitespaceChars:6});
     markers.push({kind:'verified-timed-post-status-template',tokens:1,nonWhitespaceChars:count(hidden.marker)});
     markers.push({kind:'verified-timed-balanced-native-quotes',tokens:entire.omitted,nonWhitespaceChars:entire.omitted});
     text=candidate;
     timedCompositeProjection={comparableText:scanned,omittedQuotePairs:entire.omitted/2,
      prefixQuotePairs:prefixProof.omitted/2,bodyQuotePairs:bodyProof.omitted/2,
      eventFencePreserved:options.event===true,provenEntireText:true};
    }
   }
  }
 }
 // Bounded prefix/HUD combinations. Only try this when previous proofs
 // failed. Preserve the source text and require exact visible correspondence.
 let prefixedHudProjection=null;
 const previousComparable=timedCompositeProjection?.comparableText??eventPostStatusProjection?.comparableText??
  untimedCombinedProjection?.comparableText??openingQuoteProjection?.comparableText??
  legacyMessageProjection?.comparableText??eventQuoteProjection?.comparableText??text;
 if(!options.opening&&unspaced(previousComparable)!==unspaced(scanned)){
  const proof=(source,visible)=>{
   const chars=[...unspaced(visible)];let pos=0,depth=0,omitted=0;
   for(const ch of source){
    if(/\s/u.test(ch))continue;
    if(ch===chars[pos]){pos++;continue}
    if(ch==='「'){depth++;omitted++;continue}
    if(ch==='」'&&depth>0){depth--;omitted++;continue}
    return null;
   }
   return pos===chars.length&&depth===0?{omitted}:null;
  };
  const changes=[];
  const remove=(kind,value,tokens=1)=>changes.push({kind,tokens,nonWhitespaceChars:count(value)});
  const eligible=match=>match&&match[1]?.trim()&&
   !/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/i.test(match[1].trim())&&
   !scanned.includes(match[0].trim());
  const stripEndTemplate=value=>{
   const m=value.match(/(?:^|\n)[ \t]*\{\{([^{}\n]{1,200})\}\}[ \t]*\s*$/u);
   if(!eligible(m))return value;
   remove('verified-prefixed-pre-hud-template',m[0]);
   return value.slice(0,m.index).trimEnd();
  };
  const stripStartTemplate=value=>{
   const m=value.match(/^\s*\{\{([^{}\n]{1,200})\}\}[ \t]*(?=\n|$)\s*/u);
   if(!eligible(m))return value;
   remove('verified-prefixed-post-hud-template',m[0]);
   return value.slice(m[0].length);
  };
  const lines=scanned.split('\n');
  const dateIndex=lines.findIndex(line=>/^[｜|│]\s*\d{4}(?:年|[/-])/u.test(line.trim()));
  const clock=parseGameTime(scanned)?.iso;
  let candidate=null;
  if(dateIndex>0&&dateIndex<48&&clock&&clock===parseGameTime(original)?.iso){
   const hud=[];
   for(const line of lines.slice(dateIndex)){
    if(!/^[｜|│][\s\S]*[｜|│]$/u.test(line.trim()))break;
    hud.push(line);
   }
   const hudKey=unspaced(hud.join('\n'));
   const prefix=lines.slice(0,dateIndex).join('\n');
   const rest=lines.slice(dateIndex+hud.length);
   const fence=String.fromCharCode(96).repeat(3);
   if(hud.length>=3&&parseGameTime(hud.join('\n'))?.iso===clock){
    if(options.event===true&&options.source==='whif-event-content'&&dateIndex===1&&
       titleKey===unspaced(prefix)&&prefix.endsWith(fence)&&rest[0]?.trim()===fence){
     const lead=original.match(preamble);
     if(lead&&/^\s*below context is an event which has just occurred\./i.test(lead[1])){
      const source=original.slice(lead[0].length).split('\n');
      const close=source.findIndex((line,i)=>i>0&&line.trim()===fence);
      if(unspaced(source[0])===unspaced(prefix)&&close===hud.length+1&&
         unspaced(source.slice(1,close).join('\n'))===hudKey){
       remove('verified-prefixed-event-context',lead[0]);
       const tail=stripStartTemplate(source.slice(close+1).join('\n'));
       if(proof(tail,rest.slice(1).join('\n')))
        candidate=source.slice(0,close+1).join('\n')+'\n\n'+tail.trimStart();
      }
     }
    }else if(options.event!==true&&options.source==='whif-message-content'&&
       /^(?:【終端】|【基甫納熱搜】|【7F今日行程】|《[^》\n]+》)(?:\n|$)/u.test(prefix)&&
       statusKey===hudKey&&codeKeys.has(hudKey)){
     const firstFence=/^[ \t]*\x60{3}[ \t]*\n/m.exec(original);
     const block=firstFence&&original.slice(firstFence.index).match(statusFence);
     if(block&&unspaced(block[1])===hudKey){
      const pre=stripEndTemplate(original.slice(0,firstFence.index).trimEnd());
      let tail=stripStartTemplate(original.slice(firstFence.index+block[0].length));
      const img=tail.match(imageMarker);
      if(img&&!imageMarker.test(scanned)){remove('terminal-image-marker',img[0]);tail=tail.replace(imageMarker,'').trimEnd()}
      // At most one context template across the two HUD boundaries.
      if(changes.filter(x=>x.kind.endsWith('-template')).length<=1&&proof(pre,prefix)&&proof(tail,rest.join('\n'))){
       remove('verified-prefixed-status-fence',fence+fence,2);
       candidate=pre+'\n\n'+block[1]+'\n\n'+tail.trimStart();
      }
     }
    }
   }
  }else if(dateIndex<0&&options.verifiedUntimedNative===true&&options.event!==true&&
     options.source==='whif-message-content'&&!clock&&!parseGameTime(original)&&
     !isExplicitUnknownGameTime(scanned)&&!isExplicitUnknownGameTime(original)&&
     /^【終端】\n/u.test(scanned)&&!/(?:^|\n)[ \t]*[｜|│]\s*(?:\d{4}\s*(?:年|[-/])|日期|(?:🕒\s*)?時間|\d{1,2}:\d{2})/u.test(original)){
   const srcLines=original.split('\n');
   const m=srcLines.findIndex(line=>/^[ \t]*\{\{[^{}\n]{1,200}\}\}[ \t]*$/u.test(line));
   const pre=srcLines.slice(0,m).join('\n');
   const template=m>0&&srcLines[m].match(/^[ \t]*\{\{([^{}\n]{1,200})\}\}[ \t]*$/u);
   if(m>0&&m<48&&eligible(template)&&/📨任務通知[：:]/u.test(srcLines[m-1])&&
      unspaced(scanned).startsWith(unspaced(pre))){
    remove('verified-untimed-notification-context',template[0]);
    candidate=pre+'\n'+srcLines.slice(m+1).join('\n');
   }
  }
  if(candidate){
   const all=proof(candidate,scanned);
   if(all&&all.omitted>0&&changes.length&&parseGameTime(candidate)?.iso===clock){
    markers.length=0;markers.push(...changes);
    markers.push({kind:'verified-prefixed-balanced-native-quotes',tokens:all.omitted,nonWhitespaceChars:all.omitted});
    text=candidate;
    prefixedHudProjection={comparableText:scanned,omittedQuotePairs:all.omitted/2,provenEntireText:true,untimed:!clock};
   }
  }
 }
 // Older WHIF replies render the HUD as ordinary text, not a code block.
 // Permit one invisible context token at a HUD boundary and balanced native
 // quotes only after proving all non-whitespace visible characters in order.
 if(!prefixedHudProjection&&!options.opening&&!options.event&&
    options.source==='whif-message-content'&&unspaced(previousComparable)!==unspaced(scanned)){
  const clock=parseGameTime(scanned)?.iso;
  const changes=[];
  const add=(kind,value)=>changes.push({kind,tokens:1,nonWhitespaceChars:count(value)});
  const eligible=m=>m&&m[1].trim()&&!/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/i.test(m[1].trim())&&!scanned.includes(m[0].trim());
  let raw=original;
  const lead=raw.match(preamble);
  if(eligible(lead)){add('bare-hud-leading-template',lead[0]);raw=raw.slice(lead[0].length)}
  const lines=raw.split('\n');
  const hud=[];
  for(const line of lines){
   if(!/^[｜|│][\s\S]*[｜|│]$/u.test(line.trim()))break;
   hud.push(line);
  }
  const rendered=scanned.split('\n');
  const headerShape=items=>items.length>=3&&
   /^[｜|│]\s*\d{4}(?:年|[-/])/u.test(items[0].trim())&&
   /^[｜|│]\s*(?:🕒\s*)?\d{1,2}[：:]\d{2}/u.test(items[1].trim())&&
   /^[｜|│]\s*📍/u.test(items[2].trim());
  if(clock&&clock===parseGameTime(original)?.iso&&hud.length>=4&&hud.length<=20&&
     headerShape(hud)&&headerShape(rendered)&&
     unspaced(hud.slice(0,3).join('\n'))===unspaced(rendered.slice(0,3).join('\n'))&&
     !statusKey&&!codeKeys.size){
   let tail=lines.slice(hud.length).join('\n');
   const post=tail.match(/^\s*\{\{([^{}\n]{1,200})\}\}[ \t]*(?=\n|$)\s*/u);
   if(!changes.length&&eligible(post)){add('bare-hud-post-template',post[0]);tail=tail.slice(post[0].length)}
   const img=tail.match(imageMarker);
   if(img&&!imageMarker.test(scanned)){add('terminal-image-marker',img[0]);tail=tail.replace(imageMarker,'')}
   const candidate=hud.join('\n')+'\n\n'+tail.trimStart();
   const visible=[...unspaced(scanned)];let pos=0,depth=0,omitted=0,ok=true;
   for(const ch of unspaced(candidate)){
    if(ch===visible[pos]){pos++;continue}
    if(ch==='「'){depth++;omitted++;continue}
    if(ch==='」'&&depth>0){depth--;omitted++;continue}
    ok=false;break;
   }
   if(ok&&pos===visible.length&&depth===0&&omitted>0&&parseGameTime(candidate)?.iso===clock){
    markers.length=0;markers.push(...changes,{kind:'bare-hud-balanced-native-quotes',tokens:omitted,nonWhitespaceChars:omitted});
    text=candidate;
    prefixedHudProjection={comparableText:scanned,omittedQuotePairs:omitted/2,provenEntireText:true,bareHud:true};
   }
  }
 }
 // Historic replies can have multiline HUD rows (with their own literal
 // quotes), or a genuinely unclosed opening fence. Do not normalize either
 // shape without exact boundary and full non-whitespace text evidence.
 if(!prefixedHudProjection&&!timedCompositeProjection&&!eventPostStatusProjection&&
    !untimedCombinedProjection&&!openingQuoteProjection&&!legacyMessageProjection&&!eventQuoteProjection&&
    options.source==='whif-message-content'&&!options.event&&!options.opening&&
    unspaced(original)!==unspaced(scanned)){
  const fence=String.fromCharCode(96).repeat(3);
  const sourceLines=original.split('\n'),visibleLines=scanned.split('\n');
  const clock=parseGameTime(scanned)?.iso;
  const templateOK=label=>label.trim()&&
   !/^(?:(?:user|char|character)(?:\s*(?:\||:|=|$))|(?:img|image)\s*:)/iu.test(label.trim());
  const exactHudShape=lines=>lines.length>=4&&
   /^[｜|│]\s*\d{4}(?:年|[-/])/u.test(lines[0].trim())&&
   /^[｜|│]\s*(?:🕒\s*)?\d{1,2}[：:]\d{2}/u.test(lines[1].trim())&&
   /^[｜|│]\s*📍/u.test(lines[2].trim())&&
   lines.slice(3).some(line=>/^[｜|│].*(?:暴走|嚮導)值/u.test(line.trim()));
  // A combined clock/location line is only allowed in the fully proven
  // closed multiline HUD projection, not the weaker unclosed variant.
  const combinedClockLocationHud=lines=>lines.length>=3&&
   /^[｜|│]\s*\d{4}(?:年|[-/])/u.test(lines[0].trim())&&
   /^[｜|│]\s*(?:🕒\s*)?\d{1,2}[：:]\d{2}\s*[｜|│]\s*[^｜|│\n\s][^｜|│\n]*[｜|│]$/u.test(lines[1].trim())&&
   /^[｜|│][^｜|│\n]*(?:暴走|嚮導)值\s*[：:]/u.test(lines[2].trim());
  const quoteProof=(native,dom)=>{
   const visible=[...unspaced(dom)];let pos=0,depth=0,omitted=0;
   for(const ch of unspaced(native)){
    if(ch===visible[pos]){pos++;continue}
    if(ch==='「'){depth++;omitted++;continue}
    if(ch==='」'&&depth>0){depth--;omitted++;continue}
    return null;
   }
   return pos===visible.length&&depth===0?omitted:null;
  };
  const syntaxCount=(original.match(/\{\{[^{}\n]*\}\}/gu)||[]).length;
  const fenceCount=(original.match(/\x60{3}/g)||[]).length;
  let candidate=null,omitted=null,template=null,kind=null;
  if(clock&&clock===parseGameTime(original)?.iso&&syntaxCount===1){
   const header=sourceLines[0].match(/^(《[^》\n]+》[：:])[ \t]*\{\{([^{}\n]{1,200})\}\}[ \t]*$/u);
   if(header&&templateOK(header[2])&&fenceCount===2&&sourceLines[1]===fence&&
      unspaced(visibleLines[0])===unspaced(header[1])&&
      (options.codeBlocks||[]).length===1&&statusKey&&codeKeys.has(statusKey)){
    const close=sourceLines.findIndex((line,i)=>i>1&&line===fence);
    const hud=sourceLines.slice(2,close),hudText=hud.join('\n');
    if(close>2&&(exactHudShape(hud)||combinedClockLocationHud(hud))&&unspaced(hudText)===statusKey){
     let end=1,visibleHud='';
     while(end<visibleLines.length&&visibleHud.length<statusKey.length){
      visibleHud+=unspaced(visibleLines[end++]);
      if(!statusKey.startsWith(visibleHud))break;
     }
     if(visibleHud===statusKey){
      const tail=sourceLines.slice(close+1).join('\n').trimStart();
      omitted=quoteProof(tail,visibleLines.slice(end).join('\n'));
      if(omitted!==null){
       candidate=header[1]+'\n\n'+hudText+'\n\n'+tail;
       template=header[0].slice(header[1].length).trim();
       kind='multiline-hud';
      }
     }
    }
   }
   const lead=sourceLines[0].match(/^\{\{([^{}\n]{1,200})\}\}$/u);
   if(!candidate&&lead&&templateOK(lead[1])&&fenceCount===1&&
      sourceLines[1]===fence&&visibleLines[0]===fence&&!statusKey&&!codeKeys.size&&
      (scanned.match(/\x60{3}/g)||[]).length===1){
    const nativeHud=[],visibleHud=[];
    for(const line of sourceLines.slice(2)){if(!/^[｜|│][\s\S]*[｜|│]$/u.test(line.trim()))break;nativeHud.push(line)}
    for(const line of visibleLines.slice(1)){if(!/^[｜|│][\s\S]*[｜|│]$/u.test(line.trim()))break;visibleHud.push(line)}
    if(exactHudShape(nativeHud)&&unspaced(nativeHud.join('\n'))===unspaced(visibleHud.join('\n'))){
     omitted=quoteProof(sourceLines.slice(2+nativeHud.length).join('\n'),visibleLines.slice(1+visibleHud.length).join('\n'));
     if(omitted!==null){
      candidate=sourceLines.slice(1).join('\n');template=lead[0];kind='unclosed-fence';
     }
    }
   }
  }
  if(candidate&&parseGameTime(candidate)?.iso===clock&&!scanned.includes(template)){
   markers.length=0;
   markers.push({kind:'verified-legacy-hidden-context',tokens:1,nonWhitespaceChars:count(template)});
   if(kind==='multiline-hud')markers.push({kind:'verified-multiline-hud-fences',tokens:2,nonWhitespaceChars:6});
   if(omitted)markers.push({kind:'verified-legacy-boundary-quotes',tokens:omitted,nonWhitespaceChars:omitted});
   text=candidate;
   prefixedHudProjection={comparableText:scanned,omittedQuotePairs:omitted/2,provenEntireText:true,legacyBoundary:kind};
  }
 }
 // A legacy clockless trending panel has its own two-line fenced header,
 // not a dated HUD. Prove the exact leading hidden context and rendered
 // header, leaving every subsequent marker and paragraph untouched.
 if(options.verifiedUntimedNative===true&&options.source==='whif-message-content'&&
    !options.event&&!options.opening&&!parseGameTime(scanned)&&!parseGameTime(original)&&
    !hasHudClockEvidence(scanned)&&!hasHudClockEvidence(original)&&
    !isExplicitUnknownGameTime(scanned)&&!isExplicitUnknownGameTime(original)&&
    !prefixedHudProjection&&unspaced(scanned)!==unspaced(text)){
  const panel=original.match(/^(\{\{系統顯示熱搜介面(?:｜[^{}\n]{1,160})?\}\})[ \t]*\n(?:[ \t]*\n)*\x60{3}[ \t]*\n([｜|│][^｜|│\n]{1,120}・內部網路[｜|│])\n([｜|│]🔥(?:\uFE0F)?熱搜榜・即時更新[｜|│])\n\x60{3}[ \t]*(?=\n|$)/u);
  if(panel&&!scanned.includes(panel[1])){
   const header=panel[2]+'\n'+panel[3];
   const visible=scanned.split('\n');
   const tail=original.slice(panel[0].length);
   const candidate=header+tail;
   if(tail.trim()&&unspaced(visible.slice(0,2).join('\n'))===unspaced(header)&&
      unspaced(candidate)===unspaced(scanned)&&!parseGameTime(candidate)&&
      !hasHudClockEvidence(candidate)){
    markers.length=0;
    markers.push({kind:'verified-untimed-trending-context',tokens:1,nonWhitespaceChars:count(panel[1])},
     {kind:'verified-untimed-trending-header-fences',tokens:2,nonWhitespaceChars:6});
    text=candidate;
    prefixedHudProjection={comparableText:scanned,omittedQuotePairs:0,provenEntireText:true,untimed:true,legacyBoundary:'untimed-trending-header'};
   }
  }
 }
 // A rendered news panel followed by a separately fenced HUD has a
 // distinct proof contract: generic projections cannot erase its wrappers.
 const dualNewsCandidate=!options.opening&&!options.event&&
  options.source==='whif-message-content'&&/^【基甫納熱搜】(?:\n|$)/u.test(scanned)&&
  /^\x60{3}[^\n]*\n【基甫納熱搜】(?:\n|$)/u.test(original)&&
  (original.match(/^\x60{3}[^\n]*$/gm)||[]).length>=3&&hasHudClockEvidence(original);
 let dualNewsProven=false;
 if(dualNewsCandidate&&(options.codeBlocks||[]).length===2){
  const clock=parseGameTime(scanned)?.iso;
  const first=original.match(statusFence);
  if(clock&&clock===parseGameTime(original)?.iso&&first&&
     /^\x60{3}[ \t]*\n/u.test(original)&&/^【基甫納熱搜】(?:\n|$)/u.test(first[1])){
   const mid=original.slice(first[0].length).match(/^\s*(\{\{([^{}\n]{1,200})\}\})[ \t]*\n\s*/u);
   if(mid&&!/^(?:user|char|character|img|image)(?:\s*[:|=}]|\s*$)/iu.test(mid[2].trim())&&
      !scanned.includes(mid[1])){
    const rest=original.slice(first[0].length+mid[0].length),second=rest.match(statusFence);
    const newsKey=unspaced(first[1]);
    const lines=scanned.split('\n');
    const dateIndex=lines.findIndex(line=>/^[｜|│]\s*\d{4}(?:年|[-/])/u.test(line.trim()));
    if(second&&/^\x60{3}[ \t]*\n/u.test(rest)&&statusKey&&unspaced(second[1])===statusKey&&
       unspaced(options.codeBlocks[0])===newsKey&&unspaced(options.codeBlocks[1])===statusKey&&
       dateIndex>0&&unspaced(lines.slice(0,dateIndex).join('\n'))===newsKey&&
       structuredNewsPrefix(lines.slice(0,dateIndex).join('\n'))&&
       parseGameTime(second[1])?.iso===clock){
     const candidate=first[1]+'\n\n'+second[1]+'\n\n'+rest.slice(second[0].length).trimStart();
     if(unspaced(candidate)===unspaced(scanned)&&parseGameTime(candidate)?.iso===clock){
      markers.length=0;
      markers.push({kind:'verified-dual-news-hud-fences',tokens:4,nonWhitespaceChars:12},
       {kind:'verified-dual-news-hud-context',tokens:1,nonWhitespaceChars:count(mid[1])});
      text=candidate;
      dualNewsProven=true;
      prefixedHudProjection={comparableText:scanned,omittedQuotePairs:0,provenEntireText:true,legacyBoundary:'dual-fenced-news-hud'};
     }
    }
   }
  }
 }
 const comparableText=prefixedHudProjection?.comparableText??timedCompositeProjection?.comparableText??eventPostStatusProjection?.comparableText??
  (untimedCombinedProjection?.comparableText??
  (openingQuoteProjection?.comparableText??
   (legacyMessageProjection?.comparableText??(eventQuoteProjection?eventQuoteProjection.comparableText:text))));
 const scanChars=[...unspaced(scanned)],nativeChars=[...unspaced(comparableText)];
 const whitespaceOnlyEqual=unspaced(scanned)===unspaced(original);
 const contentEqual=(!dualNewsCandidate||dualNewsProven)&&scanChars.join('')===nativeChars.join('');
 const clock=parseGameTime(scanned)?.iso;
 const nativeClock=parseGameTime(text)?.iso;
 // An ordinary AI reply may have an explicitly unknown date and time. Both
 // source and rendered text must contain the same leading unknown-clock HUD;
 // no other missing-clock reply can pass the native paragraph audit.
 const explicitUnknownClock=!clock&&!nativeClock&&
  !hasHudClockEvidence(scanned)&&!hasHudClockEvidence(original)&&
  isExplicitUnknownGameTime(scanned)&&isExplicitUnknownGameTime(text);
 const verifiedNoClock=options.verifiedUntimedNative===true&&!clock&&!nativeClock&&
  !hasHudClockEvidence(scanned)&&!hasHudClockEvidence(original)&&!hasHudClockEvidence(text)&&
  !isExplicitUnknownGameTime(scanned)&&!isExplicitUnknownGameTime(text);
 const clockEqual=options.opening
  ?(isAllowedOpeningRow({role:'ai',text:scanned})&&clock===nativeClock)
  :options.event
   ?(clock===nativeClock&&(Boolean(clock)||(!clock&&!nativeClock&&!hasHudClockEvidence(scanned)&&!hasHudClockEvidence(original))))
   :Boolean(clock&&clock===nativeClock)||explicitUnknownClock||verifiedNoClock;
 const statusCompact=unspaced(statusText);
 const positions=[...text.matchAll(/(\S)(\s*)/gu)];
 const statusPrefix=options.event&&titleKey&&unspaced(text).startsWith(titleKey+statusCompact)
  ?titleKey+statusCompact:statusCompact;
 const bodyStart=statusCompact&&unspaced(text).startsWith(statusPrefix)?count(statusPrefix):0;
 const bodyOffset=bodyStart?positions[bodyStart]?.index:undefined;
 const comparison={scannedLength:[...scanned].length,nativeLength:[...nativeCopy].length,
  scannedNonWhitespace:scanChars.length,nativeNonWhitespace:count(original),
  comparableNativeNonWhitespace:nativeChars.length,whitespaceOnlyEqual,contentEqual,clockEqual,
  preambleMetadata,verifiedNoClock,untimedWrappedProjection,
  eventPostStatusProjection:eventPostStatusProjection?{
   ...eventPostStatusProjection,comparableText:undefined}:null,
  untimedCombinedProjection:
   untimedCombinedProjection?{...untimedCombinedProjection,comparableText:undefined}:null,
  formatMarkers:markers,formatMarkerCount:markers.reduce((sum,m)=>sum+m.tokens,0),
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
  if(legacyProjectionTrace)comparison.legacyProjectionTrace=legacyProjectionTrace;
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
 if(prefixedHudProjection){
  comparison.prefixedHudProjection={...prefixedHudProjection,comparableText:undefined};
  return {text,comparison};
 }
 if(timedCompositeProjection){
  comparison.timedCompositeProjection={...timedCompositeProjection,comparableText:undefined};
  return {text,comparison};
 }
 if(eventPostStatusProjection){
  comparison.eventPostStatusProjection={
   templateStartUtf16:eventPostStatusProjection.templateStartUtf16,
   templateNonWhitespaceChars:eventPostStatusProjection.templateNonWhitespaceChars,
   omittedQuotePairs:eventPostStatusProjection.omittedQuotePairs,
   preservedVisibleQuotes:eventPostStatusProjection.preservedVisibleQuotes,
   provenEntireEventText:true
  };
  return {text,comparison};
 }
 if(untimedCombinedProjection){
  comparison.untimedCombinedProjection={
   hiddenContextCount:untimedCombinedProjection.hiddenContextCount,
   terminalImageMarker:true,
   omittedQuotePairs:untimedCombinedProjection.omittedQuotePairs,
   preservedVisibleQuotes:untimedCombinedProjection.preservedVisibleQuotes,
   restoredFromUniqueNativeSource:true
  };
  return {text,comparison};
 }
 if(openingQuoteProjection){
  comparison.openingQuoteProjection={
   omittedQuotePairs:openingQuoteProjection.omittedQuotePairs,
   preservedVisibleQuotes:openingQuoteProjection.preservedVisibleQuotes,
   restoredFromNative:true};
  return {text,comparison};
 }
 if(legacyMessageProjection){
  comparison.legacyMessageProjection={
   omittedQuotePairs:legacyMessageProjection.omittedQuotePairs,
   preservedVisibleQuotes:legacyMessageProjection.preservedVisibleQuotes,
   statusRows:legacyMessageProjection.statusRows,restoredFromNative:true};
  return {text,comparison};
 }
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
 if(parseGameTime(restored)?.iso!==clock||(explicitUnknownClock&&!isExplicitUnknownGameTime(restored))){
  comparison.clockEqual=false;
  return {text:null,comparison};
 }
 return {text:restored,comparison};
}
// Only player-origin template text is restored. Never apply this to AI output.
function restorePlayerTemplates(rendered,sources,gapHasMedia=false){
 const visible=String(rendered??'');
 const list=Array.isArray(sources)?sources:[];
 const strip=s=>String(s).replace(/\{\{[^{}]*\}\}/gu,'');
 const norm=s=>String(s).replace(/\s/gu,'');
 const hasTemplate=s=>/\{\{[^{}]*\}\}/u.test(String(s??''));
 if(!list.some(s=>hasTemplate(s.nativeText)))return {ok:true,applied:false,text:visible};
 const ids=list.map(s=>s.id);
 if(gapHasMedia||!list.length||new Set(ids).size!==ids.length||list.some(s=>!s.id||s.sender!=='user'||s.kind!=='ordinary-message'||s.nativeReason!=='available'||s.nativeSender!=='user'||s.nativeMessageId!==s.id||s.hasMedia!==false||typeof s.nativeText!=='string'||!s.nativeText.trim()||/\{\{\s*(?:img|image)\s*:/iu.test(s.nativeText)||/!\[[^\]]*\]\([^)]+\)/u.test(s.nativeText)))
  return {ok:false,reason:'player-template-source-not-proven'};
 const raw=list.map(s=>s.nativeText).join('\n\n');
 if(norm(raw)===norm(visible))return {ok:true,applied:true,text:raw};
 if(norm(strip(raw))!==norm(strip(visible)))return {ok:false,reason:'player-template-visible-projection-mismatch'};
 // Any already-visible template must occur in native order, not be invented.
 const nativeTemplates=[...raw.matchAll(/\{\{[^{}]*\}\}/gu)].map(m=>norm(m[0]));
 let cursor=0;
 for(const m of visible.matchAll(/\{\{[^{}]*\}\}/gu)){
  const at=nativeTemplates.indexOf(norm(m[0]),cursor);
  if(at<0)return {ok:false,reason:'player-visible-template-not-in-native-source'};
  cursor=at+1;
 }
 return {ok:true,applied:true,text:raw};
}
function restoreNativeParagraphs(scanned,nativeCopy){return compareNativeParagraphs(scanned,nativeCopy).text}
globalThis.GalArchiveCore={clean,normalizedWorld,parseGameTime,parseRoadClock,roadClockEvidence,isRoadWorld,clockProfile,ROAD_CLOCK_ENCODING,parseAdventureClock,adventureClockEvidence,invalidAdventureDate,verifiedInvalidAdventureReply,isAdventureWorld,worldInText,isEvent,meaningful,isExplicitUnknownGameTime,isAllowedOpeningRow,validate,copyRangeWithLiveStyles,markdownFromDom,compareNativeParagraphs,restoreNativeParagraphs,restorePlayerTemplates,version:'0.10.55'};
})();