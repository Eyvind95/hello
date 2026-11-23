(function(){
'use strict';
/* Handover conversations are intentionally separate from canon cycles and Firebase sync.
   Files are stored as Blobs in IndexedDB; never embedded in public GitHub pages. */
const DATABASE='gal-archive-handovers-v1',THREADS='threads',ENTRIES='entries';
const FILE_LIMIT=50*1024*1024,BACKUP_LIMIT=150*1024*1024,IMPORT_LIMIT=210*1024*1024;
const state={db:null,threads:[],activeId:null,renderToken:0,loading:true,busy:false,objectUrls:[]};
const $=id=>document.getElementById(id);
const worldId=()=>window.ArchiveHandoverBridge?.worldId?.()||'';
const worldName=id=>window.ArchiveHandoverBridge?.worldName?.(id)||id;
const uuid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtDate(x){try{return new Date(x).toLocaleString('zh-TW',{hour12:false})}catch{return String(x||'')}}
function fmtSize(n){const bytes=Number(n)||0;return bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':bytes>=1024?(bytes/1024).toFixed(1)+' KB':bytes+' B'}
function fileName(s){return String(s||'交接稿').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,120)}
function message(s){const target=$('handoverStatus');if(target){target.textContent=s;return}alert(s)}
function getDb(){if(state.db)return Promise.resolve(state.db);return new Promise((resolve,reject)=>{
 const req=indexedDB.open(DATABASE,1);
 req.onupgradeneeded=()=>{
  const db=req.result;
  if(!db.objectStoreNames.contains(THREADS))db.createObjectStore(THREADS,{keyPath:'id'});
  if(!db.objectStoreNames.contains(ENTRIES)){
   const es=db.createObjectStore(ENTRIES,{keyPath:'id'});
   es.createIndex('threadId','threadId',{unique:false});
  }
 };
 req.onsuccess=()=>{state.db=req.result;state.db.onversionchange=()=>{state.db.close();state.db=null};resolve(state.db)};
 req.onerror=()=>reject(req.error||Error('無法開啟交接稿資料庫'));
 req.onblocked=()=>reject(Error('資料庫被另一個頁面占用，請關閉其他檔案館分頁再試'));
})}
async function transaction(stores,mode,work){
 const db=await getDb();
 return new Promise((resolve,reject)=>{
  let tx,output;
  try{
   tx=db.transaction(stores,mode);
   output=work(tx);
  }catch(err){if(tx)try{tx.abort()}catch(_){}reject(err);return}
  tx.oncomplete=()=>resolve(output?.result);
  tx.onerror=()=>reject(tx.error||Error('交接稿儲存失敗'));
  tx.onabort=()=>reject(tx.error||Error('交接稿儲存中斷'));
 });
}
function listStore(name){return transaction([name],'readonly',tx=>tx.objectStore(name).getAll())}
function listEntries(id){return transaction([ENTRIES],'readonly',tx=>tx.objectStore(ENTRIES).index('threadId').getAll(id))}
function putThread(thread){return transaction([THREADS],'readwrite',tx=>tx.objectStore(THREADS).put(thread))}
function useThread(id){return state.threads.find(t=>t.id===id)}
function activeThread(w){const t=useThread(state.activeId);return t&&t.worldId===w?t:null}
function isActive(w){return !!activeThread(w)}
function revokeUrls(){for(const url of state.objectUrls)try{URL.revokeObjectURL(url)}catch(_){}state.objectUrls=[]}
async function reloadThreads(){
 state.threads=await listStore(THREADS);
 state.loading=false;
 renderList(worldId());
}
function renderList(w){
 const host=$('handoverThreads');if(!host)return;
 if(state.loading){host.innerHTML='<p class="note">正在讀取交接稿…</p>';return}
 const threads=state.threads.filter(t=>t.worldId===w).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 host.innerHTML=threads.length?threads.map(t=>
  '<button type="button" class="cycle handover-thread'+(state.activeId===t.id?' active':'')+'" data-handover-id="'+escapeHTML(t.id)+'">'+
  '<strong>'+escapeHTML(t.title)+'</strong><span>'+escapeHTML(String(t.fileCount||0)+' 份檔案・'+String(t.noteCount||0)+' 則備註')+'</span></button>'
 ).join(''):'<p class="note">這個世界觀還沒有交接對話。</p>';
}
function viewFooter(){
 return '<p class="note handover-warning">交接稿與附件只存於這台瀏覽器的 IndexedDB，<strong>目前不包含在檔案館原本的「雲端同步／匯出備份」內</strong>。請使用下方「備份此世界觀」，換手機或清除瀏覽器資料前務必下載備份。</p>';
}
function contentHeader(thread){
 return '<div class="sectionhead"><div><div class="sub">交接稿・'+escapeHTML(worldName(thread.worldId))+'</div><h2>'+escapeHTML(thread.title)+'</h2>'+
 '<div class="stat">'+escapeHTML((thread.fileCount||0)+' 份檔案／'+(thread.noteCount||0)+' 則備註')+'</div></div>'+
 '<div class="actions"><button type="button" class="btn small" data-ha-action="rename">✎ 改名稱</button>'+
 '<button type="button" class="btn small" data-ha-action="backup-thread">下載此對話備份</button>'+
 '<button type="button" class="btn small danger" data-ha-action="delete-thread">刪除對話</button></div></div>'+
 (thread.description?'<p class="note">'+escapeHTML(thread.description)+'</p>':'');
}
function entryCard(e){
 const when='<span class="note">'+escapeHTML(fmtDate(e.createdAt))+'</span>';
 if(e.kind==='file'){
  const preview=(String(e.mime||'').startsWith('image/')||String(e.mime||'')==='application/pdf')?
   '<button type="button" class="btn small" data-ha-action="preview" data-ha-id="'+escapeHTML(e.id)+'">查看</button>':'';
  return '<div class="handover-entry"><div class="sectionhead"><strong>📎 '+escapeHTML(e.name||'未命名檔案')+'</strong>'+when+'</div>'+
   '<p class="note">'+escapeHTML(fmtSize(e.size))+'・'+escapeHTML(e.mime||'檔案')+'</p>'+
   '<div class="actions">'+preview+'<button type="button" class="btn small" data-ha-action="download" data-ha-id="'+escapeHTML(e.id)+'">下載檔案</button>'+
   '<button type="button" class="btn small danger" data-ha-action="delete-entry" data-ha-id="'+escapeHTML(e.id)+'">刪除此檔案</button></div></div>';
 }
 return '<div class="handover-entry"><div class="sectionhead"><strong>📝 文字備註</strong>'+when+'</div>'+
  '<div class="handover-note">'+escapeHTML(e.text||'')+'</div><div class="actions">'+
  '<button type="button" class="btn small danger" data-ha-action="delete-entry" data-ha-id="'+escapeHTML(e.id)+'">刪除此備註</button></div></div>';
}
async function renderActive(w){
 const thread=activeThread(w);if(!thread)return false;
 const token=++state.renderToken,host=$('content');if(!host)return true;
 host.innerHTML=contentHeader(thread)+'<p class="note">正在載入交接檔案…</p>';
 try{
  const entries=await listEntries(thread.id);
  if(token!==state.renderToken||!isActive(w))return true;
  entries.sort((a,b)=>(a.order||0)-(b.order||0)||String(a.createdAt).localeCompare(String(b.createdAt)));
  host.innerHTML=contentHeader(thread)+
   '<div class="divider"></div><h3>交接對話內容</h3>'+
   (entries.length?'<div id="handoverEntries">'+entries.map(entryCard).join('')+'</div>':'<p class="note">這份交接對話還沒有檔案或備註。可以一次上傳多份，例如 11 份交接稿。</p>')+
   '<div class="divider"></div><h3>新增交接內容</h3>'+
   '<label for="handoverFiles">上傳檔案（可一次選取多份）</label>'+
   '<input type="file" id="handoverFiles" multiple accept=".pdf,.doc,.docx,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.zip,.odt,.rtf" />'+
   '<p class="note">支援 PDF、Word、文字、JSON、圖片、ZIP 等；單檔最多 50 MB。上傳後可查看 PDF／圖片，其他檔案可下載。上傳只會寫入本機，不會改動任何輪迴正史。</p>'+
   '<button type="button" class="btn primary" data-ha-action="upload">上傳所選檔案</button>'+
   '<label for="handoverNote">新增文字備註（選填）</label>'+
   '<textarea id="handoverNote" placeholder="例如：第 1～11 份的整理順序、交接注意事項…"></textarea>'+
   '<div class="actions topsp"><button type="button" class="btn primary" data-ha-action="note">加入備註</button>'+
   '<button type="button" class="btn" data-ha-action="back">返回輪迴列表</button></div>'+
   '<p class="note" id="handoverStatus" role="status"></p>'+viewFooter();
 }catch(err){if(token===state.renderToken)host.innerHTML=contentHeader(thread)+'<p class="note">⛔ 交接稿讀取失敗：'+escapeHTML(err?.message||err)+'</p>'}
 return true;
}
function openThread(id,scroll=true){
 const t=useThread(id);
 if(!t||t.worldId!==worldId()){message('交接對話不屬於目前世界觀，已停止開啟');return}
 state.activeId=id;
 window.ArchiveHandoverBridge?.rerender?.();
 if(scroll)$('content')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function close(){state.activeId=null;state.renderToken++}
function createModal(){
 const modal=document.createElement('div');modal.className='modalback hidden';modal.id='handoverModal';
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.innerHTML='<div class="modal" style="max-width:620px"><div class="sectionhead"><h2>新增交接對話</h2><button type="button" class="btn small" id="handoverModalClose">關閉</button></div>'+
 '<p class="note" id="handoverModalWorld"></p><label for="handoverTitle">對話名稱 *</label>'+
 '<input id="handoverTitle" maxlength="180" placeholder="例如：耀斑前輩・完整交接稿">'+
 '<label for="handoverDescription">說明（選填）</label><textarea id="handoverDescription" placeholder="例如：第 1 至 11 份交接稿集中存放"></textarea>'+
 '<div class="actions topsp"><button type="button" class="btn primary" id="handoverCreate">儲存交接對話</button></div></div>';
 document.body.append(modal);
 const stop=()=>modal.classList.add('hidden');
 $('handoverModalClose').onclick=stop;
 modal.addEventListener('click',e=>{if(e.target===modal)stop()});
 $('newHandover').onclick=()=>{
  $('handoverModalWorld').textContent='所屬世界觀：'+worldName(worldId())+'（與目前左側選擇一致）';
  $('handoverTitle').value='';$('handoverDescription').value='';
  modal.classList.remove('hidden');$('handoverTitle').focus();
 };
 $('handoverCreate').onclick=()=>doSafe(async()=>{
  const title=$('handoverTitle').value.trim(),w=worldId();
  if(!title||!w)throw Error('請先選擇世界觀並填寫交接對話名稱');
  if(title.length>180)throw Error('名稱超過 180 字');
  const t={id:uuid(),worldId:w,title,description:$('handoverDescription').value.trim().slice(0,3000),
   createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),fileCount:0,noteCount:0};
  await putThread(t);await reloadThreads();stop();openThread(t.id);message('已建立交接對話，現在可一次上傳多份交接稿。');
 });
}
async function addEntries(t,entries){
 if(!entries.length)return;
 const next={...t,updatedAt:new Date().toISOString(),fileCount:(t.fileCount||0)+entries.filter(e=>e.kind==='file').length,
  noteCount:(t.noteCount||0)+entries.filter(e=>e.kind==='note').length};
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  for(const e of entries)tx.objectStore(ENTRIES).put(e);
  tx.objectStore(THREADS).put(next);
 });
 await reloadThreads();renderActive(worldId());
}
async function removeEntry(t,entry){
 const next={...t,updatedAt:new Date().toISOString(),
  fileCount:Math.max(0,(t.fileCount||0)-(entry.kind==='file'?1:0)),
  noteCount:Math.max(0,(t.noteCount||0)-(entry.kind==='note'?1:0))};
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  tx.objectStore(ENTRIES).delete(entry.id);tx.objectStore(THREADS).put(next);
 });
 await reloadThreads();renderActive(worldId());
}
async function removeThread(t){
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  tx.objectStore(THREADS).delete(t.id);
  const store=tx.objectStore(ENTRIES),req=store.index('threadId').openKeyCursor(IDBKeyRange.only(t.id));
  req.onsuccess=()=>{const cur=req.result;if(cur){store.delete(cur.primaryKey);cur.continue()}};
 });
 close();await reloadThreads();window.ArchiveHandoverBridge?.rerender?.();
}
function downloadBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=fileName(name);document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function previewEntry(entry){
 if(!(entry.blob instanceof Blob))throw Error('這筆附件遺失檔案內容，請由備份還原');
 if(!String(entry.mime||'').startsWith('image/')&&entry.mime!=='application/pdf')throw Error('此類型請下載後開啟');
 const previous=$('handoverPreview');
 if(previous)previous.remove();
 const url=URL.createObjectURL(entry.blob);
 const dialog=document.createElement('div');
 dialog.id='handoverPreview';dialog.className='modalback';dialog.setAttribute('role','dialog');
 dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','查看交接稿附件');
 const card=document.createElement('div');card.className='modal';
 card.style.maxWidth='min(1100px,96vw)';card.style.maxHeight='94vh';card.style.width='96vw';
 const heading=document.createElement('div');heading.className='sectionhead';
 const title=document.createElement('strong');title.textContent=entry.name||'交接稿附件';
 const closeButton=document.createElement('button');closeButton.className='btn small';
 closeButton.type='button';closeButton.textContent='關閉預覽';
 heading.append(title,closeButton);card.append(heading);
 const viewer=document.createElement(entry.mime==='application/pdf'?'iframe':'img');
 viewer.src=url;viewer.style.display='block';viewer.style.marginTop='12px';
 viewer.style.width='100%';viewer.style.maxHeight='75vh';
 if(entry.mime==='application/pdf'){
  viewer.title=entry.name||'PDF 交接稿';
  viewer.style.height='72vh';viewer.style.border='0';
 }else{viewer.alt=entry.name||'交接稿圖片';viewer.style.objectFit='contain'}
 card.append(viewer);dialog.append(card);document.body.append(dialog);
 const close=()=>{dialog.remove();URL.revokeObjectURL(url)};
 closeButton.onclick=close;
 dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
}
function binaryToBase64(blob){return new Promise((resolve,reject)=>{
 const fr=new FileReader();fr.onerror=()=>reject(fr.error||Error('檔案備份讀取失敗'));
 fr.onload=()=>{const str=String(fr.result||''),pos=str.indexOf(',');if(pos<0)reject(Error('檔案無法編碼'));else resolve(str.slice(pos+1))};
 fr.readAsDataURL(blob);
})}
async function backupPack(threads){
 const sourceWorld=threads[0]?.worldId||worldId();
 if(threads.some(t=>t.worldId!==sourceWorld))throw Error('不同世界觀的交接稿不能混合備份');
 let total=0;
 const pack=[];
 for(const thread of threads){
  const entries=await listEntries(thread.id),items=[];
  for(const e of entries){
   const item={id:e.id,kind:e.kind,text:e.text||'',name:e.name||'',mime:e.mime||'',size:e.size||0,createdAt:e.createdAt,order:e.order||0};
   if(e.kind==='file'){
    if(!(e.blob instanceof Blob))throw Error('附件「'+e.name+'」已損毀，無法備份');
    total+=e.blob.size;
    if(total>BACKUP_LIMIT)throw Error('這次備份合計超過 150 MB；請分別下載單一交接對話或附件');
    item.base64=await binaryToBase64(e.blob);
   }
   items.push(item);
  }
  pack.push({thread:{...thread},entries:items});
 }
 return {format:'gal-ai-handover-backup',version:1,worldId:sourceWorld,worldName:worldName(sourceWorld),exportedAt:new Date().toISOString(),conversations:pack};
}
async function exportPack(threads,label){
 if(!threads.length)throw Error('目前還沒有可備份的交接對話');
 const doc=await backupPack(threads);
 downloadBlob(new Blob([JSON.stringify(doc)],{type:'application/json'}),'交接稿_'+fileName(label)+'_'+new Date().toISOString().slice(0,10)+'.json');
 message('✅ 交接稿備份已提供下載：'+doc.conversations.length+' 個對話（包含附件原檔）。');
}
function base64ToBlob(b64,mime){
 if(typeof b64!=='string'||b64.length>IMPORT_LIMIT*1.5)throw Error('交接檔案編碼過大');
 const binary=atob(b64),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:mime||'application/octet-stream'});
}
async function importPack(file){
 if(!file||file.size>IMPORT_LIMIT)throw Error('備份檔超過 210 MB');
 const raw=JSON.parse(await file.text()),w=worldId();
 if(raw?.format!=='gal-ai-handover-backup'||raw.version!==1||!Array.isArray(raw.conversations))throw Error('不是有效的交接稿備份 JSON');
 if(raw.worldId!==w)throw Error('交接稿屬於其他世界觀（'+String(raw.worldName||raw.worldId)+'），請先切換到正確的世界觀');
 if(raw.conversations.length>200)throw Error('備份對話數超出安全限制');
 const restored=[];
 for(const group of raw.conversations){
  const old=group?.thread;
  if(!old||old.worldId!==w||typeof old.title!=='string'||!old.title.trim()||!Array.isArray(group.entries)||group.entries.length>2000)throw Error('備份中的世界觀、對話或檔案清單不合法');
  const now=new Date().toISOString(),thread={id:uuid(),worldId:w,title:old.title.trim().slice(0,180),
   description:String(old.description||'').slice(0,3000),createdAt:now,updatedAt:now,fileCount:0,noteCount:0},entries=[];
  for(const item of group.entries){
   if(!item||!['file','note'].includes(item.kind))throw Error('無效交接內容類型');
   const e={id:uuid(),threadId:thread.id,kind:item.kind,createdAt:item.createdAt||now,
    order:Number(item.order)||Date.now()+entries.length};
   if(item.kind==='file'){
    if(typeof item.base64!=='string')throw Error('備份附件缺少內容：'+String(item.name));
    const blob=base64ToBlob(item.base64,String(item.mime||'application/octet-stream'));
    if(blob.size>FILE_LIMIT)throw Error('備份單檔超過 50 MB：'+String(item.name));
    e.name=String(item.name||'未命名檔案').slice(0,250);e.mime=blob.type;e.size=blob.size;e.blob=blob;thread.fileCount++;
   }else{e.text=String(item.text||'').slice(0,100000);thread.noteCount++}
   entries.push(e);
  }
  restored.push({thread,entries});
 }
 // Always import as NEW conversations to avoid overwriting existing files or rounds.
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  for(const g of restored){
   tx.objectStore(THREADS).put(g.thread);
   for(const e of g.entries)tx.objectStore(ENTRIES).put(e);
  }
 });
 await reloadThreads();if(restored.length)openThread(restored[0].thread.id,false);
 message('✅ 已匯入 '+restored.length+' 個交接對話（另建副本，未覆蓋舊對話或正史）。');
}
async function doSafe(fn){
 if(state.busy){message('上一項交接操作仍在執行');return}
 state.busy=true;
 try{await fn()}catch(e){console.error('[交接稿]',e);message('⛔ '+String(e?.message||e))}
 finally{state.busy=false}
}
function bindActions(){
 $('handoverThreads').addEventListener('click',e=>{
  const b=e.target.closest('[data-handover-id]');if(b)openThread(b.dataset.handoverId);
 });
 $('handoverExport').onclick=()=>doSafe(async()=>exportPack(state.threads.filter(t=>t.worldId===worldId()),worldName(worldId())));
 $('handoverImport').onclick=()=>$('handoverImportFile').click();
 $('handoverImportFile').onchange=e=>doSafe(async()=>{const file=e.target.files?.[0];if(file)await importPack(file);e.target.value=''});
 $('content').addEventListener('click',e=>{
  const btn=e.target.closest('[data-ha-action]');if(!btn)return;
  const action=btn.dataset.haAction,entryId=btn.dataset.haId,t=activeThread(worldId());if(!t)return;
  if(action==='back'){close();window.ArchiveHandoverBridge?.rerender?.();return}
  doSafe(async()=>{
   if(action==='upload'){
    const input=$('handoverFiles'),files=Array.from(input?.files||[]);
    if(!files.length)throw Error('請先選擇要上傳的檔案');
    if(files.some(f=>f.size>FILE_LIMIT))throw Error('單檔上限 50 MB，請先拆分過大的檔案');
    const stamp=Date.now(),entries=files.map((f,i)=>({
     id:uuid(),threadId:t.id,kind:'file',name:f.name.slice(0,250),mime:f.type||'application/octet-stream',
     size:f.size,blob:f,createdAt:new Date(stamp+i).toISOString(),order:stamp+i
    }));
    await addEntries(t,entries);message('✅ 已儲存 '+entries.length+' 份交接檔案（本機）');
   }else if(action==='note'){
    const textarea=$('handoverNote'),text=String(textarea?.value||'').trim();
    if(!text)throw Error('請先輸入備註文字');
    if(text.length>100000)throw Error('單則備註最多 100,000 字');
    await addEntries(t,[{id:uuid(),threadId:t.id,kind:'note',text,createdAt:new Date().toISOString(),order:Date.now()}]);
    message('✅ 已加入文字備註');
   }else if(action==='download'||action==='preview'||action==='delete-entry'){
    const entry=(await listEntries(t.id)).find(x=>x.id===entryId);
    if(!entry)throw Error('找不到這筆交接內容，請重新開啟');
    if(action==='download'){if(!(entry.blob instanceof Blob))throw Error('找不到檔案內容');downloadBlob(entry.blob,entry.name)}
    else if(action==='preview')previewEntry(entry);
    else if(confirm('確定要永久刪除這筆'+(entry.kind==='file'?'檔案（含原檔）':'備註')+'？'))await removeEntry(t,entry);
   }else if(action==='rename'){
    const answer=prompt('重新命名這份交接對話：',t.title);
    if(answer===null)return;
    const title=answer.trim();if(!title||title.length>180)throw Error('對話名稱須為 1～180 字');
    await putThread({...t,title,updatedAt:new Date().toISOString()});await reloadThreads();renderActive(worldId());
   }else if(action==='backup-thread')await exportPack([t],t.title);
   else if(action==='delete-thread'){
    if(!confirm('永久刪除「'+t.title+'」及其中所有附件？這些資料目前只存在本機，請先下載對話備份。'))return;
    await removeThread(t);message('已刪除交接對話與其附件。');
   }
  });
 });
}
async function setup(){
 createModal();bindActions();
 try{await reloadThreads()}catch(err){state.loading=false;message('⛔ 無法初始化交接稿：'+String(err?.message||err))}
}
window.ArchiveHandover={renderList,isActive,renderActive,close};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
else setup();
})();