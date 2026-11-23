(()=>{'use strict';
/* 正史版本時光機：只管理獨立 IndexedDB 快照，不修改正史或 Firebase。 */
const DB_NAME='gal-archive-time-machine',STORE='snapshots';
let storeDb=null,comparison=null,snapshots=[];
const el=id=>document.getElementById(id);
function escaped(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function uniqueId(){return globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2);}
function openStore(){if(storeDb)return Promise.resolve(storeDb);return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>{storeDb=req.result;resolve(storeDb)};req.onerror=()=>reject(req.error);});}
async function transact(type,value){const db=await openStore();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,type),store=tx.objectStore(STORE);let req;if(type==='readonly')req=store.getAll();else req=store.put(value);tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error||req?.error);tx.onabort=()=>reject(tx.error||Error('快照交易中斷'));});}
function readCycle(){const r=typeof current==='function'?current():null;if(!r||!r.id)throw Error('請先選擇輪迴');return r;}
async function capture(record,kind,comment=''){
 if(!record?.id)throw Error('快照缺少輪迴 ID');
 const snapshot={id:uniqueId(),cycleId:record.id,world:record.world||'',title:record.title||'',createdAt:new Date().toISOString(),kind,comment:String(comment||'').slice(0,500),cycle:structuredClone(record)};
 await transact('readwrite',snapshot);return snapshot;
}
async function list(cycleId){return (await transact('readonly')).filter(x=>x.cycleId===cycleId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
function stats(c){const messages=Array.isArray(c?.messages)?c.messages:[],events=Array.isArray(c?.events)?c.events:[];return {
 openingChars:String(c?.opening||'').length,messages:messages.length,player:messages.filter(x=>x.role==='me').length,ai:messages.filter(x=>x.role==='ai').length,
 events:events.length,acceptedEvents:events.filter(x=>x.status==='accepted').length,
 pilotMessages:(c?.pilotMessages||[]).length,quizLogs:(c?.quizLogs||[]).length,changeLogs:(c?.changeLogs||[]).length,
 totalStoryChars:messages.reduce((n,x)=>n+String(x.text||'').length,0)};}
function textFeatures(raw){const text=String(raw||'').replace(/\r\n?/g,'\n');return {length:text.length,blankLines:(text.match(/\n[ \t]*\n/g)||[]).length,newlines:(text.match(/\n/g)||[]).length,quotes:(text.match(/「/g)||[]).length,codeFences:(text.match(/`/g)||[]).length,nonWhitespace:text.replace(/\s+/g,'').length};}
function textKey(text){return String(text||'').replace(/\s+/g,'');}
function comparePair(type,oldItem,newItem,indexOld,indexNew,key,issues,changes){
 const oldText=String(oldItem.text||''),newText=String(newItem.text||'');
 const fields=[...new Set([...Object.keys(oldItem),...Object.keys(newItem)])].filter(k=>k!=='text'&&k!=='images'&&k!=='updatedAt'&&JSON.stringify(oldItem[k])!==JSON.stringify(newItem[k]));
 const moved=indexOld!==indexNew;
 if(oldText!==newText||fields.length||moved){
  const before=textFeatures(oldText),after=textFeatures(newText);
  changes.push({type,key,change:'modified',oldPosition:indexOld+1,newPosition:indexNew+1,moved,changedFields:fields,
   textChange:oldText!==newText,whitespaceOnly:textKey(oldText)===textKey(newText),before,after,oldText,newText,
   oldMetadata:Object.fromEntries(fields.map(f=>[f,oldItem[f]??null])),newMetadata:Object.fromEntries(fields.map(f=>[f,newItem[f]??null]))});
  if(moved)issues.push({level:'check',type,key,reason:'排序位置改變',before:indexOld+1,after:indexNew+1});
  if(oldText!==newText){
   if(textKey(oldText)!==textKey(newText))issues.push({level:'high',type,key,reason:'原文實質內容已變動',before:before.length,after:after.length});
   else issues.push({level:'info',type,key,reason:'僅空白或換行格式改變',before:before.blankLines,after:after.blankLines});
   if(before.blankLines>after.blankLines)issues.push({level:'check',type,key,reason:'空白段落減少',before:before.blankLines,after:after.blankLines});
   if(before.quotes>after.quotes)issues.push({level:'check',type,key,reason:'「」引用數下降',before:before.quotes,after:after.quotes});
  }
  if(fields.includes('role')||fields.includes('status')||fields.includes('gameTime'))
   issues.push({level:'high',type,key,reason:'身份／事件接取狀態／時間欄位變更',fields});
 }
}
function compareArray(type,older,newer,issues,changes){
 const aa=Array.isArray(older)?older:[],bb=Array.isArray(newer)?newer:[];
 function makeMap(arr){const map=new Map();arr.forEach((obj,i)=>{let key=String(obj?.id||obj?.sourceMessageId||obj?.sourceId||'index:'+i);if(map.has(key))issues.push({level:'high',type,key,reason:'版本內出現重複來源 ID'});map.set(key,{obj,i});});return map;}
 const a=makeMap(aa),b=makeMap(bb);
 for(const [key,v] of a){if(!b.has(key)){changes.push({type,key,change:'removed',oldPosition:v.i+1,oldRecord:v.obj});issues.push({level:'high',type,key,reason:'舊版本中的紀錄在新版本消失',position:v.i+1});}else{const n=b.get(key);comparePair(type,v.obj,n.obj,v.i,n.i,key,issues,changes);}}
 for(const [key,v] of b)if(!a.has(key))changes.push({type,key,change:'added',newPosition:v.i+1,newRecord:v.obj});
}
function compare(a,b){
 if(a.cycleId!==b.cycleId)throw Error('禁止跨輪迴比較');
 const before=stats(a.cycle),after=stats(b.cycle),issues=[],changes=[];
 for(const [field,label] of [['opening','輪迴開場'],['hero','主角'],['partner','重要角色'],['manager','副駕駛'],['managerNames','副駕駛清單'],['world','世界觀'],['title','輪迴名稱'],['notes','補充筆記'],['noteSections','分區筆記'],['personality','人格設定'],['easterEggs','彩蛋'],['lore','舊版設定']]){
  if(JSON.stringify(a.cycle[field])!==JSON.stringify(b.cycle[field])){
   changes.push({type:'cycle-field',key:field,change:'modified',label,oldValue:a.cycle[field]??null,newValue:b.cycle[field]??null});
   if(field==='opening'&&textKey(a.cycle[field])!==textKey(b.cycle[field]))issues.push({level:'high',type:'opening',reason:'輪迴開場原文發生實質改變'});
   if(field==='world'||field==='title')issues.push({level:'high',type:'cycle',reason:label+'發生變更'});
  }
 }
 compareArray('messages',a.cycle.messages,b.cycle.messages,issues,changes);
 compareArray('events',a.cycle.events,b.cycle.events,issues,changes);
 for(const field of ['pilotMessages','quizLogs','changeLogs'])compareArray(field,a.cycle[field],b.cycle[field],issues,changes);
 if(before.messages>after.messages)issues.push({level:'high',type:'messages',reason:'完整對話總數減少',before:before.messages,after:after.messages});
 if(before.acceptedEvents>after.acceptedEvents)issues.push({level:'high',type:'events',reason:'已接取事件數量減少',before:before.acceptedEvents,after:after.acceptedEvents});
 if(after.messages%2!==0||after.player!==after.ai)issues.push({level:'high',type:'messages',reason:'玩家與 AI 回合數不平衡',after});
 return {format:'gal-ai-time-machine-diff',version:1,generatedAt:new Date().toISOString(),cycleId:a.cycleId,cycleTitle:b.title,
  oldVersion:{id:a.id,kind:a.kind,createdAt:a.createdAt,comment:a.comment},newVersion:{id:b.id,kind:b.kind,createdAt:b.createdAt,comment:b.comment},
  counts:{old:before,new:after},issues,changes,notice:'疑點屬自動篩查，並非已確認錯誤。內含變動的完整原文，請人工核對。'};
}
function download(filename,payload,type='application/json'){const body=typeof payload==='string'?payload:JSON.stringify(payload,null,2);const blob=new Blob([body],{type:type+';charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename.replace(/[\\/:*?"<>|]/g,'_');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function status(text){el('tmStatus').textContent=text;}
function activeSnapshot(id){return snapshots.find(s=>s.id===id);}
function fmtTime(s){return new Date(s).toLocaleString('zh-TW',{hour12:false});}
async function loadUI(){
 const r=readCycle();snapshots=await list(r.id);
 el('tmCycleName').textContent=r.title+'｜'+snapshots.length+' 份本機快照';
 const choices=snapshots.map(s=>'<option value="'+escaped(s.id)+'">'+escaped(fmtTime(s.createdAt)+'｜'+({'before-native':'覆蓋前','after-native':'覆蓋後','manual':'手動','external':'外部匯入'}[s.kind]||s.kind)+'｜'+s.comment)+'</option>').join('');
 el('tmOld').innerHTML='<option value="">選擇較舊的快照</option>'+choices;
 el('tmNew').innerHTML='<option value="live">目前本機正史（即時）</option>'+choices;
 el('tmDownloadSnapshot').disabled=!snapshots.length;
 comparison=null;el('tmDownloadJSON').disabled=true;el('tmDownloadTXT').disabled=true;
 status('目前正史僅存在本機 IndexedDB；快照不會自動上傳 Firebase。請下載快照作異地備份。');
}
function reportText(report){
 const c=report.counts;const lines=['【輪迴檔案館・正史版本時光機差異報告】','輪迴：'+report.cycleTitle,'產生時間：'+report.generatedAt,
 '舊版：'+report.oldVersion.createdAt+' '+report.oldVersion.kind,'新版：'+report.newVersion.createdAt+' '+report.newVersion.kind,'',
 '完整對話：'+c.old.messages+' → '+c.new.messages,'玩家訊息：'+c.old.player+' → '+c.new.player,'AI 訊息：'+c.old.ai+' → '+c.new.ai,
 '事件：'+c.old.events+' → '+c.new.events,'已接事件：'+c.old.acceptedEvents+' → '+c.new.acceptedEvents,'總劇情字元：'+c.old.totalStoryChars+' → '+c.new.totalStoryChars,'',
 '【疑點 '+report.issues.length+' 項】'];
 report.issues.forEach((x,i)=>lines.push((i+1)+'. ['+x.level+'] '+x.type+' '+(x.key||'')+'：'+x.reason));
 lines.push('','【變更 '+report.changes.length+' 項】');
 report.changes.forEach((x,i)=>{
  lines.push('\n━━ 第 '+(i+1)+' 項｜'+x.type+'｜'+x.key+'｜'+x.change+' ━━');
  if(x.changedFields?.length)lines.push('變動欄位：'+x.changedFields.join('、'));
  if(x.oldText!==undefined)lines.push('【舊原文】\n'+x.oldText+'\n【新原文】\n'+x.newText);
  else if(x.change==='removed')lines.push('【消失紀錄】\n'+JSON.stringify(x.oldRecord,null,2));
  else if(x.change==='added')lines.push('【新增紀錄】\n'+JSON.stringify(x.newRecord,null,2));
  else lines.push('舊值：'+JSON.stringify(x.oldValue)+'\n新值：'+JSON.stringify(x.newValue));
 });
 lines.push('',report.notice);return lines.join('\n');
}
function showReport(report){
 const high=report.issues.filter(x=>x.level==='high').length;
 const check=report.issues.filter(x=>x.level==='check').length;
 status('比較完成：'+report.changes.length+' 項變更；'+report.issues.length+' 個疑點（高優先 '+high+'、需核對 '+check+'）。\n'+
 '對話 '+report.counts.old.messages+' → '+report.counts.new.messages+'；已接事件 '+report.counts.old.acceptedEvents+' → '+report.counts.new.acceptedEvents+
 '\n注意：疑點≠已確認錯誤。下載完整 JSON 或 TXT 交給副駕駛逐項判定。');
 el('tmIssues').replaceChildren();
 for(const x of report.issues.slice(0,80)){
  const div=document.createElement('div');div.className='smartitem';div.style.marginTop='5px';div.textContent='['+x.level+'] '+x.type+' '+(x.key||'')+'：'+x.reason;el('tmIssues').append(div);
 }
 if(report.issues.length>80){const p=document.createElement('p');p.textContent='其餘 '+(report.issues.length-80)+' 項請下載完整報告查看';el('tmIssues').append(p);}
 el('tmDownloadJSON').disabled=false;el('tmDownloadTXT').disabled=false;
}
async function safeAction(action){try{await action()}catch(err){console.error('[正史時光機]',err);status('⛔ '+String(err?.message||err));}}
function setup(){
 const modal=document.createElement('div');modal.className='modalback hidden';modal.id='tmModal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.innerHTML='<section class="modal" style="width:min(950px,100%);max-height:94vh"><div class="sectionhead"><h2>⏳ 正史版本時光機</h2><button class="btn" id="tmClose">關閉</button></div>'+
 '<p class="note" id="tmCycleName"></p><p class="note">每次原生正史覆蓋前後，會自動留下完整本機快照。也能手動保存、下載、匯入備份作唯讀比較；不會自行復原、覆蓋或上傳 Firebase。</p>'+
 '<div class="actions topsp"><button class="btn primary" id="tmSave">保存目前輪迴快照</button><button class="btn" id="tmDownloadLive">下載目前完整正史</button><button class="btn" id="tmDownloadSnapshot">下載選定舊版</button></div>'+
 '<div class="actions topsp"><button class="btn" id="tmImport">📂 載入外部快照／檔案館備份（唯讀）</button><input type="file" id="tmFile" accept=".json,application/json" style="display:none"></div>'+
 '<div class="formrow topsp"><div><label>版本 A（舊版）</label><select id="tmOld"></select></div><div><label>版本 B（新版）</label><select id="tmNew"></select></div></div>'+
 '<div class="actions topsp"><button class="btn primary" id="tmCompare">比較兩個版本</button><button class="btn" id="tmDownloadJSON" disabled>下載完整差異診斷 JSON</button><button class="btn" id="tmDownloadTXT" disabled>下載可閱讀的 TXT 報告</button></div>'+
 '<pre id="tmStatus" class="archivepreview" style="max-height:165px;white-space:pre-wrap"></pre><div id="tmIssues" style="max-height:240px;overflow:auto"></div>'+
 '<p class="note">下載的「完整差異診斷 JSON」包含所有增刪改項目的原始內容，可直接交給 ChatGPT 核對。私人正史不會被加入 GitHub 程式碼。</p></section>';
 document.body.append(modal);
 const opener=el('timeMachineOpen');if(!opener)return;
 opener.addEventListener('click',()=>safeAction(async()=>{modal.classList.remove('hidden');await loadUI()}));
 el('tmClose').onclick=()=>modal.classList.add('hidden');
 modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden')});
 el('tmSave').onclick=()=>safeAction(async()=>{const r=readCycle();await capture(r,'manual','手動保存');await loadUI();status('✅ 已保存目前輪迴的完整快照。')});
 el('tmDownloadLive').onclick=()=>safeAction(async()=>{const r=readCycle();download('正史時光機_目前_'+r.title+'.json',{format:'gal-ai-restore-backup',version:1,exportedAt:new Date().toISOString(),cycle:r})});
 el('tmDownloadSnapshot').onclick=()=>safeAction(async()=>{const s=activeSnapshot(el('tmOld').value)||activeSnapshot(el('tmNew').value);if(!s)throw Error('請先在版本 A 或 B 選擇舊版');download('正史時光機_快照_'+s.title+'_'+s.createdAt+'.json',{format:'gal-ai-restore-backup',version:1,exportedAt:new Date().toISOString(),cycle:s.cycle,versionInfo:{id:s.id,createdAt:s.createdAt,kind:s.kind,comment:s.comment}})});
 el('tmImport').onclick=()=>el('tmFile').click();
 el('tmFile').onchange=()=>safeAction(async()=>{
  const file=el('tmFile').files?.[0];if(!file)return;if(file.size>80*1024*1024)throw Error('超過 80MB，請先檢查檔案');const raw=JSON.parse(await file.text()),target=readCycle();let candidate=null;
  if(raw?.format==='gal-ai-restore-backup')candidate=raw.cycle;
  else if(raw?.format==='gal-ai-archive'&&Array.isArray(raw.cycles))candidate=raw.cycles.find(c=>c.id===target.id);
  else if(raw?.format==='gal-ai-time-machine-snapshot')candidate=raw.snapshot?.cycle;
  if(!candidate||candidate.id!==target.id)throw Error('匯入檔案不是同一輪迴的可比較備份');
  await capture(candidate,'external','從 '+file.name+' 匯入');await loadUI();status('✅ 已唯讀匯入此輪迴的版本，沒有修改正史。');
  el('tmFile').value='';
 });
 el('tmCompare').onclick=()=>safeAction(async()=>{
  const a=activeSnapshot(el('tmOld').value);if(!a)throw Error('請先選擇版本 A（舊版）');
  const b=el('tmNew').value==='live'?{id:'live',cycleId:readCycle().id,title:readCycle().title,kind:'live',createdAt:new Date().toISOString(),comment:'目前本機正史',cycle:structuredClone(readCycle())}:activeSnapshot(el('tmNew').value);
  if(!b)throw Error('請選擇版本 B');if(b.id===a.id)throw Error('請選擇不同版本');
  comparison=compare(a,b);showReport(comparison);
 });
 el('tmDownloadJSON').onclick=()=>{if(comparison)download('正史時光機_完整差異_'+comparison.cycleTitle+'.json',comparison)};
 el('tmDownloadTXT').onclick=()=>{if(comparison)download('正史時光機_差異報告_'+comparison.cycleTitle+'.txt',reportText(comparison),'text/plain')};
}
window.ArchiveTimeMachine={
 captureBeforeNative:(r,source)=>capture(r,'before-native','原生正史覆蓋前；來源 '+String(source?.source?.url||'未提供').slice(0,230)),
 captureAfterNative:r=>capture(r,'after-native','原生正史覆蓋完成')
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
