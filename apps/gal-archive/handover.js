(function(){
'use strict';
/* Handover conversations are intentionally separate from canon cycles and Firebase sync.
   Files are stored as Blobs in IndexedDB; never embedded in public GitHub pages. */
const DATABASE='gal-archive-handovers-v1',THREADS='threads',ENTRIES='entries';
const FILE_LIMIT=50*1024*1024,BACKUP_LIMIT=150*1024*1024,IMPORT_LIMIT=210*1024*1024;
const BUNDLE_MAGIC='GAL-ARCHIVE-HANDOVER-V3\n',BUNDLE_LENGTH_DIGITS=12,MAX_METADATA=10*1024*1024,LEGACY_JSON_LIMIT=24*1024*1024;
const state={db:null,threads:[],activeId:null,sharedWorldId:null,view:'files',editingReviewId:null,renderToken:0,loading:true,busy:false,objectUrls:[]};
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
 const req=indexedDB.open(DATABASE,2);
 req.onupgradeneeded=()=>{
  const db=req.result;
  if(!db.objectStoreNames.contains(THREADS))db.createObjectStore(THREADS,{keyPath:'id'});
  const es=db.objectStoreNames.contains(ENTRIES)?
   req.transaction.objectStore(ENTRIES):db.createObjectStore(ENTRIES,{keyPath:'id'});
  if(!es.indexNames.contains('threadId'))es.createIndex('threadId','threadId',{unique:false});
  if(!es.indexNames.contains('kind'))es.createIndex('kind','kind',{unique:false});
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
function sharedReviewId(w){return '__gal-handover-shared-reviews__:'+encodeURIComponent(w)}
function isSharedView(w){return state.sharedWorldId===w&&state.view==='reviews'&&!state.activeId}
async function listWorldReviews(w){
 const allowed=new Set(state.threads.filter(t=>t.worldId===w).map(t=>t.id));
 allowed.add(sharedReviewId(w));
 const all=await transaction([ENTRIES],'readonly',tx=>tx.objectStore(ENTRIES).index('kind').getAll('review'));
 return all.filter(e=>allowed.has(e.threadId));
}
async function findWorldReview(w,id){return (await listWorldReviews(w)).find(e=>e.id===id)||null}
function openSharedReviews(w=worldId()){
 if(!w)return;
 state.activeId=null;state.sharedWorldId=w;state.view='reviews';state.editingReviewId=null;
 window.ArchiveHandoverBridge?.rerender?.();
 $('content')?.scrollIntoView({behavior:'smooth',block:'start'});
}

function activeThread(w){const t=useThread(state.activeId);return t&&t.worldId===w?t:null}
function isActive(w){return !!activeThread(w)||isSharedView(w)}
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
 const commonButton=$('handoverSharedReviews');if(commonButton)commonButton.classList.toggle('active',isSharedView(w));
 host.innerHTML=threads.length?threads.map(t=>
  '<button type="button" class="cycle handover-thread'+(state.activeId===t.id?' active':'')+'" data-handover-id="'+escapeHTML(t.id)+'">'+
  '<strong>'+escapeHTML(t.title)+'</strong><span>'+escapeHTML(String(t.fileCount||0)+' 份檔案・'+String(t.noteCount||0)+' 則備註'+(t.selfReviewCount?'・有自評':''))+'</span></button>'
 ).join(''):'<p class="note">這個世界觀還沒有交接對話。</p>';
}
function viewFooter(){
 return '<p class="note handover-warning">交接稿與附件只存於這台瀏覽器的 IndexedDB，<strong>目前不包含在檔案館原本的「雲端同步／匯出備份」內；請改下載交接稿專用的 .ghb 備份</strong>。請使用下方「備份此世界觀」，換手機或清除瀏覽器資料前務必下載備份。</p>';
}
function contentHeader(thread){
 return '<div class="sectionhead"><div><div class="sub">交接稿・'+escapeHTML(worldName(thread.worldId))+'</div><h2>'+escapeHTML(thread.title)+'</h2>'+
 '<div class="stat">'+escapeHTML((thread.fileCount||0)+' 份檔案／'+(thread.noteCount||0)+' 則備註'+(thread.selfReviewCount?'／已有自評':''))+'</div></div>'+
 '<div class="actions"><button type="button" class="btn small" data-ha-action="rename">✎ 改名稱</button><button type="button" class="btn small" data-ha-action="edit-author">設定撰寫者</button>'+
 '<button type="button" class="btn small" data-ha-action="backup-thread">下載此對話備份</button>'+
 '<button type="button" class="btn small danger" data-ha-action="delete-thread">刪除對話</button></div></div>'+
 (thread.author?'<p class="note">交接稿撰寫者：'+escapeHTML(thread.author)+'</p>':'')+(thread.description?'<p class="note">'+escapeHTML(thread.description)+'</p>':'');
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
function handoverTabBar(){
 return '<div class="tabs" role="tablist" aria-label="交接對話分類">'+
  [['files','📎 交接檔案'],['reviews','💬 大家的評語（共用）'],['self','🪞 對自己的自評']].map(([id,label])=>
   '<button type="button" class="tab '+(state.view===id?'active':'')+'" data-ha-action="switch-view" data-ha-view="'+id+'" aria-selected="'+(state.view===id?'true':'false')+'">'+label+'</button>').join('')+
  '</div>';
}
function reviewCard(entry){
 const by=escapeHTML(entry.reviewer||'未署名'),subject=entry.subject?'・評價對象：'+escapeHTML(entry.subject):'';
 return '<article class="handover-entry"><div class="sectionhead"><strong>💬 '+by+subject+'</strong><span class="note">'+escapeHTML(fmtDate(entry.createdAt))+'</span></div>'+
  (entry.title?'<h3>'+escapeHTML(entry.title)+'</h3>':'')+
  '<details class="handover-review-details"><summary>展開閱讀全文（'+String((entry.text||'').length)+' 字）</summary><div class="handover-note">'+escapeHTML(entry.text||'')+'</div></details>'+
  '<div class="actions"><button type="button" class="btn small" data-ha-action="download-review" data-ha-id="'+escapeHTML(entry.id)+'">下載這篇評語</button>'+
  '<button type="button" class="btn small" data-ha-action="edit-review" data-ha-id="'+escapeHTML(entry.id)+'">編輯</button>'+
  '<button type="button" class="btn small danger" data-ha-action="delete-entry" data-ha-id="'+escapeHTML(entry.id)+'">刪除</button></div></article>';
}
function renderReviewSection(entries){
 const peer=entries.filter(e=>e.kind==='review').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const editing=peer.find(e=>e.id===state.editingReviewId);
 return '<h3>大家的評語</h3>'+
  '<p class="note">此世界觀所有交接對話共用同一份「大家的評語」。每位前輩的完整評論只需貼一次，內文可以同時評價多人，不必拆稿；原本分散儲存的評語也會一起顯示。自評仍各自獨立。</p>'+
  '<div class="actions"><button class="btn small" type="button" data-ha-action="download-reviews">下載全部評語 TXT</button></div>'+
  (peer.length?peer.map(reviewCard).join(''):'<p class="note">目前還沒有其他人的評語。</p>')+
  '<div class="divider"></div><h3>'+(editing?'編輯既有評語':'＋新增別人的評語')+'</h3>'+
  '<label for="handoverReviewer">評語者 *</label><input id="handoverReviewer" maxlength="180" value="'+escapeHTML(editing?.reviewer||'')+'" placeholder="例如：暗夢後輩">'+
  '<label for="handoverReviewSubject">評價對象／範圍（選填）</label><input id="handoverReviewSubject" maxlength="250" value="'+escapeHTML(editing?.subject||'')+'" placeholder="例如：耀斑、赤紅、鐵墓、小貓與暗夢的五份交接稿">'+
  '<label for="handoverReviewTitle">評語標題（選填）</label><input id="handoverReviewTitle" maxlength="200" value="'+escapeHTML(editing?.title||'')+'" placeholder="例如：五代交接稿總評">'+
  '<label for="handoverReviewText">評語原文 *</label><textarea id="handoverReviewText" class="tall" maxlength="100000" placeholder="可一次貼入完整長篇評語，包含分段、換行、優缺點及總評。">'+escapeHTML(editing?.text||'')+'</textarea>'+
  '<div class="actions topsp"><button type="button" class="btn primary" data-ha-action="add-review">'+(editing?'更新評語':'儲存評語')+'</button>'+(editing?'<button type="button" class="btn small" data-ha-action="cancel-review-edit">取消編輯</button>':'')+'</div>';
}
function renderSelfSection(entries,thread){
 const existing=entries.find(e=>e.kind==='self-review');
 return '<h3>對自己的自評</h3>'+
  '<p class="note">這一區專門記錄交接稿撰寫者對自己作品的評價，與「大家的評語」分開。每個交接對話保留一份可編輯的自評；更新時保留原紀錄 ID。</p>'+
  '<label for="handoverSelfAuthor">自評者 *</label><input id="handoverSelfAuthor" maxlength="180" value="'+escapeHTML(existing?.reviewer||thread.author||'')+'" placeholder="例如：耀斑前輩">'+
  '<label for="handoverSelfText">自己的評價 *</label><textarea id="handoverSelfText" class="tall" maxlength="100000" placeholder="自己的優點、缺點、交接理念、反省與未完成部分…">'+escapeHTML(existing?.text||'')+'</textarea>'+
  '<div class="actions topsp"><button class="btn primary" type="button" data-ha-action="save-self">'+(existing?'更新自評':'儲存自評')+'</button>'+
  (existing?'<button class="btn small" type="button" data-ha-action="download-self">下載自評 TXT</button><button class="btn small danger" type="button" data-ha-action="delete-self">刪除自評</button>':'')+'</div>'+
  (existing?'<p class="note">最初保存：'+escapeHTML(fmtDate(existing.createdAt))+'；最後修改：'+escapeHTML(fmtDate(existing.updatedAt||existing.createdAt))+'</p>':'');
}
function renderFilesSection(entries){
 const docs=entries.filter(e=>e.kind==='file'||e.kind==='note');
 return '<h3>交接對話內容</h3>'+
  (docs.length?'<div id="handoverEntries">'+docs.map(entryCard).join('')+'</div>':'<p class="note">這份交接對話還沒有檔案或備註。可以一次上傳多份，例如 11 份交接稿。</p>')+
  '<div class="divider"></div><h3>新增交接內容</h3>'+
  '<label for="handoverFiles">上傳檔案（可一次選取多份）</label>'+
  '<input type="file" id="handoverFiles" multiple accept=".pdf,.doc,.docx,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.zip,.odt,.rtf" />'+
  '<p class="note">支援 PDF、Word、文字、JSON、圖片、ZIP 等；單檔最多 50 MB，依序儲存以減輕手機負擔。上傳後可查看 PDF／圖片，其他檔案可下載。上傳只會寫入本機，不會改動任何輪迴正史。</p>'+
  '<button type="button" class="btn primary" data-ha-action="upload">上傳所選檔案</button>'+
  '<label for="handoverNote">新增文字備註（選填）</label>'+
  '<textarea id="handoverNote" placeholder="例如：第 1～11 份的整理順序、交接注意事項…"></textarea>'+
  '<div class="actions topsp"><button type="button" class="btn primary" data-ha-action="note">加入備註</button></div>';
}
async function renderActive(w){
 const thread=activeThread(w),shared=isSharedView(w);
 if(!thread&&!shared)return false;
 const token=++state.renderToken,host=$('content');
 if(!host)return true;
 host.innerHTML=thread?contentHeader(thread)+'<p class="note">正在載入交接檔案…</p>':'<p class="note">正在讀取共用評語…</p>';
 try{
  const entries=thread?await listEntries(thread.id):[];
  const reviews=state.view==='reviews'?await listWorldReviews(w):null;
  if(token!==state.renderToken||!isActive(w))return true;
  entries.sort((a,b)=>(a.order||0)-(b.order||0)||String(a.createdAt).localeCompare(String(b.createdAt)));
  const body=state.view==='reviews'?renderReviewSection(reviews):state.view==='self'?renderSelfSection(entries,thread):renderFilesSection(entries);
  const commonHeader='<div class="sectionhead"><div><div class="sub">交接稿・'+escapeHTML(worldName(w))+'</div><h2>💬 大家的評語（共用）</h2></div></div>';
  host.innerHTML=(thread?contentHeader(thread)+handoverTabBar():commonHeader)+body+
   '<div class="divider"></div><button type="button" class="btn" data-ha-action="back">返回輪迴列表</button>'+
   '<p class="note" id="handoverStatus" role="status"></p>'+viewFooter();
 }catch(err){
  if(token===state.renderToken)host.innerHTML=(thread?contentHeader(thread):'<h2>大家的評語</h2>')+
   '<p class="note">⛔ 交接稿讀取失敗：'+escapeHTML(err?.message||err)+'</p>';
 }
 return true;
}
function openThread(id,scroll=true){
 const t=useThread(id);
 if(!t||t.worldId!==worldId()){message('交接對話不屬於目前世界觀，已停止開啟');return}
 state.activeId=id;state.sharedWorldId=null;state.view='files';state.editingReviewId=null;
 window.ArchiveHandoverBridge?.rerender?.();
 if(scroll)$('content')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function close(){state.activeId=null;state.sharedWorldId=null;state.view='files';state.editingReviewId=null;state.renderToken++}
function createModal(){
 const modal=document.createElement('div');modal.className='modalback hidden';modal.id='handoverModal';
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.innerHTML='<div class="modal" style="max-width:620px"><div class="sectionhead"><h2>新增交接對話</h2><button type="button" class="btn small" id="handoverModalClose">關閉</button></div>'+
 '<p class="note" id="handoverModalWorld"></p><label for="handoverTitle">對話名稱 *</label>'+
 '<input id="handoverTitle" maxlength="180" placeholder="例如：耀斑前輩・完整交接稿">'+'<label for="handoverAuthor">交接稿撰寫者／負責人（選填）</label><input id="handoverAuthor" maxlength="180" placeholder="例如：耀斑前輩">'+
 '<label for="handoverDescription">說明（選填）</label><textarea id="handoverDescription" placeholder="例如：第 1 至 11 份交接稿集中存放"></textarea>'+
 '<div class="actions topsp"><button type="button" class="btn primary" id="handoverCreate">儲存交接對話</button></div></div>';
 document.body.append(modal);
 const stop=()=>modal.classList.add('hidden');
 $('handoverModalClose').onclick=stop;
 modal.addEventListener('click',e=>{if(e.target===modal)stop()});
 $('newHandover').onclick=()=>{
  $('handoverModalWorld').textContent='所屬世界觀：'+worldName(worldId())+'（與目前左側選擇一致）';
  $('handoverTitle').value='';$('handoverAuthor').value='';$('handoverDescription').value='';
  modal.classList.remove('hidden');$('handoverTitle').focus();
 };
 $('handoverCreate').onclick=()=>doSafe(async()=>{
  const title=$('handoverTitle').value.trim(),w=worldId();
  if(!title||!w)throw Error('請先選擇世界觀並填寫交接對話名稱');
  if(title.length>180)throw Error('名稱超過 180 字');
  const t={id:uuid(),worldId:w,title,author:$('handoverAuthor').value.trim().slice(0,180),description:$('handoverDescription').value.trim().slice(0,3000),
   createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),fileCount:0,noteCount:0,reviewCount:0,selfReviewCount:0};
  await putThread(t);await reloadThreads();stop();openThread(t.id);message('已建立交接對話，現在可一次上傳多份交接稿。');
 });
}
async function addEntries(t,entries){
 if(!entries.length)return;
 const next={...t,updatedAt:new Date().toISOString(),fileCount:(t.fileCount||0)+entries.filter(e=>e.kind==='file').length,
  noteCount:(t.noteCount||0)+entries.filter(e=>e.kind==='note').length,
  reviewCount:(t.reviewCount||0)+entries.filter(e=>e.kind==='review').length,
  selfReviewCount:(t.selfReviewCount||0)+entries.filter(e=>e.kind==='self-review').length};
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  for(const e of entries)tx.objectStore(ENTRIES).put(e);
  tx.objectStore(THREADS).put(next);
 });
 await reloadThreads();renderActive(worldId());
}
async function uploadFilesSafely(thread,files){
 if(!files.length)throw Error('請先選擇要上傳的檔案');
 if(files.length>100)throw Error('單次最多選取 100 份附件，請分批上傳');
 if(files.some(file=>file.size>FILE_LIMIT))throw Error('單檔上限 50 MB，請先拆分過大的檔案');
 const totalBytes=files.reduce((n,f)=>n+f.size,0);
 // Advisory only: browser quota estimates can be inaccurate; IDB transaction remains authoritative.
 let estimate=null;
 try{
  if(typeof navigator!=='undefined'&&navigator.storage?.estimate)estimate=await navigator.storage.estimate();
 }catch(_){}
 if(estimate?.quota&&Number.isFinite(estimate.usage)&&estimate.quota-estimate.usage<totalBytes+2*1024*1024)
  throw Error('瀏覽器儲存空間可能不足（剩餘約 '+fmtSize(estimate.quota-estimate.usage)+'），請先下載交接稿備份；不可直接清除網站資料');
 let current=thread,completed=0;
 const stamp=Date.now();
 try{
  for(const file of files){
   message('正在儲存第 '+(completed+1)+'／'+files.length+' 份：'+file.name+'（逐份寫入，不一次讀進記憶體）');
   const entry={id:uuid(),threadId:thread.id,kind:'file',name:String(file.name||'未命名檔案').slice(0,250),
    mime:file.type||'application/octet-stream',size:file.size,blob:file,createdAt:new Date(stamp+completed).toISOString(),order:stamp+completed};
   const next={...current,fileCount:(current.fileCount||0)+1,updatedAt:new Date().toISOString()};
   await transaction([THREADS,ENTRIES],'readwrite',tx=>{
    tx.objectStore(ENTRIES).put(entry);
    tx.objectStore(THREADS).put(next);
   });
   current=next;
   completed++;
  }
 }catch(err){
  const reason=String(err?.message||err);
  throw Error('已成功儲存 '+completed+'／'+files.length+' 份，後續停止。'+
   ((err?.name==='QuotaExceededError'||/quota|space|memory|storage/i.test(reason))?'可能為瀏覽器容量／記憶體不足；請保留現有資料。':'')+
   ' 原因：'+reason);
 }finally{
  await reloadThreads();
  await renderActive(worldId());
 }
 return completed;
}
async function removeEntry(t,entry){
 const next={...t,updatedAt:new Date().toISOString(),
  fileCount:Math.max(0,(t.fileCount||0)-(entry.kind==='file'?1:0)),
  noteCount:Math.max(0,(t.noteCount||0)-(entry.kind==='note'?1:0)),
  reviewCount:Math.max(0,(t.reviewCount||0)-(entry.kind==='review'?1:0)),
  selfReviewCount:Math.max(0,(t.selfReviewCount||0)-(entry.kind==='self-review'?1:0))};
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  tx.objectStore(ENTRIES).delete(entry.id);tx.objectStore(THREADS).put(next);
 });
 await reloadThreads();renderActive(worldId());
}
async function saveReviewRecord(t,entry,overwrite){
 const currentEntries=await listEntries(t.id);
 const previous=overwrite?currentEntries.find(x=>x.id===overwrite&&x.kind===entry.kind):null;
 if(overwrite&&!previous)throw Error('原評語已不存在，請重新載入');
 const finalEntry=previous?{...previous,...entry,id:previous.id,createdAt:previous.createdAt}:entry;
 if(entry.kind==='self-review'&&currentEntries.some(x=>x.kind==='self-review'&&x.id!==finalEntry.id))throw Error('每個交接對話只能有一份自評；請先刪除重複資料');
 const next={...t,updatedAt:new Date().toISOString(),
  reviewCount:(t.reviewCount||0)+(!previous&&entry.kind==='review'?1:0),
  selfReviewCount:entry.kind==='self-review'?1:(t.selfReviewCount||0)};
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  tx.objectStore(ENTRIES).put(finalEntry);
  tx.objectStore(THREADS).put(next);
 });
 await reloadThreads();await renderActive(worldId());
}
async function saveSharedReview(w,entry,overwrite){
 const previous=overwrite?await findWorldReview(w,overwrite):null;
 if(overwrite&&!previous)throw Error('原評語不存在或不屬於目前世界觀');
 const owner=previous?state.threads.find(t=>t.id===previous.threadId&&t.worldId===w):null;
 const next={...previous,...entry,id:previous?.id||entry.id,threadId:sharedReviewId(w),
  createdAt:previous?.createdAt||entry.createdAt,updatedAt:new Date().toISOString()};
 await transaction(owner?[THREADS,ENTRIES]:[ENTRIES],'readwrite',tx=>{
  tx.objectStore(ENTRIES).put(next);
  if(owner)tx.objectStore(THREADS).put({...owner,reviewCount:Math.max(0,(owner.reviewCount||0)-1)});
 });
 await reloadThreads();await renderActive(w);
}
async function deleteWorldReview(w,entry){
 const owner=state.threads.find(t=>t.id===entry.threadId&&t.worldId===w);
 await transaction(owner?[THREADS,ENTRIES]:[ENTRIES],'readwrite',tx=>{
  tx.objectStore(ENTRIES).delete(entry.id);
  if(owner)tx.objectStore(THREADS).put({...owner,reviewCount:Math.max(0,(owner.reviewCount||0)-1)});
 });
 if(state.editingReviewId===entry.id)state.editingReviewId=null;
 await reloadThreads();await renderActive(w);
}
function reviewSignature(e){return JSON.stringify([e.reviewer||'',e.subject||'',e.title||'',e.text||''])}
function commonReviewContext(w){
 return {title:worldName(w)+'・共用評語',author:'世界觀共用，並非單一交接稿撰寫者'};
}
function downloadReviewTxt(e,thread){
 const heading=e.kind==='self-review'?'【自己的自評】':'【大家的評語】';
 const lines=[heading,'交接對話：'+thread.title,'撰寫者：'+(thread.author||'未填寫'),
   '評語者：'+(e.reviewer||'未署名'),
   e.subject?'評價範圍：'+e.subject:'',
   e.title?'標題：'+e.title:'',
   '保存時間：'+fmtDate(e.createdAt),'',e.text||''].filter(v=>v!==undefined);
 downloadBlob(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),fileName(thread.title)+'_'+fileName(e.reviewer||'評語')+'_'+(e.kind==='self-review'?'自評':'評語')+'.txt');
}
function downloadAllReviews(entries,thread){
 const peer=entries.filter(e=>e.kind==='review').sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 if(!peer.length)throw Error('目前沒有其他人的評語可下載');
 const lines=['【交接稿・大家的評語】','交接對話：'+thread.title,'撰寫者：'+(thread.author||'未填寫'),'合計：'+peer.length+' 則',''];
 peer.forEach((e,i)=>lines.push('＝＝＝＝ 第 '+(i+1)+' 則評語 ＝＝＝＝','評語者：'+e.reviewer,
  '評價範圍：'+(e.subject||'未指定'),'標題：'+(e.title||'未命名'),'',e.text,''));
 downloadBlob(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),fileName(thread.title)+'_大家的評語.txt');
}
async function removeThread(t){
 // Legacy per-thread comments must survive deletion of their original handover thread.
 const legacyPeers=(await listWorldReviews(t.worldId)).filter(e=>e.threadId===t.id);
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  for(const e of legacyPeers)tx.objectStore(ENTRIES).put({...e,threadId:sharedReviewId(t.worldId)});
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
/*
 * V3 .ghb binary backup: tiny JSON manifest + original Blob parts.
 * This avoids base64 (~33% expansion), FileReader data URLs, and JSON.stringify of binary.
 * Older V1/V2 .json backups remain importable (up to a conservative mobile-safe size).
 */
async function backupPack(threads,forcedWorld=null){
 const sourceWorld=forcedWorld||threads[0]?.worldId||worldId();
 if(threads.some(t=>t.worldId!==sourceWorld))throw Error('不同世界觀的交接稿不能混合備份');
 let total=0;
 const pack=[],binaryParts=[];
 for(const thread of threads){
  const entries=await listEntries(thread.id),items=[];
  for(const e of entries){
   const item={id:e.id,kind:e.kind,text:e.text||'',name:e.name||'',mime:e.mime||'',size:e.size||0,createdAt:e.createdAt,
    updatedAt:e.updatedAt||null,order:e.order||0,reviewer:e.reviewer||'',subject:e.subject||'',title:e.title||''};
   if(e.kind==='file'){
    if(!(e.blob instanceof Blob))throw Error('附件「'+e.name+'」已損毀，無法備份');
    if(e.blob.size>FILE_LIMIT)throw Error('附件超過 50MB：'+e.name);
    if(total+e.blob.size>BACKUP_LIMIT)throw Error('這次備份附件合計超過 150 MB；請分別下載單一交接對話');
    item.byteOffset=total;
    item.byteLength=e.blob.size;
    binaryParts.push(e.blob); // references bytes; no base64 conversion or copying into strings
    total+=e.blob.size;
   }
   items.push(item);
  }
  pack.push({thread:{...thread},entries:items});
 }
 const sharedReviews=(await listWorldReviews(sourceWorld)).filter(e=>e.threadId===sharedReviewId(sourceWorld))
  .map(e=>({id:e.id,kind:'review',reviewer:e.reviewer||'',subject:e.subject||'',title:e.title||'',text:e.text||'',
    createdAt:e.createdAt,updatedAt:e.updatedAt||null,order:e.order||0}));
 const manifest={format:'gal-ai-handover-backup',version:4,worldId:sourceWorld,worldName:worldName(sourceWorld),
  exportedAt:new Date().toISOString(),conversations:pack,worldReviews:sharedReviews};
 const metadata=new TextEncoder().encode(JSON.stringify(manifest));
 if(metadata.byteLength>MAX_METADATA)throw Error('備份索引超過 10 MB，請改成分別下載單一交接對話');
 const blob=new Blob([BUNDLE_MAGIC,String(metadata.byteLength).padStart(BUNDLE_LENGTH_DIGITS,'0'),metadata,...binaryParts],
  {type:'application/octet-stream'});
 return {blob,count:pack.length,fileCount:pack.reduce((n,p)=>n+p.entries.filter(e=>e.kind==='file').length,0)};
}
async function exportPack(threads,label){
 if(!threads.length&&!(await listWorldReviews(worldId())).length)throw Error('目前還沒有可備份的交接對話或共用評語');
 message('正在準備交接稿備份；附件以原檔封裝，避免大量占用記憶體…');
 const pack=await backupPack(threads);
 downloadBlob(pack.blob,'交接稿_'+fileName(label)+'_'+new Date().toISOString().slice(0,10)+'.ghb');
 message('✅ 已提供 .ghb 備份下載：'+pack.count+' 個對話、'+pack.fileCount+' 份附件。請確認手機下載完成再刪除任何資料。');
}
function base64ToBlob(b64,mime){
 if(typeof b64!=='string'||b64.length>LEGACY_JSON_LIMIT*1.5)throw Error('舊版 JSON 的單一附件過大，建議先在電腦轉存新版 .ghb');
 const binary=atob(b64),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:mime||'application/octet-stream'});
}
async function readBackup(file){
 if(!file||file.size>IMPORT_LIMIT)throw Error('備份檔超過 210 MB');
 const header=await file.slice(0,BUNDLE_MAGIC.length).text();
 if(header===BUNDLE_MAGIC){
  const digits=await file.slice(BUNDLE_MAGIC.length,BUNDLE_MAGIC.length+BUNDLE_LENGTH_DIGITS).text();
  if(!/^[0-9]{12}$/.test(digits))throw Error('新版 .ghb 備份標頭損毀');
  const metaLength=Number(digits);
  const dataStart=BUNDLE_MAGIC.length+BUNDLE_LENGTH_DIGITS+metaLength;
  if(metaLength<=0||metaLength>MAX_METADATA||dataStart>file.size)throw Error('新版 .ghb 備份索引不完整');
  const manifest=JSON.parse(await file.slice(BUNDLE_MAGIC.length+BUNDLE_LENGTH_DIGITS,dataStart).text());
  if(![3,4].includes(manifest?.version)||manifest?.format!=='gal-ai-handover-backup')throw Error('備份格式版本不正確');
  return {manifest,file,dataStart,binary:true};
 }
 if(file.size>LEGACY_JSON_LIMIT)throw Error('舊版 JSON 備份超過 24 MB；為避免手機再次記憶體不足，請在電腦匯入並轉存新版 .ghb');
 const manifest=JSON.parse(await file.text());
 if(manifest?.format!=='gal-ai-handover-backup'||![1,2].includes(manifest.version))throw Error('不是有效的交接稿備份檔案');
 return {manifest,file,binary:false,dataStart:0};
}
async function importPack(file,forcedWorld=null){
 const source=await readBackup(file),raw=source.manifest,w=forcedWorld||worldId();
 if(!Array.isArray(raw.conversations))throw Error('交接稿備份缺少對話清單');
 if(raw.worldId!==w)throw Error('交接稿屬於其他世界觀（'+String(raw.worldName||raw.worldId)+'），請先切換到正確的世界觀');
 if(raw.conversations.length>200)throw Error('備份對話數超出安全限制');
 if(raw.worldReviews!==undefined&&(!Array.isArray(raw.worldReviews)||raw.worldReviews.length>2000))
  throw Error('世界觀共用評語的備份資料不合法');
 const previousReviews=await listWorldReviews(w),known=new Set(previousReviews.map(reviewSignature)),newSharedReviews=[];
 function addSharedFromBackup(item){
  if(!item||item.kind!=='review'||typeof item.reviewer!=='string'||!item.reviewer.trim()||
   typeof item.text!=='string'||!item.text.trim()||item.text.length>100000)
   throw Error('共用評語的備份資料不合法');
  const entry={id:uuid(),threadId:sharedReviewId(w),kind:'review',reviewer:item.reviewer.trim().slice(0,180),
   subject:String(item.subject||'').slice(0,250),title:String(item.title||'').slice(0,200),text:item.text,
   createdAt:item.createdAt||new Date().toISOString(),updatedAt:item.updatedAt||null,order:Number(item.order)||Date.now()};
  const key=reviewSignature(entry);
  if(known.has(key))return;
  known.add(key);newSharedReviews.push(entry);
 }
 const restored=[];
 let expectedOffset=0;
 for(const group of raw.conversations){
  const old=group?.thread;
  if(!old||old.worldId!==w||typeof old.title!=='string'||!old.title.trim()||!Array.isArray(group.entries)||group.entries.length>2000)throw Error('備份中的世界觀、對話或檔案清單不合法');
  const now=new Date().toISOString(),thread={id:uuid(),worldId:w,title:old.title.trim().slice(0,180),
   author:String(old.author||'').slice(0,180),description:String(old.description||'').slice(0,3000),
   createdAt:now,updatedAt:now,fileCount:0,noteCount:0,reviewCount:0,selfReviewCount:0},entries=[];
  for(const item of group.entries){
   if(!item||!['file','note','review','self-review'].includes(item.kind))throw Error('無效交接內容類型');
   const e={id:uuid(),threadId:thread.id,kind:item.kind,createdAt:item.createdAt||now,
    order:Number(item.order)||Date.now()+entries.length};
   if(item.kind==='file'){
    let blob;
    const mime=String(item.mime||'application/octet-stream');
    if(source.binary){
     const offset=item.byteOffset,length=item.byteLength;
     if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset!==expectedOffset||length<0||length>FILE_LIMIT)
      throw Error('附件位置或大小不合法：'+String(item.name));
     if(source.dataStart+offset+length>file.size)throw Error('附件內容不完整：'+String(item.name));
     blob=file.slice(source.dataStart+offset,source.dataStart+offset+length,mime);
     expectedOffset+=length;
    }else{
     if(typeof item.base64!=='string')throw Error('舊版備份附件缺少內容：'+String(item.name));
     blob=base64ToBlob(item.base64,mime);
    }
    if(blob.size>FILE_LIMIT)throw Error('備份單檔超過 50 MB：'+String(item.name));
    e.name=String(item.name||'未命名檔案').slice(0,250);e.mime=blob.type;e.size=blob.size;e.blob=blob;
    thread.fileCount++;
   }else if(item.kind==='note'){e.text=String(item.text||'').slice(0,100000);thread.noteCount++}
   else{
    if(typeof item.reviewer!=='string'||!item.reviewer.trim()||typeof item.text!=='string'||!item.text.trim()||item.text.length>100000)
     throw Error('備份評語缺少署名或正文');
    e.reviewer=item.reviewer.trim().slice(0,180);e.subject=String(item.subject||'').slice(0,250);e.title=String(item.title||'').slice(0,200);
    e.text=item.text;e.updatedAt=item.updatedAt||now;
    if(item.kind==='review')addSharedFromBackup(e);
    else if(++thread.selfReviewCount>1)throw Error('同一交接對話的備份包含多份自評，請先整理');
   }
   if(e.kind!=='review')entries.push(e);
  }
  restored.push({thread,entries});
 }
 for(const item of raw.worldReviews||[])addSharedFromBackup(item);
 if(source.binary&&source.dataStart+expectedOffset!==file.size)throw Error('備份檔案長度與附件清單不符，已取消匯入');
 // Import as NEW conversations. No existing local records or canon cycles are overwritten.
 await transaction([THREADS,ENTRIES],'readwrite',tx=>{
  for(const group of restored){
   tx.objectStore(THREADS).put(group.thread);
   for(const item of group.entries)tx.objectStore(ENTRIES).put(item);
  }
  for(const review of newSharedReviews)tx.objectStore(ENTRIES).put(review);
 });
 await reloadThreads();
 if(restored.length&&w===worldId())openThread(restored[0].thread.id,false);
 message('✅ 已匯入 '+restored.length+' 個交接對話及 '+newSharedReviews.length+' 則新的共用評語（文字相同的評論不重複新增，沒有覆蓋正史）。');
}
async function doSafe(fn){
 if(state.busy){message('上一項交接操作仍在執行');return}
 state.busy=true;
 try{await fn()}catch(e){console.error('[交接稿]',e);message('⛔ '+String(e?.message||e))}
 finally{state.busy=false}
}
function bindActions(){
 $('handoverSharedReviews').onclick=()=>openSharedReviews(worldId());
 $('handoverThreads').addEventListener('click',e=>{
  const b=e.target.closest('[data-handover-id]');if(b)openThread(b.dataset.handoverId);
 });
 $('handoverExport').onclick=()=>doSafe(async()=>exportPack(state.threads.filter(t=>t.worldId===worldId()),worldName(worldId())));
 $('handoverImport').onclick=()=>$('handoverImportFile').click();
 $('handoverStorage').onclick=()=>doSafe(async()=>{
  const target=$('handoverStorageStatus');
  if(!navigator.storage?.estimate){target.textContent='這個瀏覽器無法提供儲存空間估計；此檢查不會修改任何資料。';return}
  const {usage,quota}=await navigator.storage.estimate();
  if(!Number.isFinite(quota)||!quota){target.textContent='瀏覽器未提供配額數字，不能據此判定記憶體故障。';return}
  target.textContent='網站儲存空間：約已使用 '+fmtSize(usage||0)+'／配額 '+fmtSize(quota)+
   '（剩餘約 '+fmtSize(Math.max(0,quota-(usage||0)))+'）。這是瀏覽器網站儲存額度，不等於手機 RAM。';
 });
 $('handoverImportFile').onchange=e=>doSafe(async()=>{try{const file=e.target.files?.[0];if(file)await importPack(file)}finally{e.target.value=''}});
 $('content').addEventListener('click',e=>{
  const btn=e.target.closest('[data-ha-action]');if(!btn)return;
  const action=btn.dataset.haAction,entryId=btn.dataset.haId,w=worldId(),t=activeThread(w);
  if(!t&&!isSharedView(w))return;
  if(!t&&!['back','cancel-review-edit','add-review','edit-review','download-review','download-reviews','delete-entry'].includes(action))return;
  if(action==='back'){close();window.ArchiveHandoverBridge?.rerender?.();return}
  if(action==='switch-view'){
   if(!['files','reviews','self'].includes(btn.dataset.haView))return;
   state.view=btn.dataset.haView;state.editingReviewId=null;
   renderActive(worldId());return;
  }
  if(action==='cancel-review-edit'){
   state.editingReviewId=null;renderActive(worldId());return;
  }
  doSafe(async()=>{
   if(action==='upload'){
    const files=Array.from($('handoverFiles')?.files||[]);
    const count=await uploadFilesSafely(t,files);
    message('✅ 已逐份儲存 '+count+' 份交接檔案（本機）；建議接著下載 .ghb 備份。');
   }else if(action==='note'){
    const textarea=$('handoverNote'),text=String(textarea?.value||'').trim();
    if(!text)throw Error('請先輸入備註文字');
    if(text.length>100000)throw Error('單則備註最多 100,000 字');
    await addEntries(t,[{id:uuid(),threadId:t.id,kind:'note',text,createdAt:new Date().toISOString(),order:Date.now()}]);
    message('✅ 已加入文字備註');
   }else if(action==='add-review'){
    const reviewer=String($('handoverReviewer')?.value||'').trim();
    const text=String($('handoverReviewText')?.value||'').trim();
    const subject=String($('handoverReviewSubject')?.value||'').trim();
    const title=String($('handoverReviewTitle')?.value||'').trim();
    if(!reviewer||reviewer.length>180)throw Error('請填寫評語者（最多 180 字）');
    if(!text||text.length>100000)throw Error('請貼入完整評語（最多 100,000 字）');
    if(subject.length>250||title.length>200)throw Error('評語標題或範圍太長');
    const existingId=state.editingReviewId,now=new Date().toISOString();
    const entry={id:existingId||uuid(),threadId:sharedReviewId(w),kind:'review',reviewer,subject,title,text,updatedAt:now,createdAt:now,order:Date.now()};
    await saveSharedReview(w,entry,existingId);
    state.editingReviewId=null;await renderActive(worldId());
    message(existingId?'✅ 已更新評語（保留原始 ID）':'✅ 已儲存 '+reviewer+' 的評語');
   }else if(action==='edit-review'){
    const record=await findWorldReview(w,entryId);
    if(!record)throw Error('找不到這筆評語');
    state.editingReviewId=record.id;await renderActive(worldId());
    $('handoverReviewer')?.scrollIntoView({block:'center',behavior:'smooth'});
    message('已載入原評語，可修改後點「更新評語」。');
   }else if(action==='download-review'){
    const record=await findWorldReview(w,entryId);
    if(!record)throw Error('找不到這筆評語');
    downloadReviewTxt(record,commonReviewContext(w));
   }else if(action==='download-reviews'){
    await downloadAllReviews(await listWorldReviews(w),commonReviewContext(w));
   }else if(action==='save-self'){
    const reviewer=String($('handoverSelfAuthor')?.value||'').trim(),text=String($('handoverSelfText')?.value||'').trim();
    if(!reviewer||reviewer.length>180)throw Error('請填寫自評者（最多 180 字）');
    if(!text||text.length>100000)throw Error('請填寫自己的完整自評（最多 100,000 字）');
    if(t.author&&t.author!==reviewer)throw Error('自評者與這份交接稿的撰寫者「'+t.author+'」不一致；請先按「設定撰寫者」修正。');
    const old=(await listEntries(t.id)).find(e=>e.kind==='self-review'),now=new Date().toISOString();
    const entry={id:old?.id||uuid(),threadId:t.id,kind:'self-review',reviewer,text,
     createdAt:old?.createdAt||now,updatedAt:now,order:old?.order||Date.now()};
    await saveReviewRecord(t,entry,old?.id||null);
    message('✅ '+reviewer+' 的自評已保存，與他人評語分開。');
   }else if(action==='download-self'||action==='delete-self'){
    const record=(await listEntries(t.id)).find(e=>e.kind==='self-review');
    if(!record)throw Error('這份交接對話尚無自評');
    if(action==='download-self')downloadReviewTxt(record,t);
    else if(confirm('確定永久刪除這份自評？建議先下載備份。'))await removeEntry(t,record);
   }else if(action==='edit-author'){
    const answer=prompt('請輸入交接稿的實際撰寫者／副駕駛（可留空）：',t.author||'');
    if(answer===null)return;
    if(answer.trim().length>180)throw Error('撰寫者名稱最多 180 字');
    await putThread({...t,author:answer.trim(),updatedAt:new Date().toISOString()});
    await reloadThreads();await renderActive(worldId());
   }else if(action==='download'||action==='preview'||action==='delete-entry'){
    const entry=action==='delete-entry'&&state.view==='reviews'?await findWorldReview(w,entryId):(await listEntries(t.id)).find(x=>x.id===entryId);
    if(!entry)throw Error('找不到這筆交接內容，請重新開啟');
    if(action==='download'){if(!(entry.blob instanceof Blob))throw Error('找不到檔案內容');downloadBlob(entry.blob,entry.name)}
    else if(action==='preview')previewEntry(entry);
    else if(confirm('確定要永久刪除這筆'+(entry.kind==='file'?'檔案（含原檔）':entry.kind==='review'?'世界觀共用評語':'備註')+'？')){
     if(entry.kind==='review')await deleteWorldReview(w,entry);
     else await removeEntry(t,entry);
    }
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
async function handoverAllWorldBundles(){
 await reloadThreads();
 const worlds=new Set(state.threads.map(t=>t.worldId));
 const reviews=await transaction([ENTRIES],'readonly',tx=>tx.objectStore(ENTRIES).index('kind').getAll('review'));
 for(const e of reviews){
  if(e.threadId?.startsWith('__gal-handover-shared-reviews__:')){
   const w=decodeURIComponent(e.threadId.slice('__gal-handover-shared-reviews__:'.length));
   if(w)worlds.add(w);
  }
 }
 const bundles=[];
 for(const w of worlds){
  const {blob,count,fileCount}=await backupPack(state.threads.filter(t=>t.worldId===w),w);
  bundles.push({worldId:w,blob,count,fileCount});
 }
 return bundles;
}
async function handoverInspectBundle(file){
 const source=await readBackup(file),raw=source.manifest;
 if(!raw?.worldId||!Array.isArray(raw.conversations))throw Error('交接稿備份索引不完整');
 return {worldId:raw.worldId,version:raw.version,threads:raw.conversations.length,
  sharedReviews:Array.isArray(raw.worldReviews)?raw.worldReviews.length:0,bytes:file.size};
}
window.ArchiveHandover={renderList,isActive,renderActive,close,
 reload:async()=>{await reloadThreads();if(isActive(worldId()))await renderActive(worldId())},
 bundleAll:handoverAllWorldBundles,inspectBundle:handoverInspectBundle,importBundle:importPack
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
else setup();
})();