/* Local browser reading export. No network or database writes. */
(function(root){
'use strict';
const text=x=>typeof x==='string'?x:'';
const assert=(v,m)=>{if(!v)throw Error(m)};
const list=(x,label)=>{assert(x===undefined||Array.isArray(x),label+'不是陣列');return x||[]};
const part=x=>{let s=String(x??'').replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').replace(/[. ]+$/u,'').trim().slice(0,32);if(!s||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s))s='資料_'+s;return s};
const utf=s=>new TextEncoder().encode(s);
function block(m,i,kind){
 const who=kind==='event'?'事件｜'+text(m.status):m.role==='me'?'我（玩家）':m.role==='ai'?(kind==='story'?'Gal AI':text(m.manager)||'未指定副駕駛'):'未確認身分 '+String(m.role??'');
 let s='【原始 '+kind+' #'+(i+1)+'｜'+who+'｜ID '+String(m.id??'未記錄')+'】\n';
 for(const k of ['sourceMessageId','sourceEventId','sourcePartIndex','messageOrder','sourceCreatedAt','gameTime','nativeGameTime','storyPlacement','autoContinue'])if(m[k]!==undefined)s+=k+'：'+JSON.stringify(m[k])+'\n';
 s+=text(m.title)?'標題：'+m.title+'\n':'';
 s+=text(m.text);
 if(Array.isArray(m.images)&&m.images.length)s+='\n【附圖 '+m.images.length+' 張：原始輪迴 JSON 保留原資料】';
 if(Array.isArray(m.nativeImageReferences)&&m.nativeImageReferences.length)s+='\n【原站圖片參照：'+JSON.stringify(m.nativeImageReferences)+'；未擅自下載】';
 return s+'\n\n';
}
const shortWorld=(w,name)=>({sentinel:'哨嚮',adventure:'冒險者',road:'公路求生'}[w]||part(name));
function cycleReadingName(w,name,title,hero){
 const m=title.match(/^第\s*(\d+)\s*(?:輪迴|周目|週目)$/u);
 const cycle=m?'第'+m[1].padStart(2,'0')+'輪迴':part(title);
 return shortWorld(w,name)+'｜'+cycle+(hero?'・'+part(hero):'');
}
const VOLUME_LABELS={'02・完整劇情原始對話':'完整劇情','03・副駕駛聊天':'副駕駛聊天','06・事件簿':'事件簿','02b・已證明定位的劇情閱讀順序':'含事件閱讀版','07a・10題':'10題','07b・修改紀錄':'修改紀錄','文字與評語':'文字與評語'};
function writeVolumes(add,dir,label,items,heading,prefix,limit=32000){
 const addVolume=(suffix,bytes)=>add(dir+'/'+label+'/'+prefix+'｜'+VOLUME_LABELS[label]+'｜'+suffix,bytes,true);
 let buffer='',first=1,volume=1;
 const flush=end=>{if(!buffer)return;addVolume(String(volume++).padStart(3,'0')+'_'+String(first).padStart(5,'0')+'-'+String(end).padStart(5,'0')+'.txt',utf(heading+'\n本卷閱讀序號（1 起算；每則內另標原始陣列索引）：'+first+'–'+end+'\n\n'+buffer));buffer=''};
 items.forEach((s,i)=>{if(buffer&&buffer.length+s.length>limit){flush(i);first=i+1}buffer+=s});flush(items.length);
 if(!items.length)addVolume('000_尚無資料.txt',utf(heading+'\n來源未收錄此類資料。\n'));
}
function timeline(c){
 const ms=list(c.messages,'完整對話'),es=list(c.events,'事件簿'),ids=new Set(ms.map(m=>m.id)),groups=new Map(),unplaced=[];
 for(const [i,e] of es.entries()){
  if(e.status!=='accepted')continue;
  const slot=e.storyPlacement;
  if(!slot||!Object.hasOwn(slot,'beforeId')||(slot.beforeId!==null&&!ids.has(slot.beforeId))){unplaced.push(i+1);continue}
  const arr=groups.get(slot.beforeId)||[];arr.push({e,i});groups.set(slot.beforeId,arr);
 }
 const out=[];
 const append=k=>{for(const x of (groups.get(k)||[]).sort((a,b)=>(Number.isInteger(a.e.storyPlacement.sequence)?a.e.storyPlacement.sequence:a.i)-(Number.isInteger(b.e.storyPlacement.sequence)?b.e.storyPlacement.sequence:b.i)||a.i-b.i))out.push(block(x.e,x.i,'event'))};
 ms.forEach((m,i)=>{append(m.id);out.push(block(m,i,'story'))});append(null);
 return {out,unplaced};
}

function plan(cycles,worlds){
 const files=new Map(),metadata=[],ids=new Set();let bytesTotal=0;
 const add=(name,bytes)=>{assert(!files.has(name),'閱讀檔案路徑重複：'+name);const data=typeof bytes==='string'?utf(bytes):bytes;bytesTotal+=data.length;assert(bytesTotal<=256*1024*1024,'閱讀資料超過256MiB，請縮小匯出範圍');files.set(name,data)};
 for(const c of cycles){
  assert(c&&typeof c.id==='string'&&c.id&&!ids.has(c.id),'輪迴ID缺失或重複');ids.add(c.id);
  const name=worlds.find(w=>w.id===c.world)?.name||c.world||'未命名世界觀';
  const title=text(c.title)||'未命名輪迴',prefix=cycleReadingName(c.world,name,title,text(c.hero));
  const dir=shortWorld(c.world,name)+'/'+prefix.split('｜').slice(1).join('｜')+'_'+encodeURIComponent(c.id);
  const head=name+'｜'+title+'｜輪迴 ID '+c.id;
  const msgs=list(c.messages,'完整對話'),events=list(c.events,'事件簿'),pilot=list(c.pilotMessages,'副駕駛聊天'),tl=timeline(c);
  writeVolumes(add,dir,'02・完整劇情原始對話',msgs.map((m,i)=>block(m,i,'story')),head+'｜messages 陣列原序（事件另見事件簿）',prefix);
  writeVolumes(add,dir,'02b・已證明定位的劇情閱讀順序',tl.out,head+'｜只按明確 storyPlacement 插入已接事件；未定位事件見索引，不推測時間或位置',prefix);
  writeVolumes(add,dir,'03・副駕駛聊天',pilot.map((m,i)=>block(m,i,'pilot')),head+'｜非 Gal AI 正史',prefix);
  writeVolumes(add,dir,'06・事件簿',events.map((m,i)=>block(m,i,'event')),head+'｜全部狀態，不等於全部已接取',prefix);
  for(const [k,label] of [['quizLogs','07a・10題'],['changeLogs','07b・修改紀錄']])writeVolumes(add,dir,label,list(c[k],label).map((m,i)=>block(m,i,k)),head+'｜非正史',prefix);
  metadata.push({worldId:c.world,cycleId:c.id,title,hero:text(c.hero),path:dir,messages:msgs.length,events:events.length,pilot:pilot.length,unplacedAcceptedEventIndexes:tl.unplaced});
 }
 add('00・閱讀索引.json',JSON.stringify({format:'gal-archive-reading-zip',version:1,canonical:false,cycles:metadata,notice:'僅閱讀副本，不含附件原始位元組或交接稿備份；請另存完整.gab。'},null,2)+'\n');
 return files;
}
// ZIP STORE with UTF-8 filenames, standard CRC32, bounded size.
const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes){let n=0xffffffff;for(const x of bytes)n=crcTable[(n^x)&255]^(n>>>8);return (n^0xffffffff)>>>0}
function zip(files){
 assert(files.size>0&&files.size<65535,'閱讀檔案數量超限');
 const locals=[],central=[];let offset=0,centralSize=0;
 for(const [name,data] of files){
  assert(!name.startsWith('/')&&!name.split('/').some(x=>!x||x==='.'||x==='..'),'不安全的閱讀檔案路徑');
  const n=utf(name),size=data.length;assert(n.length<=65535&&offset+size+30+n.length+centralSize+46+n.length+22<=256*1024*1024,'閱讀ZIP超過256MiB，請縮小匯出範圍');
  const crc=crc32(data),local=new Uint8Array(30+n.length),d=new DataView(local.buffer);
  d.setUint32(0,0x04034b50,true);d.setUint16(4,20,true);d.setUint16(6,0x800,true);d.setUint16(12,33,true);d.setUint32(14,crc,true);d.setUint32(18,size,true);d.setUint32(22,size,true);d.setUint16(26,n.length,true);local.set(n,30);
  const c=new Uint8Array(46+n.length),v=new DataView(c.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);v.setUint32(16,crc,true);v.setUint32(20,size,true);v.setUint32(24,size,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);c.set(n,46);
  locals.push(local,data);central.push(c);offset+=local.length+size;centralSize+=c.length;
 }
 const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.size,true);v.setUint16(10,files.size,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
 return new Blob([...locals,...central,end],{type:'application/zip'});
}
const api={cycleReadingName,plan,zip,crc32};
if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchiveReadingExport=api;
})(typeof globalThis!=='undefined'?globalThis:this);
