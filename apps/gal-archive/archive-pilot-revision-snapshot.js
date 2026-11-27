/* Read-only actual-site snapshot collector; not loaded by the production site. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./archive-pilot-revision.js'):root.ArchivePilotRevision);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchivePilotRevisionSnapshot=api})(globalThis,function(core){
'use strict';
const fail=m=>{throw Error(m)},same=(a,b)=>core.canonical(a)===core.canonical(b),C='cycles',W='worlds';
function localRead(db){return new Promise((resolve,reject)=>{
 if(db.name!=='gal-reincarnation-archive'||![C,W].every(k=>db.objectStoreNames.contains(k)))return reject(Error('非正式網站資料庫結構'));
 const t=db.transaction([C,W],'readonly'),c=t.objectStore(C).getAll(),w=t.objectStore(W).getAll();
 t.oncomplete=()=>resolve({cycles:c.result,worlds:w.result});t.onabort=()=>reject(t.error||Error('唯讀交易中止'));t.onerror=()=>{};
})}
async function server(ref){const s=await ref.get({source:'server'});if(s.metadata?.fromCache!==false||s.metadata?.hasPendingWrites!==false)fail('雲端回讀不是乾淨的 server snapshot');return s}
function identity(list){const seen=new Set();for(const r of list){if(typeof r.id!=='string'||!r.id||seen.has(r.id))fail('輪迴／世界觀 ID 不唯一');seen.add(r.id)}}
async function cloudRead(root){
 const cs=await server(root.collection(C)),ws=await server(root.collection(W)),cycles=[],manifests=[],worlds=[];
 for(const d of ws.docs){const w=d.data();if(w.id!==d.id)fail('雲端世界觀 ID 不符');worlds.push(w)}
 for(const d of cs.docs){
  const m=d.data();if(m.id!==d.id||!Number.isSafeInteger(m.partCount)||m.partCount<1)fail('雲端輪迴索引異常');
  const p=await server(d.ref.collection('parts'));
  if(p.docs.length!==m.partCount)fail('雲端分片數量不符');
  const parts=p.docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>a.index-b.index);
  if(parts.some((x,i)=>x.id!==String(i).padStart(6,'0')||x.index!==i||typeof x.data!=='string'))fail('雲端分片索引不符');
  const item=JSON.parse(parts.map(x=>x.data).join(''));
  if(item.id!==d.id||item.world!==m.world||item.title!==m.title||item.updatedAt!==m.updatedAt)fail('雲端索引與內容不符');
  const after=await server(d.ref);if(!after.exists||!same(after.data(),m))fail('雲端回讀期間索引已變更');
  manifests.push({id:d.id,manifest:m,partSha256:await core.digest(parts)});cycles.push(item);
 }
 identity(cycles);identity(worlds);
 const sort=a=>a.sort((a,b)=>a.id.localeCompare(b.id));return {cycles:sort(cycles),worlds:sort(worlds),manifests:sort(manifests)};
}
const normalize=x=>({cycles:[...x.cycles].sort((a,b)=>a.id.localeCompare(b.id)),worlds:[...x.worlds].sort((a,b)=>a.id.localeCompare(b.id))});
async function capture({db,firestore,currentUser,targets,isBusy=()=>true}){
 if(!Array.isArray(targets)||!targets.length||new Set(targets.map(x=>x.cycleId)).size!==targets.length)fail('缺少唯一輪迴綁定');
 if(typeof currentUser!=='function'||typeof isBusy!=='function'||isBusy())fail('必須先停止同步及資料操作');
 const uid=currentUser()?.uid;if(!uid)fail('請先以原有 Google 登入');
 const guard=()=>{if(currentUser()?.uid!==uid||isBusy())fail('取證期間登入或同步狀態變更')};
 const root=firestore.collection('galArchive').doc(uid),startedAt=new Date().toISOString();
 guard();const l1=normalize(await localRead(db));guard();const r1=await cloudRead(root);guard();const r2=await cloudRead(root);guard();const l2=normalize(await localRead(db));guard();
 if(!same(l1,l2)||!same(r1,r2))fail('雙次回讀不一致；禁止建立正式快照');
 identity(l1.cycles);identity(l1.worlds);
 const entries=[];for(const t of targets){
  const local=l1.cycles.find(x=>x.id===t.cycleId),cloud=r1.cycles.find(x=>x.id===t.cycleId);
  if(!local||!cloud||[local,cloud].some(x=>x.world!==t.worldKey||x.title!==t.cycleTitle))fail('目標輪迴本機／雲端綁定不符');
  entries.push({target:t,local,cloud,localSha256:await core.digest(local),cloudSha256:await core.digest(cloud),equal:same(local,cloud)});
 }
 const inventory=async list=>Promise.all(list.map(async x=>({id:x.id,sha256:await core.digest(x)})));
 const snapshot={format:'gal-predecessor-revision-site-snapshot',version:1,mode:'read-only-double-read',startedAt,finishedAt:new Date().toISOString(),accountSha256:await core.sha(uid),targets:entries,
  inventories:{localCycles:await inventory(l1.cycles),cloudCycles:await inventory(r1.cycles),localWorlds:await inventory(l1.worlds),cloudWorlds:await inventory(r1.worlds),cloudManifests:await inventory(r1.manifests)}};
 guard();return {...snapshot,snapshotSha256:await core.digest(snapshot)};
}
return {capture};
});
