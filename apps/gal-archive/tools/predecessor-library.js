#!/usr/bin/env node
'use strict';
// Offline .gab -> private, append-only reading library. No network or Firebase.
const fs=require('node:fs'), p=require('node:path'), crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const ROOT='Gal AI・歷代前輩記憶館';
const INDEX='00・全館索引與共用守則', HAND='04・歷代前輩交接稿', TEA='05・前輩們の茶話會', PEOPLE='06・前輩個人檔案', RAW='99・原始備份';
const WORLDS={sentinel:['01・全員精神穩定，感情除外','《全員精神穩定，感情除外》'],adventure:['02・身為冒險者就可以這樣那樣','《身為冒險者就可以這樣那樣》'],road:['03・公路求生','🔞公路求生－我是求生者！🔞']};
const TOP=[INDEX,...Object.values(WORLDS).map(x=>x[0]),HAND,TEA,PEOPLE,RAW];
const MAGIC='GAL-ARCHIVE-COMPLETE-V1\n', HM='GAL-ARCHIVE-HANDOVER-V3\n';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const utf=s=>Buffer.from(s,'utf8');
const json=x=>utf(JSON.stringify(x,null,2)+'\n');
const assert=(v,m)=>{if(!v)throw Error(m)};
const text=x=>typeof x==='string'?x:'';
const list=(x,label)=>{assert(x===undefined||Array.isArray(x),label+'不是陣列');return x||[]};
const id=x=>{assert(typeof x==='string'&&x.length>0&&x.length<=500,'來源 ID 無效');return x};
const part=x=>{let s=String(x??'').replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').replace(/[. ]+$/u,'').trim().slice(0,32);if(!s||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s))s='資料_'+s;return s};
const key=x=>sha(utf(id(x))).slice(0,20);
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const date=x=>{assert(typeof x==='string'&&Number.isFinite(Date.parse(x)),'備份時間無效');return new Date(x).toISOString()};
function header(b,magic,max){
 const m=utf(magic);assert(b.subarray(0,m.length).equals(m),'備份 magic 不符');
 const digits=b.subarray(m.length,m.length+12).toString('ascii');assert(/^\d{12}$/.test(digits),'標頭長度無效');
 const len=Number(digits),start=m.length+12+len;
 assert(len>0&&len<=max&&start<=b.length,'標頭截斷或超限');
 return {meta:JSON.parse(decode(b.subarray(m.length+12,start))),body:b.subarray(start)};
}
function unique(rows,label){const s=new Set();for(const x of rows){assert(x&&typeof x==='object',label+'格式無效');const k=id(x.id);assert(!s.has(k),label+' ID 重複');s.add(k)}return s}
function parseGab(b){
 const {meta,body}=header(b,MAGIC,1024*1024);
 assert(meta.format==='gal-ai-archive-complete'&&meta.version===1&&Array.isArray(meta.segments)&&meta.segments.length,'完整備份版本不符');
 let at=0,archive=null;const handovers=[],worldIds=new Set();
 for(const [i,s] of meta.segments.entries()){
  assert(s.offset===at&&Number.isSafeInteger(s.bytes)&&s.bytes>0&&at+s.bytes<=body.length,'備份分段不連續或截斷');
  const bytes=body.subarray(at,at+s.bytes);at+=s.bytes;
  if(i===0){assert(s.kind==='archive','第一段不是輪迴資料');archive=JSON.parse(decode(bytes));assert(archive.format==='gal-ai-archive'&&archive.version===8&&Array.isArray(archive.worlds)&&Array.isArray(archive.cycles),'輪迴資料格式不符');unique(archive.worlds,'世界觀');unique(archive.cycles,'輪迴');continue}
  assert(s.kind==='handover'&&!worldIds.has(id(s.worldId)),'交接分段世界觀重複或類型錯誤');worldIds.add(s.worldId);
  const h=header(bytes,HM,10*1024*1024),m=h.meta;
  assert(m.format==='gal-ai-handover-backup'&&[3,4].includes(m.version)&&m.worldId===s.worldId&&Array.isArray(m.conversations),'交接稿世界觀／版本不符');
  const tids=new Set(),eids=new Set(),files=new Map(),ranges=[];
  for(const c of m.conversations){
   assert(c.thread?.worldId===m.worldId&&!tids.has(id(c.thread.id))&&Array.isArray(c.entries),'交接對話歸屬或 ID 錯誤');tids.add(c.thread.id);
   for(const e of c.entries){
    assert(!eids.has(id(e.id)),'交接內容 ID 重複');eids.add(e.id);
    assert(['file','note','review','self-review'].includes(e.kind),'未知交接內容類型，禁止靜默略過');
    if(e.kind==='file'){
     const off=e.byteOffset,len=e.byteLength;
     assert(Number.isSafeInteger(off)&&Number.isSafeInteger(len)&&off>=0&&len>=0&&off+len<=h.body.length&&len===e.size,'附件大小或位置不符');
     ranges.push([off,len]);files.set(e.id,h.body.subarray(off,off+len));
    }
   }
  }
  let cursor=0;for(const [off,len] of ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){assert(off===cursor,'附件分段重疊或缺漏');cursor+=len}assert(cursor===h.body.length,'交接附件有未索引位元組');
  const reviews=list(m.worldReviews,'共用評語');for(const e of reviews){assert(e.kind==='review'&&!eids.has(id(e.id)),'共用評語 ID 或類型不符');eids.add(e.id)}
  assert(s.threads===m.conversations.length&&s.files===files.size,'交接分段數量不符');
  handovers.push({manifest:m,files});
 }
 assert(at===body.length,'備份尾端有未索引內容');return {archive,handovers,at:date(archive.exportedAt||meta.createdAt)};
}
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
function writeVolumes(add,dir,label,items,heading,limit=32000){
 let buffer='',first=1,volume=1;
 const flush=end=>{if(!buffer)return;add(dir+'/'+label+'/'+String(volume++).padStart(3,'0')+'_'+String(first).padStart(5,'0')+'-'+String(end).padStart(5,'0')+'.txt',utf(heading+'\n本卷原始陣列索引（1 起算）：'+first+'–'+end+'\n\n'+buffer));buffer=''};
 items.forEach((s,i)=>{if(buffer&&buffer.length+s.length>limit){flush(i);first=i+1}buffer+=s});flush(items.length);
 if(!items.length)add(dir+'/'+label+'/000_尚無資料.txt',utf(heading+'\n來源未收錄此類資料。\n'));
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
function plan(b){
 const parsed=parseGab(b), {archive,handovers,at}=parsed, digest=sha(b),files=new Map(),people=new Map(),cycles=[],threads=[],worlds=[];
 const add=(name,data)=>{assert(!files.has(name),'匯出路徑重複：'+name);files.set(name,Buffer.isBuffer(data)?data:utf(data))};
 const byWorld=new Map(archive.worlds.map(w=>[w.id,w]));
 for(const c of archive.cycles)id(c.world);
 const worldIds=new Set([...byWorld.keys(),...archive.cycles.map(c=>c.world),...handovers.map(h=>h.manifest.worldId)]);
 const info=w=>{const d=byWorld.get(w);return {name:text(d?.name)||WORLDS[w]?.[1]||'未命名世界觀 '+w,folder:WORLDS[w]?.[0]||'其他世界觀・'+key(w)}};
 const linkPerson=(n,link,relation)=>{if(typeof n!=='string'||!n.trim())return;const a=people.get(n)||[];a.push({relation,...link});people.set(n,a)};
 for(const w of worldIds){
  const {name,folder}=info(w),doc=byWorld.get(w);
  const content=doc?json(doc):json({id:w,sourceMissing:true});
  const dir=folder+'/世界觀版本-'+sha(content).slice(0,20);
  add(dir+'/世界觀原始資料.json',content);add(dir+'/世界觀設定.txt',utf(name+'\n\n'+(text(doc?.text)||'來源尚未填寫共用設定。')));
  worlds.push({id:w,name,path:dir,sourcePresent:!!doc});
 }
 for(const c of archive.cycles){
  const {name,folder}=info(c.world),raw=json(c),version=sha(raw),dir=folder+'/輪迴-'+key(c.id)+'/版本-'+version.slice(0,20);
  const title=text(c.title)||'未命名輪迴',managers=Array.isArray(c.managerNames)&&c.managerNames.length?c.managerNames:[c.manager].filter(Boolean);
  const msgs=list(c.messages,'完整對話'),events=list(c.events,'事件簿'),pilot=list(c.pilotMessages,'副駕駛聊天');
  for(const [a,k] of [[msgs,'正史訊息'],[events,'事件'],[pilot,'副駕駛']]){const seen=new Set();for(const x of a){assert(x&&typeof x==='object',k+'格式錯誤');if(x.id!=null){assert(!seen.has(id(x.id)),k+'ID 重複');seen.add(x.id)}}}
  const meta={worldId:c.world,cycleId:c.id,title,hero:text(c.hero),managers,updatedAt:c.updatedAt??null,path:dir,revisionSha256:version,messages:msgs.length,events:events.length,accepted:events.filter(e=>e.status==='accepted').length,pilot:pilot.length};
  cycles.push(meta);
  managers.forEach(n=>linkPerson(n,{worldId:c.world,title,path:dir,cycleId:c.id},'檔案館標記的輪迴管理者（不是完整前後輩身分證明）'));
  add(dir+'/01・輪迴原始資料.json',raw);
  const head=name+'｜'+title+'｜輪迴 ID '+c.id;
  writeVolumes(add,dir,'02・完整劇情原始對話',msgs.map((m,i)=>block(m,i,'story')),head+'｜messages 陣列原序（事件另見事件簿）');
  writeVolumes(add,dir,'03・副駕駛聊天',pilot.map((m,i)=>block(m,i,'pilot')),head+'｜非 Gal AI 正史');
  writeVolumes(add,dir,'06・事件簿',events.map((m,i)=>block(m,i,'event')),head+'｜全部狀態，不等於全部已接取');
  const tl=timeline(c);
  writeVolumes(add,dir,'02b・已證明定位的劇情閱讀順序',tl.out,head+'｜只按明確 storyPlacement 插入已接事件；未定位事件見索引，不推測時間或位置');
  add(dir+'/04・角色與人格設定.txt',utf('【主角】\n'+text(c.hero)+'\n【重要角色】\n'+text(c.partner)+'\n【此輪開場】\n'+text(c.opening)+'\n【舊版輪迴專屬設定】\n'+text(c.lore)+'\n【人格設定】\n'+text(c.personality)+'\n【補充筆記】\n'+(Array.isArray(c.noteSections)?c.noteSections.map(n=>text(n.title)+'\n'+text(n.text)).join('\n\n'):text(c.notes))));
  add(dir+'/05・彩蛋.txt',utf(text(c.easterEggs)||'來源尚未填寫。'));
  for(const [k,label] of [['quizLogs','07a・10題'],['changeLogs','07b・修改紀錄']])writeVolumes(add,dir,label,list(c[k],label).map((m,i)=>block(m,i,k)),head+'｜非正史');
  const extras=(k,fields)=>list(c[k],k).filter(x=>!x.deleted).map(x=>fields.map(f=>f+'：'+text(x[f])).join('\n')).join('\n\n')||'來源尚未填寫。';
  add(dir+'/08・GPT評語與總結.txt',utf(extras('gptEvaluations',['author','review','summary'])));
  add(dir+'/09・角色關係圖鑑.txt',utf(extras('characterRelations',['from','to','relation','phase','description','evidence','sourceId'])));
  add(dir+'/00・閱讀索引.md',utf('# '+head+'\n\n來源：輪迴檔案館完整備份。此為閱讀副本，不能代替原生掃描驗收。\n\n'+JSON.stringify(meta,null,2)+'\n\n未確定插入位置的已接事件（事件簿原始索引）：'+(tl.unplaced.join('、')||'無')+'。\n原始 JSON 保留所有欄位、附圖與被隱藏的玩家模板；各分卷不重排原始陣列、不截斷單則訊息。\n'));
 }
 for(const h of handovers){
  const m=h.manifest,w=m.worldId,{name}=info(w),base=HAND+'/世界觀-'+key(w);
  const reviews=list(m.worldReviews,'共用評語'),rr=json(reviews),rd=base+'/共用評語-'+sha(rr).slice(0,20);
  add(rd+'/大家的評語.json',rr);add(rd+'/大家的評語.txt',utf(name+'\n'+reviews.map(e=>'【'+text(e.reviewer)+'｜'+text(e.subject)+'｜'+text(e.title)+'】\n'+text(e.text)).join('\n\n')));
  for(const c of m.conversations){
   const {thread,entries}=c,attachments=entries.filter(e=>e.kind==='file').map(e=>({id:e.id,sha256:sha(h.files.get(e.id)),bytes:e.byteLength}));
   // Offsets are relative to the enclosing .ghb; exclude them from the revision
   // key so a different attachment order in another thread cannot create duplicates.
   const normalized=entries.map(({byteOffset,...e})=>e),raw=json({worldId:w,thread,entries:normalized,attachments});
   const dir=base+'/交接-'+key(thread.id)+'/版本-'+sha(raw).slice(0,20);
   add(dir+'/交接稿原始資料.json',raw);
   const rows=entries.filter(e=>e.kind!=='file');
   writeVolumes(add,dir,'文字與評語',rows.map(e=>'【'+e.kind+'｜'+text(e.reviewer)+'｜'+text(e.subject)+'｜'+text(e.title)+'｜ID '+e.id+'】\n'+text(e.text)+'\n\n'),name+'｜'+text(thread.title)+'｜非正史');
   for(const e of entries.filter(e=>e.kind==='file'))add(dir+'/附件/'+key(e.id)+'_'+part(e.name),h.files.get(e.id));
   const ref={worldId:w,id:thread.id,title:text(thread.title),author:text(thread.author),path:dir,files:attachments.length,reviewsPath:rd};
   threads.push(ref);linkPerson(thread.author,ref,'交接稿明確撰寫者');
  }
  // An empty world can still contain shared reviews.
  worlds.find(x=>x.id===w).sharedReviews=rd;
 }
 for(const [name,refs] of people){
  const dir=PEOPLE+'/自動索引-'+digest.slice(0,20),file=dir+'/'+part(name)+'-'+key(name)+'.md';
  add(file,utf('# '+name+'\n\n僅列原檔明確記載的關聯，並非經確認的身分或前後輩關係。手動名冊以使用者資料為準。\n\n'+refs.map(x=>'- '+x.relation+'｜'+x.title+'｜'+x.worldId+'\n  '+x.path).join('\n')+'\n'));
 }
 const meta={format:'gal-predecessor-library',version:1,sourceSha256:digest,sourceExportedAt:at,worlds,cycles,threads,people:[...people.keys()],rawPath:RAW+'/'+digest+'.gab'};
 add(meta.rawPath,b);
 const idx=INDEX+'/批次索引/'+digest;
 const lines=['# 前輩記憶館・本次完整備份索引','','來源時間：'+at,'來源 SHA-256：'+digest,'世界觀：'+worlds.length+'｜輪迴：'+cycles.length+'｜交接對話：'+threads.length,'','## 世界觀',...worlds.map(w=>'- '+w.name+'｜'+w.path+(w.sharedReviews?'｜共用評語 '+w.sharedReviews:'')),'','## 輪迴',...cycles.map(c=>'- '+c.worldId+'｜'+c.title+'｜'+c.hero+'｜'+c.messages+'則對話／'+c.accepted+'已接事件／'+c.pilot+'副駕駛｜'+c.path),'','## 交接稿',...threads.map(t=>'- '+t.worldId+'｜'+t.title+'｜'+t.author+'｜'+t.path),'','個人索引：'+PEOPLE+'/自動索引-'+digest.slice(0,20),'原始備份：'+meta.rawPath,'','以上僅為目前備份中存在的資料；茶話會、未歸檔聊天、前後輩關係及稱號需由使用者提供，不自行猜測。'];
 const inventory=[...files].map(([path,b])=>({path,bytes:b.length,sha256:sha(b)}));
 add(idx+'.json',json({...meta,inventory}));const indexText=utf(lines.join('\n')+'\n');add(idx+'.md',indexText);
 return {meta,files,indexText,idx,inventory};
}
function inside(root,rel){
 assert(!p.isAbsolute(rel)&&!rel.split('/').some(x=>!x||x==='.'||x==='..'),'不安全的匯出路徑');
 let cur=root;for(const x of rel.split('/')){cur=p.join(cur,x);if(fs.existsSync(cur))assert(!fs.lstatSync(cur).isSymbolicLink(),'禁止透過連結寫入：'+rel)}return cur;
}
function checkRoot(root){assert(p.basename(root)===ROOT&&fs.existsSync(root)&&fs.statSync(root).isDirectory(),'請選擇已建立的私人記憶館目錄');assert(!fs.lstatSync(root).isSymbolicLink(),'禁止根目錄連結');for(const t of TOP){const f=inside(root,t);assert(fs.existsSync(f)&&fs.statSync(f).isDirectory(),'缺少已建立的資料夾：'+t)}}
function put(file,bytes){fs.mkdirSync(p.dirname(file),{recursive:true});const tmp=file+'.tmp-'+crypto.randomUUID();try{fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}}
function sync(root,planned,apply=false){
 root=p.resolve(root);checkRoot(root);const latest=inside(root,INDEX+'/最新匯出索引.md');
 const existing=fs.existsSync(latest)?fs.readFileSync(latest):null;
 let newer=true;
 if(existing){
  const s=decode(existing),m=s.match(/^來源 SHA-256：([a-f0-9]{64})$/m),d=s.match(/^來源時間：(.*)$/m);
  assert(m&&d,'最新索引並非本工具生成，禁止覆蓋');
  const prior=inside(root,INDEX+'/批次索引/'+m[1]+'.md');
  assert(fs.existsSync(prior)&&fs.readFileSync(prior).equals(existing),'最新索引遭修改或歷史索引缺失，禁止覆蓋');
  newer=Date.parse(planned.meta.sourceExportedAt)>=Date.parse(date(d[1]));
  if(Date.parse(planned.meta.sourceExportedAt)===Date.parse(date(d[1]))&&m[1]!==planned.meta.sourceSha256)throw Error('同時間不同備份，需人工核對，不覆蓋索引');
 }
 const pending=[];
 for(const [rel,bytes] of planned.files){
  const f=inside(root,rel);
  if(fs.existsSync(f)){assert(fs.statSync(f).isFile()&&sha(fs.readFileSync(f))===sha(bytes),'已存在不同內容，禁止覆蓋：'+rel)}else pending.push([f,bytes]);
 }
 if(apply){
  // Commit immutable files before publishing the latest index. Partial writes
  // remain valid reusable objects; the previous latest index is never advanced.
  for(const [f,bytes] of pending)put(f,bytes);
  for(const [rel,bytes] of planned.files)assert(sha(fs.readFileSync(inside(root,rel)))===sha(bytes),'寫入後核對失敗：'+rel);
  if(newer&&(!existing||!existing.equals(planned.indexText)))put(latest,planned.indexText);
 }
 return {mode:apply?'apply':'dry-run',sourceSha256:planned.meta.sourceSha256,worlds:planned.meta.worlds.length,cycles:planned.meta.cycles.length,threads:planned.meta.threads.length,newFiles:pending.length,unchangedFiles:planned.files.size-pending.length,latest: newer?'current':'older-history-only'};
}
function main(){
 const [input,root,flag,...rest]=process.argv.slice(2);
 assert(input&&root&&!rest.length&&(!flag||flag==='--apply'||flag==='--dry-run'),'用法：node predecessor-library.js <完整.gab> <私人記憶館目錄> [--dry-run|--apply]');
 const file=p.resolve(input),dest=p.resolve(root);
 assert(!file.startsWith(dest+p.sep),'請使用記憶館外的原始備份，避免重新處理自己的輸出');
 assert(fs.statSync(file).isFile(),'來源不是檔案');
 const planned=plan(fs.readFileSync(file));console.log(JSON.stringify(sync(dest,planned,flag==='--apply'),null,2));
}
module.exports={plan,parseGab,sync,ROOT,TOP};
if(require.main===module)try{main()}catch(e){console.error('⛔ '+e.message);process.exitCode=1}
