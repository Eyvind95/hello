/* Independent ChatGPT reading archive. No Gal AI canonical import or network. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GalPredecessorChat=api})(globalThis,()=>{
'use strict';
const FORMAT='gal-predecessor-chat',CLASS='gal-predecessor-classification',VERSION=1;
const categories=['交接稿','茶話會','評語與自評','稱號與事故','規則與設定','輪迴補充','其他','Gal AI正史引用（不另收錄正文）','待確認'];
const check=(v,m)=>{if(!v)throw Error(m)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=512;
function validateRows(rows){
 check(Array.isArray(rows),'訊息不是陣列');
 const ids=new Set();
 for(const r of rows){
  check(r&&validId(r.id)&&!ids.has(r.id)&&['user','assistant'].includes(r.role)&&typeof r.text==='string'&&Array.isArray(r.structure)&&Array.isArray(r.attachments)&&typeof r.identityBasis==='string'&&r.identityBasis&&r.identityBasis!=='position','訊息 ID、角色或內容格式不符');
  check(r.text.trim()||r.attachments.length,'空白訊息缺少可核對附件');
  check(r.structure.every(x=>x&&typeof x.tag==='string'&&typeof x.text==='string'),'格式記錄不符');
  check(r.attachments.every(x=>x&&typeof x.kind==='string'&&typeof x.label==='string'&&(x.url===null||typeof x.url==='string')),'附件參照格式不符');
  ids.add(r.id);
 }
 return ids;
}
// Every newly loaded window must overlap the exact current sequence.
// Only a contiguous prefix may be prepended in an upward scan.
function mergeUp(previous,live){
 validateRows(previous);validateRows(live);check(live.length,'目前沒有可讀訊息');
 if(!previous.length)return live.slice();
 const pos=new Map(previous.map((r,i)=>[r.id,i]));
 const known=live.map((r,i)=>({r,i,at:pos.get(r.id)})).filter(x=>x.at!==undefined);
 check(known.length,'視窗沒有重疊訊息');
 const first=known[0],last=known.at(-1);
 for(let j=0;j<known.length;j++){
  const x=known[j];check(x.i===first.i+j&&x.at===first.at+j,'重疊區域有缺口、重排或重複');
  check(same(x.r,previous[x.at]),'同一訊息 ID 的內容或格式改變');
 }
 check(last.i===live.length-1,'向上掃描發現原尾端之外的新訊息或分支');
 check(first.i===0||first.at===0,'新增訊息沒有接在已保全的最前端');
 return [...live.slice(0,first.i),...previous];
}
function sourceId(url){
 const u=new URL(url);check(u.origin==='https://chatgpt.com'&&/^\/(?:c\/[A-Za-z0-9-]+|g\/[^/]+\/c\/[A-Za-z0-9-]+)\/?$/.test(u.pathname)&&!u.search&&!u.hash,'聊天來源網址不符');
 return u.pathname.replace(/\/$/,'').split('/').at(-1);
}
function validateRaw(data){
 check(data?.format===FORMAT&&data.version===VERSION&&data.canonical===false&&data.fidelity==='rendered-dom'&&['completed','failed','cancelled'].includes(data.status),'不是前輩聊天獨立保全 JSON');
 check(validId(data.runId)&&validId(data.title)&&data.chatId===sourceId(data.sourceUrl),'聊天標題或來源 ID 不符');
 const start=Date.parse(data.startedAt),end=Date.parse(data.finishedAt);
 check(Number.isFinite(start)&&Number.isFinite(end)&&end>=start,'掃描時間無效');
 const ids=validateRows(data.rows);check(data.rows.every((r,i)=>r.index===i)&&data.count===data.rows.length,'訊息索引／總數不符');
 check(data.evidence&&Array.isArray(data.warnings)&&data.warnings.every(x=>typeof x==='string'),'缺少掃描證據');
 if(data.status==='completed')check(data.rows.length&&data.evidence.bottomStableMs>=3000&&data.evidence.topStableMs>=8000&&data.evidence.topReached===true&&data.evidence.bottomReached===true&&data.evidence.continuity===true&&data.evidence.firstId===data.rows[0].id&&data.evidence.lastId===data.rows.at(-1).id&&!data.error,'完成檔缺少首尾或連續性證據');
 return ids;
}
function validateClassification(raw,data,hash){
 const ids=validateRaw(raw);check(raw.status==='completed','未完成掃描不得當完整分類');
 check(data?.format===CLASS&&data.version===1&&data.chatId===raw.chatId&&data.sourceSha256===hash&&/^[a-f0-9]{64}$/.test(hash)&&Array.isArray(data.items),'分類檔與原始聊天版本不符');
 const seen=new Set();
 for(const item of data.items){
  check(item&&validId(item.id)&&!seen.has(item.id)&&categories.includes(item.category)&&typeof item.title==='string'&&item.title.trim()&&item.title.length<=300&&Array.isArray(item.messageIds)&&item.messageIds.length&&new Set(item.messageIds).size===item.messageIds.length&&item.messageIds.every(x=>ids.has(x)),'分類項目缺少有效原文證據');
  check(item.note===undefined||typeof item.note==='string'&&item.note.length<=3000,'分類說明過長或不符');
  check(!Object.hasOwn(item,'text')&&!Object.hasOwn(item,'body')&&!Object.hasOwn(item,'messages'),'分類只能引用，不得覆蓋原始正文');
  seen.add(item.id);
 }
 return {items:data.items.length,covered:new Set(data.items.flatMap(i=>i.messageIds)).size,total:raw.rows.length};
}
return {FORMAT,CLASS,VERSION,categories,validateRows,mergeUp,sourceId,validateRaw,validateClassification};
});
