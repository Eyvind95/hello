(()=>{
'use strict';
/* One-file downloadable backup: canonical archive JSON plus every world-scoped
 * .ghb handover bundle with original PDF/Word bytes. No base64 conversion.
 * This is a manual local export/import; cloud sync is a separate operation. */
const MAGIC='GAL-ARCHIVE-COMPLETE-V1\n',DIGITS=12,MAX_HEADER=1024*1024;
const filename=s=>String(s||'完整備份').replace(/[\\/:*?"<>|\r\n]/g,'_');
function requireHandover(){
 const service=window.ArchiveHandover;
 if(!service?.bundleAll||!service?.inspectBundle||!service?.importBundle)
  throw Error('交接稿功能尚未載入，為避免漏備份已停止操作；請重新整理網頁。');
 return service;
}
function saveBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename(name);document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function exportBackup({cycles,worlds,progress=()=>{}}){
 const handover=requireHandover();
 if(!Array.isArray(cycles)||!Array.isArray(worlds))throw Error('輪迴或世界觀資料無效，已停止備份');
 progress('正在收集所有世界觀的交接稿與附件…');
 const bundles=await handover.bundleAll();
 const archive={format:'gal-ai-archive',version:8,exportedAt:new Date().toISOString(),worlds,cycles};
 const archiveBlob=new Blob([JSON.stringify(archive)],{type:'application/json'});
 const segments=[{kind:'archive',bytes:archiveBlob.size,offset:0}];
 let cursor=archiveBlob.size;
 for(const bundle of bundles){
  segments.push({kind:'handover',worldId:bundle.worldId,bytes:bundle.blob.size,offset:cursor,
   threads:bundle.count,files:bundle.fileCount});
  cursor+=bundle.blob.size;
 }
 const metadata={format:'gal-ai-archive-complete',version:1,createdAt:new Date().toISOString(),segments};
 const bytes=new TextEncoder().encode(JSON.stringify(metadata));
 if(bytes.byteLength>MAX_HEADER)throw Error('備份索引異常過大');
 const blob=new Blob([MAGIC,String(bytes.byteLength).padStart(DIGITS,'0'),bytes,archiveBlob,...bundles.map(x=>x.blob)],
  {type:'application/octet-stream'});
 // Validate header and complete payload lengths before providing the download.
 if(blob.size!==MAGIC.length+DIGITS+bytes.byteLength+cursor)throw Error('完整備份組合長度錯誤');
 saveBlob(blob,'輪迴檔案館_完整備份_'+new Date().toISOString().slice(0,10)+'.gab');
 const files=bundles.reduce((n,x)=>n+x.fileCount,0);
 const threads=bundles.reduce((n,x)=>n+x.count,0);
 const result={cycles:cycles.length,worlds:worlds.length,threads,files,bytes:blob.size};
 progress('✅ 已提供完整 .gab 備份下載：'+result.cycles+' 輪、'+threads+' 份交接對話、'+files+' 份附件，含評語及自評。請確認下載完成。');
 return result;
}
async function isCombined(file){
 if(!file?.slice)return false;
 return (await file.slice(0,MAGIC.length).text())===MAGIC;
}
async function inspect(file,{previewArchive}){
 if(!file||!file.slice||!await isCombined(file))throw Error('不是輪迴檔案館完整 .gab 備份');
 const digits=await file.slice(MAGIC.length,MAGIC.length+DIGITS).text();
 if(!/^[0-9]{12}$/.test(digits))throw Error('完整備份的標頭長度異常');
 const metaSize=Number(digits),bodyStart=MAGIC.length+DIGITS+metaSize;
 if(metaSize<=0||metaSize>MAX_HEADER||bodyStart>file.size)throw Error('完整備份索引過大或不完整');
 const meta=JSON.parse(await file.slice(MAGIC.length+DIGITS,bodyStart).text());
 if(meta?.format!=='gal-ai-archive-complete'||meta.version!==1||!Array.isArray(meta.segments)||
  !meta.segments.length||meta.segments[0]?.kind!=='archive')throw Error('完整備份版本或索引無效');
 const segments=[];let cursor=0;
 for(const section of meta.segments){
  if(!Number.isSafeInteger(section.offset)||section.offset!==cursor||!Number.isSafeInteger(section.bytes)||
   section.bytes<0||!['archive','handover'].includes(section.kind))throw Error('完整備份有不連續或不合法的資料段');
  if(section.kind==='archive'&&segments.length!==0||section.kind==='handover'&&!section.worldId)
   throw Error('完整備份分段順序或世界觀資訊不合法');
  cursor+=section.bytes;segments.push({...section,file:file.slice(bodyStart+section.offset,bodyStart+cursor)});
 }
 if(bodyStart+cursor!==file.size)throw Error('完整備份總長度異常，可能未下載完整');
 const archiveText=await segments[0].file.text();
 const archive=JSON.parse(archiveText.replace(/^\uFEFF/,''));
 if(archive?.format!=='gal-ai-archive'||!Array.isArray(archive.cycles)||!Array.isArray(archive.worlds))
  throw Error('完整備份中的正史 JSON 無效');
 if(typeof previewArchive==='function'){
  const report=previewArchive(archiveText);
  if(report?.errors?.length||report?.valid?.length!==archive.cycles.length||
   (Array.isArray(report?.worlds)&&report.worlds.length<archive.worlds.length))
   throw Error('完整備份中的正史包含無法匯入的輪迴／世界觀，拒絕不完整還原');
 }
 const handover=requireHandover();
 let handoverCount=0,fileCount=0;
 for(const segment of segments.slice(1)){
  const details=await handover.inspectBundle(segment.file);
  if(details.worldId!==segment.worldId)throw Error('交接稿備份的世界觀 ID 不符：'+segment.worldId);
  if(details.bytes!==segment.bytes)throw Error('交接稿備份大小不符：'+segment.worldId);
  handoverCount+=details.threads;
  fileCount+=Number(segment.files)||0;
 }
 return {segments,archiveText,archive,
  summary:{cycles:archive.cycles.length,worlds:archive.worlds.length,
   handoverConversations:handoverCount,attachedFiles:fileCount,
   handoverWorlds:segments.length-1,size:file.size}};
}
async function importBackup(file,{previewArchive,importArchive,progress=()=>{}}){
 if(typeof importArchive!=='function')throw Error('正史匯入功能尚未初始化');
 const prepared=await inspect(file,{previewArchive}); // Check all bundle headers before writes.
 if(!confirm('確定從完整備份合併還原？輪迴會依備份的 ID 匯入；交接對話新增副本、共用評語去重。請先備份現有資料。'))return {cancelled:true};
 progress('已檢查全部分段。正在還原世界觀與輪迴正史…');
 await importArchive(prepared.archiveText);
 let imported=0;
 try{
  for(const segment of prepared.segments.slice(1)){
   progress('正在還原 '+segment.worldId+' 的交接稿與附件…');
   await requireHandover().importBundle(segment.file,segment.worldId);
   imported++;
  }
 }catch(err){
  throw Error('輪迴正史已匯入，但僅還原 '+imported+'／'+(prepared.segments.length-1)+
   ' 個世界觀的交接稿。請保留完整 .gab 檔，檢查後重試；原因：'+String(err?.message||err));
 }
 progress('✅ 完整備份還原完成：'+prepared.summary.cycles+' 輪、'+imported+' 個交接世界觀。');
 return {restored:true,worlds:imported};
}
window.ArchiveCompleteBackup={exportBackup,isCombined,inspect,importBackup};
})();