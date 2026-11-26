(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchivePilotImport=api})(globalThis,function(){
'use strict';
const FORMAT='gal-predecessor-cycle-overwrite',FIELDS=['pilotMessages','quizLogs','easterEggs'];
const fail=m=>{throw Error(m)};
const str=(x)=>typeof x==='string'&&x.trim().length>0;
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function binding(r){return {worldKey:r.world,cycleId:r.id,cycleTitle:r.title}}
function plan(r,source,pack,sha){
 if(!obj(r)||!str(r.world)||!str(r.id)||!str(r.title))fail('缺少目前輪迴');
 if(!obj(pack)||pack.format!==FORMAT||pack.version!==1)fail('不是副駕駛三分頁覆蓋 JSON V1');
 if(!obj(pack.target)||!Object.entries(binding(r)).every(([k,v])=>pack.target[k]===v))fail('世界觀／輪迴 ID／輪迴名稱不符');
 if(!obj(source)||source.version!==1||!str(source.chatId)||!Array.isArray(source.rows)||source.rows.length!==source.count||!source.count)fail('原始聊天資料結構錯誤');
 if(source.format!=='gal-predecessor-offline-reconciliation-candidate'&&!(source.format==='gal-predecessor-chat'&&source.status==='completed'))fail('請使用離線整合候選或正式完成聊天');
 if(!/^[0-9a-f]{64}$/.test(sha)||pack.sourceSha256!==sha||pack.chatId!==source.chatId)fail('來源聊天 ID 或 SHA-256 不符');
 if(!str(pack.manager)||pack.manager.length>180)fail('缺少副駕駛名稱');
 const map=new Map();source.rows.forEach((row,i)=>{if(!obj(row)||!str(row.id)||map.has(row.id)||row.index!==i||!['user','assistant'].includes(row.role)||typeof row.text!=='string'||!Array.isArray(row.attachments))fail('原始來源索引、ID 或欄位異常：'+i);map.set(row.id,row)});
 const existingIds=new Set(),oldOther=['messages','events','changeLogs'].flatMap(k=>r[k]||[]);for(const m of oldOther)if(m?.id)existingIds.add(m.id);
 function logs(key){
  if(!Array.isArray(pack[key])||!pack[key].length)fail(key+' 空白，拒絕覆蓋');
  let last=-1;const seen=new Set();
  return pack[key].map((entry,i)=>{
   const row=map.get(entry?.sourceId);if(!row||seen.has(row.id)||row.index<=last||!str(entry.text))fail(key+' 第 '+(i+1)+' 筆來源、順序或正文不符');
   const marker=/(?:^|\n)[ \t]*(?:[（(][ \t]*)?(?:我|他)[ \t]*[：:][ \t]*(?:[）)])?/u;
   let allowed=row.text;
   if(key==='pilotMessages'&&row.role==='user'){const match=marker.exec(allowed);if(match)allowed=allowed.slice(0,match.index)}
   if(!allowed.includes(entry.text)|| (key==='pilotMessages'&&row.role==='user'&&marker.test(entry.text)))fail(key+' 第 '+(i+1)+' 筆不是可保留的原文（劇情區塊不可混入）');
   seen.add(row.id);last=row.index;
   const id='predecessor:'+key+':'+source.chatId+':'+row.id;
   if(existingIds.has(id))fail('訊息 ID 與其他分頁衝突');
   const time=typeof row.sourceCreatedAt==='string'&&Number.isFinite(Date.parse(row.sourceCreatedAt))?row.sourceCreatedAt:null;
   return {id,role:row.role==='user'?'me':'ai',manager:row.role==='assistant'?pack.manager:'',text:entry.text,images:[],sourceCreatedAt:time,predecessorSource:{chatId:source.chatId,sha256:sha,id:row.id,index:row.index,attachments:structuredClone(row.attachments)}};
  });
 }
 const pilotMessages=logs('pilotMessages'),quizLogs=logs('quizLogs');
 if(!quizLogs.some(m=>m.role==='me')||!quizLogs.some(m=>m.role==='ai'))fail('10題必須包含玩家與 GPT 的實際紀錄');
 if(!Array.isArray(pack.easterEggs)||!pack.easterEggs.length)fail('彩蛋清單空白，拒絕覆蓋');
 const easterEggs=pack.easterEggs.map((e,i)=>{
  if(!obj(e)||!str(e.title)||!str(e.text)||!['confirmed','uncertain'].includes(e.status)||!Array.isArray(e.sourceIds)||!e.sourceIds.length||new Set(e.sourceIds).size!==e.sourceIds.length||!e.sourceIds.every(id=>map.has(id)))fail('彩蛋 '+(i+1)+' 缺少來源或確認狀態');
  return (i+1)+'. '+e.title+'（'+(e.status==='confirmed'?'已確認':'待確認')+'）\n'+e.text+'\n來源：'+e.sourceIds.join('、');
 }).join('\n\n');
 const updated={...structuredClone(r),pilotMessages,quizLogs,easterEggs};
 const counts={pilotBefore:(r.pilotMessages||[]).length,pilotAfter:pilotMessages.length,quizBefore:(r.quizLogs||[]).length,quizAfter:quizLogs.length,eggsBefore:(r.easterEggs||'').length,eggsAfter:easterEggs.length,eggCount:pack.easterEggs.length};
 return {updated,counts,sourceCount:source.count,sourceStatus:source.status,attachments:pilotMessages.concat(quizLogs).reduce((n,m)=>n+m.predecessorSource.attachments.length,0)};
}
function sameUnchanged(before,after){return equal(Object.fromEntries(Object.entries(before).filter(([k])=>!FIELDS.includes(k)&&k!=='updatedAt')),Object.fromEntries(Object.entries(after).filter(([k])=>!FIELDS.includes(k)&&k!=='updatedAt')))}
return {FORMAT,binding,plan,sameUnchanged};
});
