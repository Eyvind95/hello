/* Explicit, offline archaeology revision planner. Ordinary import remains untouched. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./archive-pilot-import.js'):root.ArchivePilotImport,
 typeof module==='object'&&module.exports?require('node:crypto').webcrypto:root.crypto);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchivePilotRevision=api;
})(globalThis,function(normal,crypto){
'use strict';
const FORMAT='gal-predecessor-revision-bundle',VERSION=1;
const FIELDS=['pilotMessages','quizLogs','casinoLogs','realChatLogs','rejectedEvents'];
const HEX=/^[0-9a-f]{64}$/,str=x=>typeof x==='string'&&x.trim().length>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const fail=m=>{throw Error(m)};
function canonical(x){
 if(x===null||typeof x==='string'||typeof x==='boolean'||(typeof x==='number'&&Number.isFinite(x)))return JSON.stringify(x);
 if(Array.isArray(x)){if(Object.keys(x).length!==x.length)fail('非完整 JSON 陣列');return '['+x.map(canonical).join(',')+']'}
 if(!object(x))fail('非 JSON 資料，不可無損備份');
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
const same=(a,b)=>canonical(a)===canonical(b);
async function sha(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
const digest=x=>sha(canonical(x));
function rows(r,key){const a=r[key]??[];if(!Array.isArray(a))fail('既有分頁格式異常：'+key);const seen=new Set();for(const x of a){if(!object(x)||!str(x.id)||seen.has(x.id))fail('既有分頁 ID 不唯一：'+key);seen.add(x.id)}return a}
function empty(r){return {...structuredClone(r),...Object.fromEntries(FIELDS.map(k=>[k,[]])),easterEggs:''}}
function stableId(key,chat,id){return 'predecessor:'+key+':'+chat+':'+id}
const keyOf=(key,id)=>JSON.stringify([key,id]);
function materialize(r,source,pack,hash){
 return normal.plan(empty(r),source,pack,hash).updated;
}
function ownership(row,key,chat,id,manager){
 if(row.id!==stableId(key,chat,id)||row.predecessorSource?.chatId!==chat||row.predecessorSource?.id!==id||
 !['me','ai'].includes(row.role)||(row.role==='ai'?row.manager!==manager:row.manager!==''))fail('既有資料來源或管理者不符：'+key+' '+id);
}
const knownRow=new Set(['id','role','manager','text','images','sourceCreatedAt','predecessorSource','rejectedEvidence']);
const knownRef=new Set(['chatId','sha256','id','index','attachments','sourceFormat','sourceStatus','canonical','structure']);
const knownDecision=new Set(['status','canonical','title','decisionSourceId','decisionIndex','decisionText','decisionAttachments']);
function deletionSafe(row){
 if(!Array.isArray(row.images)||row.images.length)fail('移除衝突：既有人工附圖，禁止刪除 '+row.id);
 if(Object.keys(row).some(k=>!knownRow.has(k))||Object.keys(row.predecessorSource).some(k=>!knownRef.has(k))||
 (row.rejectedEvidence&&Object.keys(row.rejectedEvidence).some(k=>!knownDecision.has(k))))fail('移除衝突：含額外人工或未知欄位 '+row.id);
}
async function sourceMap(bundle){
 if(!Array.isArray(bundle.sources)||!bundle.sources.length)fail('缺少原始來源檔');
 const map=new Map();
 for(const s of bundle.sources){
  if(!object(s)||!HEX.test(s.sha256)||!str(s.sourceText)||map.has(s.sha256)||await sha(s.sourceText)!==s.sha256)fail('原始來源 SHA-256 不符或重複');
  let data;try{data=JSON.parse(s.sourceText.replace(/^\uFEFF/,''))}catch(e){fail('原始來源 JSON 無法解析')}
  map.set(s.sha256,data);
 }
 return map;
}
function oldEntry(field,row){
 const e={sourceId:row.predecessorSource.id,text:row.text};
 if(field==='rejectedEvents'){
  const d=row.rejectedEvidence;if(!object(d))fail('拒絕事件缺原決定證據');
  Object.assign(e,{decisionSourceId:d.decisionSourceId,decisionText:d.decisionText});
  if(d.title!=='未命名拒絕事件')e.title=d.title;
 }
 return e;
}
async function verifyOld(r,pack,field,row,expected,sources){
 if(!object(expected)||!HEX.test(expected.rowSha256)||!HEX.test(expected.sourceSha256)||typeof expected.text!=='string'||
 !Number.isSafeInteger(expected.index)||expected.text!==row.text||expected.sourceSha256!==row.predecessorSource.sha256||
 expected.index!==row.predecessorSource.index||await digest(row)!==expected.rowSha256)fail('舊正文、來源雜湊、索引或完整紀錄雜湊不符：'+row.id);
 const original=sources.get(expected.sourceSha256);
 if(!original||original.chatId!==pack.chatId)fail('缺少既有來源雜湊對應的原始檔：'+row.id);
 const oldPack={format:normal.FORMAT,version:2,target:normal.binding(r),chatId:pack.chatId,sourceSha256:expected.sourceSha256,manager:pack.manager,
 ...Object.fromEntries(FIELDS.map(k=>[k,k===field?[oldEntry(field,row)]:[]])),easterEggs:[]};
 const old=materialize(r,original,oldPack,expected.sourceSha256)[field][0];
 if(!old||old.id!==row.id||old.role!==row.role||old.manager!==row.manager||
 !same(old.predecessorSource,row.predecessorSource)||
 (field==='rejectedEvents'&&!same(old.rejectedEvidence,row.rejectedEvidence)))fail('既有來源參照未能從舊原件精確重建：'+row.id);
 if(!Array.isArray(row.images))fail('既有附件格式不明：'+row.id);
}
function assertNoForeignChange(before,after,allowed){
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(allowed.has(key))continue;
  if(!Object.hasOwn(before,key)||!Object.hasOwn(after,key)||!same(before[key],after[key]))fail('非目標欄位變更：'+key);
 }
}
// Insert only newly authorized rows. Existing records keep relative order,
// including other chats and unbound manual rows. Never globally sort.
function insertOwned(result,w,wantedMap,rank){
 const n=rank.get(w.id);let last=-1;
 for(let i=0;i<result.length;i++){
  const id=result[i].id;if(!wantedMap.has(id))continue;
  if(rank.get(id)>n){result.splice(i,0,structuredClone(w));return}
  last=i;
 }
 result.splice(last<0?result.length:last+1,0,structuredClone(w));
}
function verifyProjection(result,wanted){
 const ids=new Set(wanted.map(x=>x.id)),actual=result.filter(x=>ids.has(x.id)).map(x=>x.id);
 if(!same(actual,wanted.map(x=>x.id)))fail('目標來源順序衝突，不可重排既有紀錄');
}
async function inspect(records,bundle,receipt=null){
 if(!Array.isArray(records)||!object(bundle)||bundle.format!==FORMAT||bundle.version!==VERSION||!str(bundle.revisionId)||
 !Array.isArray(bundle.targets)||!bundle.targets.length)fail('修正版格式錯誤');
 const bundleSha256=await digest(bundle);
 if(receipt){
  if(receipt.revisionId!==bundle.revisionId||receipt.bundleSha256!==bundleSha256||receipt.status!=='applied'||
  !Array.isArray(receipt.targets)||receipt.targets.length!==bundle.targets.length)fail('修正版 ID 已使用或收據不符');
  for(const x of receipt.targets){
   const r=normal.resolveTarget(records,{target:x.target});
   if(await digest(r)!==x.afterSha256)fail('已套用後資料又變更，禁止自動重播或覆蓋');
  }
  return {status:'already-applied',revisionId:bundle.revisionId,bundleSha256,targets:[],changes:[]};
 }
 const sources=await sourceMap(bundle),targets=[],changes=[],cycleIds=new Set();
 for(const target of bundle.targets){
  const pack=target?.candidate;
  if(!object(pack)||pack.version!==2||!Array.isArray(target.operations)||!HEX.test(target.beforeSha256))fail('缺少完整 V2 候選、修正清冊或網站 R2 快照雜湊');
  const r=normal.resolveTarget(records,pack);
  if(cycleIds.has(r.id))fail('同一輪迴不可出現多份修正目標');
  cycleIds.add(r.id);
  if(await digest(r)!==target.beforeSha256)fail('網站 R2 實際快照已變更：'+r.title);
  const source=sources.get(pack.sourceSha256);
  if(!source)fail('找不到 R3 原始檔');
  const desired=materialize(r,source,pack,pack.sourceSha256),next=structuredClone(r),ops=new Map(),local=[];
  for(const op of target.operations){
   if(!object(op)||!FIELDS.includes(op.field)||!str(op.sourceId)||!['add','replace','remove'].includes(op.action))fail('非法分頁或操作');
   const k=keyOf(op.field,op.sourceId);if(ops.has(k))fail('重複修正操作');ops.set(k,op);
  }
  for(const field of FIELDS){
   const old=rows(r,field),wanted=rows(desired,field),wantedMap=new Map(wanted.map(x=>[x.id,x])),oldMap=new Map(old.map(x=>[x.id,x])),changed=new Map();
   for(const row of old){
    const ref=row.predecessorSource,owned=ref?.chatId===pack.chatId;
    // A forged stable ID must not claim an unrelated row.
    if(!owned){if(row.id.startsWith('predecessor:'+field+':'+pack.chatId+':'))fail('既有 ID 與聊天來源不符：'+row.id);continue}
    if(!str(ref.id))fail('來源 ID 缺失');ownership(row,field,pack.chatId,ref.id,pack.manager);
    const k=keyOf(field,ref.id),op=ops.get(k),w=wantedMap.get(row.id);
    if(!w&&!op)fail('候選省略既有紀錄，但沒有明確移除操作：'+row.id);
    if(!op){
     if(row.text!==w.text||row.role!==w.role||row.manager!==w.manager||
     (field==='rejectedEvents'&&!same(row.rejectedEvidence,w.rejectedEvidence)))fail('候選有未列入清冊的正文或證據差異：'+row.id);
     continue;
    }
    if(op.action==='add'||(op.action==='remove'&&w)||(op.action==='replace'&&!w))fail('清冊與 R3 候選不一致：'+row.id);
    await verifyOld(r,pack,field,row,op.old,sources);ops.delete(k);
    if(op.action==='remove'){deletionSafe(row);changed.set(row.id,null)}
    else{
     if(row.role!==w.role||row.manager!==w.manager||
      !same(row.predecessorSource.attachments,w.predecessorSource.attachments)||
      (field==='rejectedEvents'&&!same(row.rejectedEvidence.decisionAttachments,w.rejectedEvidence.decisionAttachments)))fail('替換涉及角色、管理者或附件參照衝突：'+row.id);
     if(Object.keys(row.predecessorSource).some(k=>!knownRef.has(k))||
      (row.rejectedEvidence&&Object.keys(row.rejectedEvidence).some(k=>!knownDecision.has(k))))fail('替換涉及未知來源欄位：'+row.id);
     changed.set(row.id,{...structuredClone(row),text:w.text,sourceCreatedAt:w.sourceCreatedAt,
      predecessorSource:structuredClone(w.predecessorSource),...(field==='rejectedEvents'?{rejectedEvidence:structuredClone(w.rejectedEvidence)}:{})});
    }
    local.push({field,sourceId:ref.id,index:ref.index,action:op.action,before:structuredClone(row),after:structuredClone(changed.get(row.id))});
   }
   const result=old.filter(x=>changed.get(x.id)!==null).map(x=>changed.has(x.id)?changed.get(x.id):structuredClone(x));
   const rank=new Map(wanted.map((w,i)=>[w.id,i]));
   const survivors=result.filter(x=>wantedMap.has(x.id));
   if(survivors.some((x,i)=>i>0&&rank.get(survivors[i-1].id)>=rank.get(x.id)))fail('既有來源順序異常，不可重排');
   for(const w of wanted){
    if(oldMap.has(w.id))continue;
    const k=keyOf(field,w.predecessorSource.id),op=ops.get(k);
    if(!op||op.action!=='add'||op.old!==null)fail('新增缺少明確清冊或舊值不是 null：'+w.id);
    ops.delete(k);insertOwned(result,w,wantedMap,rank);
    local.push({field,sourceId:w.predecessorSource.id,index:w.predecessorSource.index,action:'add',before:null,after:structuredClone(w)});
   }
   verifyProjection(result,wanted);
   // Equal-size replacement of membership must also be persisted.
   if(changed.size||result.length!==old.length)next[field]=result;
  }
  if(ops.size)fail('清冊有未找到的操作，不可猜測');
  // The legacy egg field is plain text, not source-keyed rows. Block edits
  // until a separate exact block ownership proof is available.
  const egg=r.easterEggs??'',block=desired.easterEggs;
  if(typeof egg!=='string')fail('彩蛋欄位不是文字');
  const header='【'+pack.manager+'・考古候選｜'+pack.chatId+'｜';
  if(block?!(egg===block||egg.startsWith(block+'\n\n')||egg.endsWith('\n\n'+block)||egg.includes('\n\n'+block+'\n\n')):egg.includes(header))fail('彩蛋變動須獨立核對文字區塊，第一階段禁止修改');
  assertNoForeignChange(r,next,new Set(FIELDS));
  targets.push({target:normal.binding(r),before:structuredClone(r),after:next,beforeSha256:target.beforeSha256,afterSha256:await digest(next)});
  changes.push(...local.map(x=>({...x,target:normal.binding(r),chatId:pack.chatId})));
 }
 return {status:'preview',revisionId:bundle.revisionId,bundleSha256,targets,changes};
}
// A storage adapter must provide a *single atomic* compare-and-swap of every
// target and durable receipt. It must never call the ordinary merge writer.
// No browser/cloud adapter is registered by this offline module.
function makeReceipt(p,afterTargets){
 return {format:'gal-predecessor-revision-receipt',version:1,status:'applied',revisionId:p.revisionId,bundleSha256:p.bundleSha256,
 targets:afterTargets.map(t=>({target:t.target,before:t.before,after:t.after,beforeSha256:t.beforeSha256,afterSha256:t.afterSha256}))};
}
async function apply(adapter,bundle,approved){
 if(approved?.status!=='preview')fail('必須先預覽並明確核准');
 const records=await adapter.read(),existing=await adapter.receipt(bundle.revisionId);
 const p=await inspect(records,bundle,existing);
 if(p.status==='already-applied')return p;
 if(p.bundleSha256!==approved.bundleSha256||!same(p.targets,approved.targets)||!same(p.changes,approved.changes))fail('預覽已失效');
 const targets=[];
 for(const t of p.targets){
  const after=structuredClone(t.after),old=Date.parse(t.before.updatedAt||'');
  after.updatedAt=new Date(Math.max(Date.now(),Number.isFinite(old)?old+1:0)).toISOString();
  targets.push({...t,after,afterSha256:await digest(after)});
 }
 const receipt=makeReceipt(p,targets);
 // Backup is a separately durable read-back verified copy of the actual R2.
 const backup={format:'gal-predecessor-revision-backup',version:1,revisionId:p.revisionId,bundleSha256:p.bundleSha256,targets:targets.map(t=>({target:t.target,before:t.before,beforeSha256:t.beforeSha256}))};
 const backupSha256=await digest(backup);
 await adapter.backup(p.revisionId,backup);
 if(await digest(await adapter.readBackup(p.revisionId))!==backupSha256)fail('備份讀回不符，未寫入');
 receipt.backupSha256=backupSha256;
 await adapter.cas(targets,receipt,null);
 const persisted=await adapter.read(),savedReceipt=await adapter.receipt(p.revisionId);
 if(!same(savedReceipt,receipt))fail('收據回讀不符，保留備份並停止');
 for(const t of targets)if(await digest(normal.resolveTarget(persisted,{target:t.target}))!==t.afterSha256)fail('資料回讀不符，保留備份並停止');
 return {status:'applied',receipt,changes:p.changes};
}
async function restore(adapter,revisionId){
 const rec=await adapter.receipt(revisionId),backup=await adapter.readBackup(revisionId);
 if(rec?.status!=='applied'||!backup||await digest(backup)!==rec.backupSha256)fail('還原備份或收據不符');
 const records=await adapter.read(),targets=[];
 for(const t of rec.targets){
  const r=normal.resolveTarget(records,{target:t.target});
  if(await digest(r)!==t.afterSha256)fail('套用後資料已變更，禁止整輪迴還原');
  const b=backup.targets.find(x=>x.target.cycleId===t.target.cycleId);
  if(!b||await digest(b.before)!==t.beforeSha256||!same(b.before,t.before))fail('備份內容不符');
  const after=structuredClone(b.before);after.updatedAt=new Date(Math.max(Date.now(),(Date.parse(r.updatedAt)||0)+1)).toISOString();
  targets.push({target:t.target,before:r,beforeSha256:t.afterSha256,after,afterSha256:await digest(after)});
 }
 const restored={...rec,status:'restored',restoredTargets:targets.map(t=>({target:t.target,afterSha256:t.afterSha256}))};
 await adapter.cas(targets,restored,rec);
 const persisted=await adapter.read();
 if(!same(await adapter.receipt(revisionId),restored))fail('還原收據回讀不符');
 for(const t of targets)if(await digest(normal.resolveTarget(persisted,{target:t.target}))!==t.afterSha256)fail('還原回讀不符');
 return {status:'restored',receipt:restored};
}
return {FORMAT,VERSION,FIELDS,canonical,digest,sha,inspect,apply,restore};
});
