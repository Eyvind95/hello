/* Isolated IndexedDB transaction adapter. No production registration. */
(function(root,factory){const api=factory(root.ArchivePilotRevision);if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchivePilotRevisionIDB=api})(globalThis,function(core){
'use strict';
const C='cycles',B='revisionBackups',R='revisionReceipts';
const fail=m=>{throw Error(m)},same=(a,b)=>core.canonical(a)===core.canonical(b);
function open(name){
 if(!/^gal-archive-revision-test-[a-z0-9-]{1,100}$/.test(name))return Promise.reject(Error('只允許隔離驗收資料庫，不可開啟正式資料庫'));
 return new Promise((resolve,reject)=>{const req=indexedDB.open(name,1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore(C,{keyPath:'id'});db.createObjectStore(B,{keyPath:'revisionId'});db.createObjectStore(R,{keyPath:'revisionId'})};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('資料庫升級受阻'));req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(db)}});
}
function tx(db,stores,mode,work){return new Promise((resolve,reject)=>{
 let t,value,error;try{t=db.transaction(stores,mode,{durability:mode==='readwrite'?'strict':'default'})}catch(e){reject(e);return}
 const stop=e=>{error=e instanceof Error?e:Error(String(e));try{t.abort()}catch(_){}};
 const ok=v=>{value=v};const guard=fn=>event=>{try{fn(event)}catch(e){stop(e)}};
 t.oncomplete=()=>error?reject(error):resolve(value);t.onabort=()=>reject(error||t.error||Error('IndexedDB 交易中止'));t.onerror=()=>{};
 try{work(t,ok,guard,stop)}catch(e){stop(e)}
})}
function connect(db){
 if(!/^gal-archive-revision-test-[a-z0-9-]{1,100}$/.test(db.name))fail('禁止正式資料庫寫入');
 for(const key of [C,B,R])if(!db.objectStoreNames.contains(key))fail('交易資料庫結構不符');
 const get=(store,key)=>tx(db,[store],'readonly',(t,ok,g)=>{const r=key===undefined?t.objectStore(store).getAll():t.objectStore(store).get(key);r.onsuccess=g(()=>ok(r.result??null))});
 return {
  read:()=>get(C),receipt:id=>get(R,id),readBackup:id=>get(B,id),
  backup(id,value){if(value.revisionId!==id)fail('備份 ID 不符');return tx(db,[B],'readwrite',(t,ok,g)=>{const s=t.objectStore(B),r=s.get(id);r.onsuccess=g(()=>{if(r.result!==undefined){if(!same(r.result,value))fail('禁止覆蓋原始備份')}else s.add(structuredClone(value));ok(true)})})},
  cas(targets,receipt,expected){
   if(!Array.isArray(targets)||!targets.length||new Set(targets.map(x=>x.target.cycleId)).size!==targets.length)fail('交易目標不唯一');
   // All WebCrypto awaits occur before the transaction. Exact synchronous
   // canonical comparisons in callbacks keep the transaction active.
   return tx(db,[C,R,B],'readwrite',(t,ok,g)=>{
    const c=t.objectStore(C),r=t.objectStore(R),b=t.objectStore(B),checks=[];let pending=targets.length+2;
    const finish=()=>{if(--pending)return;for(const check of checks)check();for(const target of targets)c.put(structuredClone(target.after));r.put(structuredClone(receipt));ok(true)};
    for(const target of targets){const req=c.get(target.target.cycleId);req.onsuccess=g(()=>{const actual=req.result;checks.push(()=>{if(!actual||!same(actual,target.before)||target.after.id!==target.target.cycleId||target.after.world!==target.target.worldKey||target.after.title!==target.target.cycleTitle)fail('CAS conflict: 輪迴已變更或目標不符')});finish()})}
    const rr=r.get(receipt.revisionId);rr.onsuccess=g(()=>{const prior=rr.result??null;checks.push(()=>{if(!same(prior,expected))fail('CAS conflict: 收據已變更')});finish()});
    const br=b.get(receipt.revisionId);br.onsuccess=g(()=>{const backup=br.result;checks.push(()=>{if(!backup||backup.bundleSha256!==receipt.bundleSha256||backup.revisionId!==receipt.revisionId||!same(backup.targets,receipt.targets.map(x=>({target:x.target,before:x.before,beforeSha256:x.beforeSha256}))))fail('CAS conflict: 備份不符')});finish()});
   });
  }
 };
}
return {open,connect};
});
