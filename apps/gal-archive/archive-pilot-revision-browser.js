/* Browser-only test: synthetic fixtures, real IndexedDB transactions. */
(async()=>{
const api=ArchivePilotRevision,normal=ArchivePilotImport,idb=ArchivePilotRevisionIDB;
const equal=(a,b)=>api.canonical(a)===api.canonical(b),check=(v,msg)=>{if(!v)throw Error(msg)},tests=[];
const reject=async(fn,pat)=>{try{await fn()}catch(e){check(pat.test(e.message),e.message);return}throw Error('expected rejection')};
const source={format:'gal-predecessor-chat',version:1,status:'completed',chatId:'fixture-chat',count:5,rows:[
 {id:'a0',index:0,role:'assistant',text:'first',attachments:[]},
 {id:'a1',index:1,role:'assistant',text:'middle',attachments:[]},
 {id:'a2',index:2,role:'assistant',text:'last',attachments:[]},
 {id:'u3',index:3,role:'user',text:'short complete',attachments:[]},
 {id:'a4',index:4,role:'assistant',text:'misfiled',attachments:[]}]};
const sourceText=JSON.stringify(source),hash=await api.sha(sourceText),records=[],targets=[];
for(const id of ['fixture-cycle-1','fixture-cycle-2']){
 const base={id,world:'fixture-world',title:id,updatedAt:'2026-01-01T00:00:00.000Z',messages:[{id:'canonical-'+id,text:'keep'}],events:[{id:'accepted-'+id,status:'accepted'}],easterEggs:'manual eggs',pilotMessages:[],quizLogs:[],casinoLogs:[],realChatLogs:[],rejectedEvents:[]};
 const pack={format:normal.FORMAT,version:2,target:normal.binding(base),chatId:source.chatId,sourceSha256:hash,manager:'Fixture',pilotMessages:[{sourceId:'a0',text:'first'},{sourceId:'a2',text:'last'}],quizLogs:[],casinoLogs:[{sourceId:'u3',text:'short'}],realChatLogs:[{sourceId:'a4',text:'misfiled'}],rejectedEvents:[],easterEggs:[]};
 const before=normal.plan(base,source,pack,hash).updated;
 before.pilotMessages.splice(1,0,{id:'foreign-'+id,text:'foreign',images:[{id:'image'}]});
 before.casinoLogs[0].images=[{id:'keep-image'}];
 const candidate={...pack,pilotMessages:[{sourceId:'a0',text:'first'},{sourceId:'a1',text:'middle'},{sourceId:'a2',text:'last'}],casinoLogs:[{sourceId:'u3',text:'short complete'}],realChatLogs:[]};
 const old=async x=>({text:x.text,index:x.predecessorSource.index,sourceSha256:x.predecessorSource.sha256,rowSha256:await api.digest(x)});
 targets.push({beforeSha256:await api.digest(before),candidate,operations:[{field:'pilotMessages',sourceId:'a1',action:'add',old:null},{field:'casinoLogs',sourceId:'u3',action:'replace',old:await old(before.casinoLogs[0])},{field:'realChatLogs',sourceId:'a4',action:'remove',old:await old(before.realChatLogs[0])}]});
 records.push(before);
}
records.push({id:'fixture-non-target',world:'other',title:'other',notes:'must not change'});
const bundle={format:api.FORMAT,version:1,revisionId:'fixture-browser-revision',sources:[{sha256:hash,sourceText}],targets};
const name='gal-archive-revision-test-browser-'+crypto.randomUUID(),db=await idb.open(name),adapter=idb.connect(db),other=await idb.open(name);
const write=(db,rs)=>new Promise((resolve,reject)=>{const tx=db.transaction('cycles','readwrite');for(const r of rs)tx.objectStore('cycles').put(r);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
await write(db,records);const original=await adapter.read(),preview=await api.inspect(original,bundle);
check(preview.changes.length===6,'six operations');
const edit=structuredClone(original[0]);edit.notes='edit after preview';await write(other,[edit]);
await reject(()=>api.apply(adapter,bundle,preview),/快照已變更/);check((await adapter.receipt(bundle.revisionId))===null,'stale preview receipt');check(equal((await adapter.read()).find(x=>x.id===edit.id),edit),'manual edit lost');tests.push('preview concurrent edit blocked');
await write(other,[original[0]]);
const changed=structuredClone(original[1]);changed.notes='race after backup';
const racing={...adapter,cas:async(...args)=>{await write(other,[changed]);return adapter.cas(...args)}};
await reject(()=>api.apply(racing,bundle,preview),/CAS conflict/);check(equal((await adapter.read()).find(x=>x.id===original[0].id),original[0]),'partial commit on other cycle');check((await adapter.receipt(bundle.revisionId))===null,'partial receipt');tests.push('real multi-cycle CAS conflict after verified backup');
await write(other,[original[1]]);
const out=await api.apply(adapter,bundle,preview);check(out.status==='applied'&&out.changes.length===6,'apply');
check((await api.apply(adapter,bundle,preview)).status==='already-applied','repeat');tests.push('real IDB transaction and idempotence');
const saved=await adapter.read(),receipt=await adapter.receipt(bundle.revisionId),backup=await adapter.readBackup(bundle.revisionId);
check(await api.digest(backup)===receipt.backupSha256,'backup hash');
for(const t of receipt.targets){
 const row=saved.find(x=>x.id===t.target.cycleId);check(await api.digest(row)===t.afterSha256,'persisted hash');
 check(equal(row.pilotMessages.map(x=>x.predecessorSource?.id||x.id),['a0','foreign-'+row.id,'a1','a2']),'historical order');
 check(equal(row.casinoLogs[0].images,[{id:'keep-image'}]),'image lost');
 check(equal(row.messages,t.before.messages)&&equal(row.events,t.before.events)&&row.easterEggs===t.before.easterEggs,'non-target fields');
}
check(equal(saved.find(x=>x.id==='fixture-non-target'),original.find(x=>x.id==='fixture-non-target')),'non-target cycle changed');
db.close();other.close();const reopened=await idb.open(name),a2=idb.connect(reopened);check(equal(await a2.read(),saved),'readback after reopening');tests.push('durable backup/receipt, ordering and non-target readback');
const later=structuredClone(saved[0]);later.notes='post-apply manual edit';await write(reopened,[later]);await reject(()=>api.restore(a2,bundle.revisionId),/資料已變更/);check(equal((await a2.read()).find(x=>x.id===later.id),later),'post edit lost');tests.push('conditional rollback rejects later edit');
await write(reopened,[saved[0]]);const undone=await api.restore(a2,bundle.revisionId);check(undone.status==='restored','rollback status');const restored=await a2.read();
for(const r of original){const x=restored.find(x=>x.id===r.id);if(r.updatedAt)check(equal({...x,updatedAt:r.updatedAt},r),'rollback mismatch');else check(equal(x,r),'non-target rollback mismatch')}
await reject(()=>api.apply(a2,bundle,preview),/收據不符/);tests.push('real rollback and replay rejection');
await reject(()=>idb.open('gal-reincarnation-archive'),/隔離/);tests.push('production database blocked');reopened.close();
return {ok:true,tests,operations:6,baseline:'synthetic-only'};
})().then(result=>{globalThis.revisionBrowserResult=result},e=>{globalThis.revisionBrowserResult={ok:false,error:e.stack||String(e)}});
