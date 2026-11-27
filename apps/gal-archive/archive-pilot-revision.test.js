const test=require('node:test'),a=require('node:assert/strict'),normal=require('./archive-pilot-import.js'),api=require('./archive-pilot-revision.js');
async function fixture(){
 const r={id:'cycle-shared',world:'sentinel',title:'shared cycle',updatedAt:'2026-01-01T00:00:00.000Z',
 messages:[{id:'story',text:'canonical'}],events:[{id:'event',status:'accepted'}],changeLogs:[{id:'change'}],
 pilotMessages:[{id:'manual',text:'manual',images:[{id:'manual-image'}]}],quizLogs:[],casinoLogs:[],realChatLogs:[],rejectedEvents:[],easterEggs:'manual eggs'};
 const source={format:'gal-predecessor-chat',version:1,status:'completed',chatId:'chat-cat',count:3,rows:[
 {id:'assistant|message:fixture-a',index:0,role:'assistant',text:'misclassified',attachments:[]},
 {id:'user|turn:fixture-b',index:1,role:'user',text:'short and complete original',attachments:[]},
 {id:'assistant|message:fixture-c',index:2,role:'assistant',text:'new original',attachments:[{kind:'image-reference',name:'reference'}]}]};
 const sourceText=JSON.stringify(source),hash=await api.sha(sourceText);
 const [x,y,z]=source.rows.map(x=>x.id);
 const pack={format:normal.FORMAT,version:2,target:normal.binding(r),chatId:source.chatId,sourceSha256:hash,manager:'Cat',
 pilotMessages:[],quizLogs:[],casinoLogs:[{sourceId:y,text:'short'}],realChatLogs:[{sourceId:x,text:'misclassified'}],rejectedEvents:[],easterEggs:[]};
 const before=normal.plan(r,source,pack,hash).updated;
 before.realChatLogs.push({id:'predecessor:realChatLogs:chat-other:other',role:'ai',manager:'Other',text:'other',images:[{id:'other-image'}],predecessorSource:{chatId:'chat-other',id:'other',index:0,sha256:'f'.repeat(64),attachments:[]}});
 before.casinoLogs[0].images=[{id:'keep-image'}];
 before.casinoLogs[0].userNote='keep annotation';
 const candidate={...pack,casinoLogs:[{sourceId:y,text:source.rows[1].text}],realChatLogs:[],pilotMessages:[{sourceId:z,text:'new original'}]};
 const old=async row=>({text:row.text,index:row.predecessorSource.index,sourceSha256:row.predecessorSource.sha256,rowSha256:await api.digest(row)});
 const bundle={format:api.FORMAT,version:1,revisionId:'fixture-R3',sources:[{sha256:hash,sourceText}],targets:[{beforeSha256:await api.digest(before),candidate,operations:[
 {field:'realChatLogs',sourceId:x,action:'remove',old:await old(before.realChatLogs[0])},
 {field:'casinoLogs',sourceId:y,action:'replace',old:await old(before.casinoLogs[0])},
 {field:'pilotMessages',sourceId:z,action:'add',old:null}]}]};
 return {before,bundle,source,hash,pack,candidate,old};
}
function storage(initial){
 let records=structuredClone(initial),receipts=new Map(),backups=new Map();
 const s={writes:0,failBackup:false,conflict:false,read:async()=>structuredClone(records),receipt:async id=>structuredClone(receipts.get(id)??null),
 backup:async(id,value)=>{if(backups.has(id))a.deepEqual(backups.get(id),value);else backups.set(id,structuredClone(value))},
 readBackup:async id=>s.failBackup?null:structuredClone(backups.get(id)),
 cas:async(targets,receipt,expected)=>{
  if(s.conflict)throw Error('CAS conflict');
  a.deepEqual(receipts.get(receipt.revisionId)??null,expected);
  for(const t of targets)a.equal(await api.digest(records.find(r=>r.id===t.target.cycleId)),t.beforeSha256);
  records=records.map(r=>structuredClone(targets.find(t=>t.target.cycleId===r.id)?.after??r));receipts.set(receipt.revisionId,structuredClone(receipt));s.writes++;
 },edit(fn){fn(records)}};
 return s;
}
test('ordinary importer still reproduces both original defects; revision repairs only explicit scope',async()=>{
 const f=await fixture(),{before,bundle,source,hash,pack,candidate}=f;
 const removeOnly={...pack,realChatLogs:[]};
 a.equal(normal.plan(before,source,removeOnly,hash).updated.realChatLogs.length,2);
 a.throws(()=>normal.plan(before,source,candidate,hash),/既有同來源文字不同/);
 const copy=structuredClone(before),p=await api.inspect([before],bundle);
 a.deepEqual(before,copy);a.equal(p.changes.length,3);const r=p.targets[0].after;
 a.deepEqual(r.realChatLogs,[before.realChatLogs[1]]);
 a.equal(r.casinoLogs[0].text,source.rows[1].text);a.deepEqual(r.casinoLogs[0].images,before.casinoLogs[0].images);
 a.equal(r.casinoLogs[0].userNote,'keep annotation');
 a.deepEqual(r.pilotMessages[0],before.pilotMessages[0]);a.deepEqual(r.pilotMessages[1].predecessorSource.attachments,source.rows[2].attachments);
 for(const k of ['messages','events','changeLogs','easterEggs'])a.deepEqual(r[k],before[k]);
});
test('refuse wrong target, digest, old content, row hash, foreign ownership and unlisted deletion',async()=>{
 for(const mutate of [
  b=>b.targets[0].candidate.target.worldKey='wrong',
  b=>b.targets[0].candidate.target.cycleId='wrong',
  b=>b.targets[0].candidate.chatId='wrong',
  b=>b.sources[0].sourceText+=' ',
  b=>b.targets[0].beforeSha256='f'.repeat(64),
  b=>b.targets[0].operations[0].old.text='edited',
  b=>b.targets[0].operations[0].old.sourceSha256='f'.repeat(64),
  b=>b.targets[0].operations[0].old.rowSha256='f'.repeat(64),
  b=>b.targets[0].operations[0].old.index=9,
  b=>b.targets[0].operations.shift(),
  b=>b.targets[0].operations[0].field='messages',
  b=>b.targets[0].operations[0].sourceId='other',
  b=>b.targets[0].operations.push(b.targets[0].operations[0]),
  b=>b.targets[0].candidate.casinoLogs[0].text='invented',
  b=>b.targets[0].candidate.easterEggs=[{title:'new',text:'new',status:'confirmed',sourceIds:['assistant|message:fixture-a']}]
 ]){
  const {before,bundle}=await fixture();mutate(bundle);await a.rejects(api.inspect([before],bundle));
 }
});
test('removal of image or unknown manual annotation is rejected even with valid old hash',async()=>{
 for(const patch of [{images:[{id:'image'}]},{userNote:'manual'}]){
  const {before,bundle,old}=await fixture();Object.assign(before.realChatLogs[0],patch);
  bundle.targets[0].beforeSha256=await api.digest(before);bundle.targets[0].operations[0].old=await old(before.realChatLogs[0]);
  await a.rejects(api.inspect([before],bundle),/移除衝突/);
 }
});
test('backup verified before atomic CAS, readback, repeat receipt, and conditional restore',async()=>{
 const {before,bundle}=await fixture(),other={id:'other-cycle',world:'other',title:'other',notes:'preserved'},s=storage([before,other]);
 const p=await api.inspect(await s.read(),bundle);
 s.failBackup=true;await a.rejects(api.apply(s,bundle,p),/備份讀回不符/);a.equal(s.writes,0);
 s.failBackup=false;s.conflict=true;await a.rejects(api.apply(s,bundle,p),/CAS conflict/);a.equal(s.writes,0);
 s.conflict=false;const done=await api.apply(s,bundle,p);a.equal(done.status,'applied');a.equal(s.writes,1);
 a.deepEqual((await s.read())[1],other);
 a.equal((await api.apply(s,bundle,p)).status,'already-applied');a.equal(s.writes,1);
 const restored=await api.restore(s,bundle.revisionId);a.equal(restored.status,'restored');a.equal(s.writes,2);
 const r=(await s.read())[0];a.deepEqual({...r,updatedAt:before.updatedAt},before);
 await a.rejects(api.apply(s,bundle,p),/收據不符/);
});
test('concurrent change invalidates preview and post-apply change blocks replay/rollback',async()=>{
 const {before,bundle}=await fixture(),s=storage([before]);const p=await api.inspect(await s.read(),bundle);
 s.edit(r=>r[0].notes='new manual');await a.rejects(api.apply(s,bundle,p),/快照已變更/);a.equal(s.writes,0);
 const t=storage([before]);await api.apply(t,bundle,p);t.edit(r=>r[0].notes='post-apply manual');
 await a.rejects(api.apply(t,bundle,p),/資料又變更/);await a.rejects(api.restore(t,bundle.revisionId),/資料已變更/);a.equal(t.writes,1);
});
test('multi-cycle failure prevents every write; duplicate target blocked',async()=>{
 const {before,bundle}=await fixture(),s=storage([before]);
 bundle.targets.push({...structuredClone(bundle.targets[0]),candidate:{...bundle.targets[0].candidate,target:{worldKey:'wrong',cycleId:'missing',cycleTitle:'wrong'}}});
 await a.rejects(api.inspect(await s.read(),bundle));a.equal(s.writes,0);
 bundle.targets[1]=structuredClone(bundle.targets[0]);await a.rejects(api.inspect(await s.read(),bundle),/同一輪迴/);
});
