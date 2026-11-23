(()=>{
'use strict';
/* Private Firestore handover sync. Canonical cycles remain owned by index.html.
 * Attachments are chunked Firestore Bytes (128 KiB) to avoid 1 MiB document limits.
 * Server-only reads and an explicit 'ready' manifest prevent half-uploaded files from being imported.
 * Additive, timestamp-aware merges; never use an empty device to delete cloud content.
 */
const DB='gal-archive-handovers-v1',THREADS='threads',ENTRIES='entries',DELETES='deletes',CHUNK=128*1024;
const COLLECTION={threads:'handoverThreads',entries:'handoverEntries',files:'handoverFiles',deletes:'handoverDeletes'};
const LIMIT=50*1024*1024,MAX_FILES=5000,MAX_RECORDS=10000;
const toText=e=>String(e?.message||e||'未知錯誤');
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:'';
const newer=(a,b)=>Date.parse(iso(a)||'1970-01-01')>Date.parse(iso(b)||'1970-01-01');
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=500&&!x.includes('/');
const sharedId='__gal-handover-shared-reviews__:';
const safeObj=e=>JSON.parse(JSON.stringify(e));
async function dbOpen(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB,3);
  r.onupgradeneeded=()=>{
   const d=r.result;
   if(!d.objectStoreNames.contains(THREADS))d.createObjectStore(THREADS,{keyPath:'id'});
   const os=d.objectStoreNames.contains(ENTRIES)?r.transaction.objectStore(ENTRIES):d.createObjectStore(ENTRIES,{keyPath:'id'});
   if(!os.indexNames.contains('threadId'))os.createIndex('threadId','threadId',{unique:false});
   if(!os.indexNames.contains('kind'))os.createIndex('kind','kind',{unique:false});
   if(!d.objectStoreNames.contains(DELETES))d.createObjectStore(DELETES,{keyPath:'id'});
  };
  r.onerror=()=>reject(r.error||Error('交接稿資料庫無法開啟'));
  r.onblocked=()=>reject(Error('請先關閉其他檔案館分頁，避免資料庫升級被阻擋'));
  r.onsuccess=()=>resolve(r.result);
 });
}
async function readAll(db,table){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(table,'readonly'),r=tx.objectStore(table).getAll();
  tx.oncomplete=()=>resolve(r.result||[]);
  tx.onerror=()=>reject(tx.error||Error('讀取交接稿失敗'));
 });
}
async function putMany(db,table,items){
 if(!items.length)return;
 // Prevent a single huge IndexedDB transaction from consuming memory on mobile.
 for(let start=0;start<items.length;start+=30){
  const slice=items.slice(start,start+30);
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(table,'readwrite'),os=tx.objectStore(table);
   for(const item of slice)os.put(item);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||Error('保存交接稿失敗'));
   tx.onabort=()=>reject(tx.error||Error('保存交接稿交易中止'));
  });
 }
}
function compareDeleted(record,mark){
 return Boolean(mark)&&(!newer(dataTimestamp(record),mark.deletedAt));
}
function tombstoneMap(items){
 const map=new Map();
 for(const item of items){
  if(!item?.id||!item.kind||!['thread','entry'].includes(item.kind)||!validId(item.targetId)||!validId(item.worldId))
   throw Error('交接稿刪除標記不合法');
  const old=map.get(item.id);
  if(!old||newer(item.deletedAt,old.deletedAt))map.set(item.id,item);
 }
 return map;
}
async function localSnapshot(){
 const db=await dbOpen();
 try{
  const threads=await readAll(db,THREADS),entries=await readAll(db,ENTRIES),deletes=await readAll(db,DELETES);
  if(threads.length>MAX_RECORDS||entries.length>MAX_RECORDS||deletes.length>MAX_RECORDS)throw Error('交接稿數量超過安全上限');
  return {threads,entries,deletes};
 }finally{db.close()}
}
function worldFor(entry,byId){
 const thread=byId.get(entry.threadId);
 if(thread)return thread.worldId;
 if(entry.threadId?.startsWith(sharedId))return decodeURIComponent(entry.threadId.slice(sharedId.length));
 return null;
}
function requireSnapshot({threads,entries}){
 const byId=new Map();
 for(const t of threads){
  if(!validId(t.id)||!validId(t.worldId)||!t.title)throw Error('交接對話 ID／世界觀不完整：'+String(t.title||t.id));
  byId.set(t.id,t);
 }
 for(const e of entries){
  if(!validId(e.id)||!validId(e.threadId))throw Error('交接附件缺少合法 ID');
  const w=worldFor(e,byId);
  if(!w)throw Error('交接內容「'+String(e.name||e.title||e.id)+'」找不到所屬世界觀；為避免遺失已停止同步');
  if(e.kind==='file'&&(!(e.blob instanceof Blob)||e.blob.size>LIMIT))throw Error('交接 PDF 檔案無效或超過 50 MB：'+String(e.name||e.id));
 }
 return byId;
}
function fileMeta(entry,worldId){
 return {id:entry.id,worldId,threadId:entry.threadId,kind:'file',
  name:String(entry.name||'未命名附件').slice(0,250),
  mime:String(entry.mime||'application/octet-stream').slice(0,120),
  size:entry.blob.size,createdAt:iso(entry.createdAt)||new Date().toISOString(),
  updatedAt:iso(entry.updatedAt)||iso(entry.createdAt)||new Date().toISOString(),
  partCount:Math.ceil(entry.blob.size/CHUNK),chunkSize:CHUNK,
  status:'ready',schemaVersion:1};
}
function textMeta(e,worldId){
 const fields=['id','threadId','kind','name','text','reviewer','subject','title','createdAt','updatedAt','order'];
 const data={worldId,schemaVersion:1};
 for(const k of fields)if(e[k]!==undefined)data[k]=e[k];
 return data;
}
function firestoreBytes(uint8){
 const BlobClass=window.firebase?.firestore?.Blob;
 if(!BlobClass?.fromUint8Array)throw Error('Firestore SDK 尚未支援二進位附件，請重新整理檔案館');
 return BlobClass.fromUint8Array(uint8);
}
async function hashChunk(bytes){
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function serverGet(ref){return ref.get({source:'server'})}
function dataTimestamp(x){return iso(x?.updatedAt)||iso(x?.createdAt)}
function conflictWorld(a,b,id){if(a&&b&&a!==b)throw Error('資料 ID '+id+' 的世界觀衝突，已停止同步')}
async function uploadFile(root,entry,worldId,progress){
 const ref=root.collection(COLLECTION.files).doc(entry.id);
 const meta=fileMeta(entry,worldId),current=await serverGet(ref),old=current.exists?current.data():null;
 if(old){
  conflictWorld(old.worldId,worldId,entry.id);
  if(old.threadId!==entry.threadId||old.size!==meta.size||old.mime!==meta.mime)
   throw Error('附件 ID 已存在但內容資訊不同，禁止覆蓋：'+entry.name);
  if(old.status==='ready'&&old.partCount===meta.partCount&&old.chunkSize===CHUNK)return false;
 }
 // A failed upload never marks a new attachment "ready"; partial chunks are ignored by pull.
 const parts=ref.collection('parts');
 for(let i=0;i<meta.partCount;i++){
  const start=i*CHUNK,bytes=new Uint8Array(await entry.blob.slice(start,Math.min(start+CHUNK,entry.blob.size)).arrayBuffer());
  const digest=await hashChunk(bytes);
  await parts.doc(String(i).padStart(6,'0')).set({index:i,data:firestoreBytes(bytes),sha256:digest});
  if(i%8===0||i===meta.partCount-1)progress('↑ 附件「'+entry.name+'」第 '+(i+1)+'／'+meta.partCount+' 段');
 }
 // Manifest is committed last. On retries, written chunks are idempotent.
 await ref.set(meta);
 const check=await serverGet(ref);
 if(!check.exists||check.data().status!=='ready'||check.data().partCount!==meta.partCount)
  throw Error('附件雲端完成狀態核對失敗：'+entry.name);
 return true;
}
async function downloadFile(ref,meta,progress){
 if(meta.status!=='ready')throw Error('附件尚未完整上傳：'+meta.name);
 if(!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>LIMIT||meta.chunkSize!==CHUNK||
  meta.partCount!==Math.ceil(meta.size/CHUNK))throw Error('附件分段索引異常：'+meta.name);
 const pieces=[],parts=ref.collection('parts');
 for(let i=0;i<meta.partCount;i++){
  const d=await serverGet(parts.doc(String(i).padStart(6,'0')));
  if(!d.exists||d.data().index!==i)throw Error('附件缺少第 '+(i+1)+' 段：'+meta.name);
  const bytes=d.data().data?.toUint8Array?.();
  if(!(bytes instanceof Uint8Array)||bytes.length!==Math.min(CHUNK,meta.size-i*CHUNK)||
   await hashChunk(bytes)!==d.data().sha256)throw Error('附件分段內容驗證失敗：'+meta.name+'（第 '+(i+1)+' 段）');
  pieces.push(bytes);
  if(i%8===0||i===meta.partCount-1)progress('↓ 附件「'+meta.name+'」第 '+(i+1)+'／'+meta.partCount+' 段');
 }
 const blob=new Blob(pieces,{type:meta.mime||'application/octet-stream'});
 if(blob.size!==meta.size)throw Error('附件總大小不一致：'+meta.name);
 return {id:meta.id,threadId:meta.threadId,kind:'file',name:meta.name,mime:meta.mime,
  size:meta.size,blob,createdAt:meta.createdAt,updatedAt:meta.updatedAt,order:Date.parse(meta.createdAt)||0};
}
async function push({db,user,progress=()=>{}}){
 if(!db||!user?.uid)throw Error('請先登入 Firebase');
 const local=await localSnapshot(),threadMap=requireSnapshot(local);
 const root=db.collection('galArchive').doc(user.uid);
 const cloudThreads=await root.collection(COLLECTION.threads).get({source:'server'});
 const cloudText=await root.collection(COLLECTION.entries).get({source:'server'});
 const cloudFiles=await root.collection(COLLECTION.files).get({source:'server'});
 const cloudDeletes=await root.collection(COLLECTION.deletes).get({source:'server'});
 if(!local.threads.length&&!local.entries.length&&!local.deletes.length&&(cloudThreads.size||cloudText.size||cloudFiles.size||cloudDeletes.size))
  throw Error('這台裝置沒有交接稿，但雲端已有資料；請先按「從雲端合併下載」，禁止空資料覆蓋');
 const tMap=new Map(cloudThreads.docs.map(d=>[d.id,d.data()])),eMap=new Map(cloudText.docs.map(d=>[d.id,d.data()]));
 const fMap=new Map(cloudFiles.docs.map(d=>[d.id,d.data()]));
 let updatedThreads=0,updatedText=0,updatedFiles=0,updatedDeletes=0,skipped=0;
 const remoteMarks=tombstoneMap(cloudDeletes.docs.map(d=>d.data()));
 const marks=tombstoneMap([...remoteMarks.values(),...local.deletes]);
 for(const marker of local.deletes){
  const old=remoteMarks.get(marker.id);
  if(old&&old.worldId!==marker.worldId)throw Error('刪除標記世界觀衝突：'+marker.id);
  if(old&&!newer(marker.deletedAt,old.deletedAt))continue;
  await root.collection(COLLECTION.deletes).doc(marker.id).set({...safeObj(marker),schemaVersion:1});
  updatedDeletes++;
 }
 for(const thread of local.threads){
  if(compareDeleted(thread,marks.get('thread:'+thread.id))){skipped++;continue}
  const old=tMap.get(thread.id);if(old)conflictWorld(old.worldId,thread.worldId,thread.id);
  if(old&&(!newer(thread.updatedAt,old.updatedAt))){skipped++;continue}
  // The full metadata document is small and contains no PDF blobs.
  await root.collection(COLLECTION.threads).doc(thread.id).set({...safeObj(thread),schemaVersion:1});
  updatedThreads++;progress('↑ 交接對話：'+updatedThreads+'／'+local.threads.length);
 }
 for(const entry of local.entries){
  if(compareDeleted(entry,marks.get('entry:'+entry.id))||compareDeleted(threadMap.get(entry.threadId),marks.get('thread:'+entry.threadId))){skipped++;continue}
  const w=worldFor(entry,threadMap);
  if(entry.kind==='file'){
   const old=fMap.get(entry.id);
   if(old)conflictWorld(old.worldId,w,entry.id);
   if(old&&old.status==='ready'&&old.size===entry.blob.size&&old.threadId===entry.threadId) {skipped++;continue}
   if(await uploadFile(root,entry,w,progress))updatedFiles++;
  }else{
   const old=eMap.get(entry.id);
   if(old)conflictWorld(old.worldId,w,entry.id);
   if(old&&!newer(dataTimestamp(entry),dataTimestamp(old))){skipped++;continue}
   await root.collection(COLLECTION.entries).doc(entry.id).set(textMeta(entry,w));
   updatedText++;
  }
 }
 return {threads:updatedThreads,text:updatedText,files:updatedFiles,deletes:updatedDeletes,skipped};
}
async function pull({db,user,progress=()=>{}}){
 if(!db||!user?.uid)throw Error('請先登入 Firebase');
 const root=db.collection('galArchive').doc(user.uid);
 const [threadSnap,textSnap,fileSnap,deleteSnap]=await Promise.all([
  root.collection(COLLECTION.threads).get({source:'server'}),
  root.collection(COLLECTION.entries).get({source:'server'}),
  root.collection(COLLECTION.files).get({source:'server'}),
  root.collection(COLLECTION.deletes).get({source:'server'})
 ]);
 const local=await localSnapshot();
 const threadMap=new Map(local.threads.map(t=>[t.id,t]));
 const entryMap=new Map(local.entries.map(e=>[e.id,e]));
 const marks=tombstoneMap(local.deletes);
 const remoteMarks=tombstoneMap(deleteSnap.docs.map(d=>d.data()));
 const newMarkers=[];
 for(const marker of remoteMarks.values()){
  const old=marks.get(marker.id);
  if(old&&old.worldId!==marker.worldId)throw Error('刪除標記的世界觀衝突：'+marker.id);
  if(!old||newer(marker.deletedAt,old.deletedAt)){marks.set(marker.id,marker);newMarkers.push(marker)}
 }
 const threads=[],entries=[];
 let skipped=0,downloadedFiles=0;
 for(const doc of threadSnap.docs){
  const item=doc.data(),old=threadMap.get(doc.id);
  if(!validId(doc.id)||item.id!==doc.id||!validId(item.worldId))
   throw Error('雲端交接對話 ID／世界觀無效：'+doc.id);
  if(compareDeleted(item,marks.get('thread:'+doc.id))){skipped++;continue}
  if(old)conflictWorld(old.worldId,item.worldId,doc.id);
  if(old&&!newer(item.updatedAt,old.updatedAt)){skipped++;continue}
  threads.push({...item,id:doc.id});threadMap.set(doc.id,item);
 }
 // Remove tombstoned threads from the effective parent map to avoid restoring orphan entries.
 for(const [id,t] of threadMap)
  if(compareDeleted(t,marks.get('thread:'+id)))threadMap.delete(id);
 for(const doc of textSnap.docs){
  const item=doc.data(),old=entryMap.get(doc.id);
  if(!validId(doc.id)||item.id!==doc.id||!['note','review','self-review'].includes(item.kind))
   throw Error('雲端交接文字格式異常：'+doc.id);
  if(compareDeleted(item,marks.get('entry:'+doc.id))||
    compareDeleted({updatedAt:item.updatedAt||item.createdAt},marks.get('thread:'+item.threadId))){
   skipped++;continue;
  }
  const w=worldFor(item,threadMap);
  if(!w||w!==item.worldId)throw Error('交接文字所屬世界觀／對話不一致：'+doc.id);
  if(old&&!newer(dataTimestamp(item),dataTimestamp(old))){skipped++;continue}
  const copy={...item};delete copy.worldId;delete copy.schemaVersion;
  entries.push(copy);entryMap.set(doc.id,copy);
 }
 if(fileSnap.size>MAX_FILES)throw Error('雲端附件數量超過安全上限');
 for(const doc of fileSnap.docs){
  const item=doc.data(),old=entryMap.get(doc.id);
  if(item.status!=='ready')continue; // Incomplete uploads never appear as valid downloads.
  if(compareDeleted(item,marks.get('entry:'+doc.id))||
   compareDeleted({updatedAt:item.updatedAt||item.createdAt},marks.get('thread:'+item.threadId))){
   skipped++;continue;
  }
  if(!validId(doc.id)||item.id!==doc.id||item.kind!=='file'||!validId(item.threadId)||
   !threadMap.has(item.threadId)||threadMap.get(item.threadId).worldId!==item.worldId)
   throw Error('雲端附件 ID／世界觀不一致：'+doc.id);
  if(old&&old.kind==='file'&&old.size===item.size&&old.threadId===item.threadId){skipped++;continue}
  if(old)throw Error('本機附件與雲端同 ID 內容不同，已停止，沒有覆蓋任何原檔：'+item.name);
  entries.push(await downloadFile(doc.ref,item,progress));
  downloadedFiles++;progress('↓ 已核對附件 '+downloadedFiles+' 份');
 }
 const removedThreads=local.threads.filter(t=>compareDeleted(t,marks.get('thread:'+t.id))).map(t=>t.id);
 const removedEntries=local.entries.filter(e=>
   compareDeleted(e,marks.get('entry:'+e.id))||
   compareDeleted({updatedAt:e.updatedAt||e.createdAt},marks.get('thread:'+e.threadId))).map(e=>e.id);
 // Atomic local merge: all verified file entries, reviews, and deletion markers commit together.
 const localDb=await dbOpen();
 try{
  await new Promise((resolve,reject)=>{
   const tx=localDb.transaction([THREADS,ENTRIES,DELETES],'readwrite'),
    ts=tx.objectStore(THREADS),es=tx.objectStore(ENTRIES),ds=tx.objectStore(DELETES);
   for(const mark of newMarkers)ds.put(mark);
   for(const t of threads)ts.put(t);
   for(const e of entries)es.put(e);
   for(const id of removedThreads)ts.delete(id);
   for(const id of removedEntries)es.delete(id);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('下載合併寫入失敗'));
   tx.onabort=()=>reject(tx.error||Error('下載合併交易取消'));
  });
 }finally{localDb.close()}
 await window.ArchiveHandover?.reload?.();
 return {threads:threads.length,text:entries.length-downloadedFiles,files:downloadedFiles,
  deletes:newMarkers.length,skipped};
}
window.ArchiveHandoverCloud={push,pull};
})();