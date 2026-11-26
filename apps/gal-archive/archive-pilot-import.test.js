const test=require('node:test'),assert=require('node:assert/strict'),api=require('./archive-pilot-import.js');
const sha='a'.repeat(64);
function fixture(){const r={id:'cycle-13',world:'sentinel',title:'凱文',messages:[{id:'story',text:'不動'}],events:[{id:'event',status:'accepted'}],opening:'開場',changeLogs:[],pilotMessages:[{id:'old'}],quizLogs:[{id:'old-q'}],easterEggs:'舊彩蛋',notes:'保留'};
 const source={format:'gal-predecessor-offline-reconciliation-candidate',version:1,status:'offline-candidate-unverified-formal',chatId:'chat-a',count:4,rows:[
 {id:'u1',index:0,role:'user',text:'前置評論\n我：\n劇情\n他：\n回覆',attachments:[]},
 {id:'a1',index:1,role:'assistant',text:'副駕駛回應',attachments:[]},
 {id:'u2',index:2,role:'user',text:'第一題：題目',attachments:[]},
 {id:'a2',index:3,role:'assistant',text:'作答',attachments:[]}]};
 const pack={format:api.FORMAT,version:1,target:api.binding(r),chatId:source.chatId,sourceSha256:sha,manager:'前輩',pilotMessages:[{sourceId:'u1',text:'前置評論'},{sourceId:'a1',text:'副駕駛回應'}],quizLogs:[{sourceId:'u2',text:'第一題：題目'},{sourceId:'a2',text:'作答'}],easterEggs:[{title:'彩蛋',text:'已核對',status:'confirmed',sourceIds:['a1']}]};
 return {r,source,pack}}
test('scoped overwrite preserves unrelated fields and original source',()=>{const {r,source,pack}=fixture(),before=JSON.stringify(r),raw=JSON.stringify(source);const p=api.plan(r,source,pack,sha);assert.equal(JSON.stringify(r),before);assert.equal(JSON.stringify(source),raw);assert.ok(api.sameUnchanged(r,p.updated));assert.equal(p.updated.pilotMessages[1].text,'前置評論');assert.equal(p.updated.quizLogs[1].role,'me');assert.equal(p.updated.quizLogs[2].manager,'前輩');assert.match(p.updated.easterEggs,/來源：a1/);assert.equal(p.updated.pilotMessages[1].sourceCreatedAt,null);assert.equal(p.counts.pilotAfter,3)});
test('reject cross-world, cross-cycle, title, source digest and wrong chat',()=>{for(const key of ['worldKey','cycleId','cycleTitle']){const {r,source,pack}=fixture();pack.target[key]='wrong';assert.throws(()=>api.plan(r,source,pack,sha),/輪迴/)}for(const key of ['sourceSha256','chatId']){const {r,source,pack}=fixture();pack[key]='wrong';assert.throws(()=>api.plan(r,source,pack,sha),/SHA/)}});
test('reject fabricated, duplicated, out-of-order, embedded story, missing evidence and empty overwrite',()=>{for(const mutate of [p=>p.pilotMessages[0].text='劇情',p=>p.pilotMessages[0].text='虛構',p=>p.pilotMessages.push(p.pilotMessages[0]),p=>p.pilotMessages.reverse(),p=>p.easterEggs[0].sourceIds=['unknown'] ,p=>p.pilotMessages=[]]){const {r,source,pack}=fixture();mutate(pack);assert.throws(()=>api.plan(r,source,pack,sha))}});
test('idempotent message IDs, preserved source references but not invented image bytes',()=>{const {r,source,pack}=fixture();source.rows[0].attachments=[{kind:'image-reference',url:'blob:example'}];const a=api.plan(r,source,pack,sha),b=api.plan(a.updated,source,pack,sha);assert.deepEqual(a.updated,b.updated);assert.deepEqual(a.updated.pilotMessages[1].images,[]);assert.equal(a.attachments,1);assert.equal(a.updated.pilotMessages[1].predecessorSource.attachments.length,1)});

test('website wires scoped import and PWA cache, inline code parses',()=>{const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),sw=fs.readFileSync(path.join(__dirname,'sw.js'),'utf8');assert.match(html,/id="pilotArchiveImport"/);assert.match(html,/openPilotArchiveImport\(r\)/);assert.match(html,/archive-pilot-import\.js\?v=4/);assert.match(sw,/archive-pilot-import\.js\?v=4/);for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});

test('co-managed cycles retain all legacy rows, images and existing eggs, empty quiz is no-op',()=>{const {r,source,pack}=fixture();r.pilotMessages=[{id:'iron',role:'ai',manager:'鐵墓前輩',text:'原紀錄',images:[{id:'img'}]},{id:'player',role:'me',text:'不明歸屬'}];r.quizLogs=[{id:'dark',role:'ai',manager:'暗夢前輩',text:'原考核'}];pack.quizLogs=[];const p=api.plan(r,source,pack,sha);assert.deepEqual(p.updated.pilotMessages.slice(0,2),r.pilotMessages);assert.deepEqual(p.updated.quizLogs,r.quizLogs);assert.equal(p.merge.quizMissing,true);assert.ok(p.updated.easterEggs.startsWith(r.easterEggs));assert.deepEqual(api.plan(p.updated,source,pack,sha).updated,p.updated)});
test('same stable ID but edited text or foreign provenance never overwrites',()=>{const {r,source,pack}=fixture();const p=api.plan(r,source,pack,sha);p.updated.pilotMessages[1].text='手動改過';assert.throws(()=>api.plan(p.updated,source,pack,sha),/文字不同/);p.updated.pilotMessages[1].text=pack.pilotMessages[0].text;p.updated.pilotMessages[1].predecessorSource.chatId='other';assert.throws(()=>api.plan(p.updated,source,pack,sha),/來源不符/)});

function joinedFixture(){
 const {r,source:old,pack}=fixture();
 const candidateRows=[...old.rows,{id:'a3',index:4,role:'assistant',text:'後段完整顯示',attachments:[]},{id:'assistant|composite:ambiguous',index:5,role:'assistant',text:'不可自行拆分',attachments:[],identityBasis:'unresolved-native-composite',compositeNative:{ids:['a','b']}}].map(row=>({...row,structure:[]}));
 const source={format:'gal-predecessor-prefix-supplement-evidence',version:1,status:'joined-evidence',canonical:false,importable:false,continuity:false,fidelity:'rendered-dom',error:null,runId:'new-run',chatId:old.chatId,count:4,rows:structuredClone(candidateRows.slice(0,4)),candidateRows,base:{runId:'old-run',count:4,firstId:'u2',sha256:'b'.repeat(64)},evidence:{openingVerified:true,originalCheckpointUnchanged:true,lastConflict:null,expectedId:'u1',added:2,matched:2,joinedCandidateCount:6}};
 pack.pilotMessages.push({sourceId:'a3',text:'後段完整顯示'});
 return {r,source,pack};
}
test('joined prefix evidence uses complete candidate rows without changing source or legacy shared data',()=>{
 const {r,source,pack}=joinedFixture();
 r.pilotMessages=[{id:'iron',manager:'鐵墓前輩',role:'ai',text:'舊資料',images:[{id:'image'}]},{id:'legacy-user',role:'me',text:'不明歸屬'}];
 r.quizLogs=[{id:'dark',manager:'暗夢前輩',role:'ai',text:'舊考核'}];
 const before=structuredClone(r),raw=structuredClone(source),p=api.plan(r,source,pack,sha);
 assert.deepEqual(r,before);assert.deepEqual(source,raw);assert.ok(api.sameUnchanged(r,p.updated));
 assert.equal(p.sourceCount,6);assert.deepEqual(p.sourceEvidence,{joined:true,localCount:4,isolated:1,canonical:false});
 assert.deepEqual(p.updated.pilotMessages.slice(0,2),before.pilotMessages);assert.deepEqual(p.updated.quizLogs[0],before.quizLogs[0]);
 assert.equal(p.updated.pilotMessages.at(-1).text,'後段完整顯示');
 assert.equal(p.updated.pilotMessages.at(-1).predecessorSource.sha256,sha);
 assert.equal(p.updated.pilotMessages.at(-1).predecessorSource.sourceFormat,source.format);
 assert.equal(p.updated.pilotMessages.at(-1).predecessorSource.canonical,false);
 assert.deepEqual(api.plan(p.updated,source,pack,sha).updated,p.updated);
});
test('joined evidence rejects incomplete, mismatched, fabricated or relabeled snapshots',()=>{
 for(const mutate of [
  s=>s.status='failed',s=>s.canonical=true,s=>s.importable=true,s=>s.continuity=true,s=>s.fidelity='native',s=>s.error='failed',
  s=>s.evidence.openingVerified=false,s=>s.evidence.originalCheckpointUnchanged=false,s=>s.evidence.lastConflict={},
  s=>s.evidence.expectedId='wrong',s=>s.evidence.added=1,s=>s.evidence.matched=1,s=>s.evidence.joinedCandidateCount=7,
  s=>s.base.count=5,s=>s.base.sha256='bad',s=>s.base.firstId='wrong',s=>s.candidateRows.pop(),s=>s.rows.pop(),
  s=>s.candidateRows[1].text='changed',s=>s.candidateRows[3].structure.push({tag:'em',text:'changed'}),
  s=>s.candidateRows[5].id='a3',s=>s.candidateRows[5].index=4
 ]){const {r,source,pack}=joinedFixture();mutate(source);assert.throws(()=>api.plan(r,source,pack,sha))}
});
test('joined evidence prohibits unresolved composite references in every import tab',()=>{
 for(const key of ['pilotMessages','quizLogs','easterEggs']){
  const {r,source,pack}=joinedFixture(),id=source.candidateRows[5].id;
  if(key==='easterEggs')pack[key][0].sourceIds=[id];else pack[key].push({sourceId:id,text:'不可自行拆分'});
  assert.throws(()=>api.plan(r,source,pack,sha));
 }
});
test('joined evidence rejects a digest for the base or a rewritten candidate',()=>{
 const {r,source,pack}=joinedFixture();
 assert.throws(()=>api.plan(r,source,pack,source.base.sha256),/SHA/);
 pack.sourceSha256='c'.repeat(64);assert.throws(()=>api.plan(r,source,pack,sha),/SHA/);
});

test('same stable source and text with earlier digest is preserved byte for byte, not migrated',()=>{
 const {r,source,pack}=joinedFixture();
 const first=api.plan(r,source,pack,sha).updated;
 const prior=first.pilotMessages.find(x=>x.predecessorSource?.id==='u1');
 prior.predecessorSource.sha256='b'.repeat(64);prior.predecessorSource.index=99;prior.images=[{id:'old-image'}];prior.extra='keep';
 const before=structuredClone(prior),p=api.plan(first,source,pack,sha);
 assert.deepEqual(p.updated.pilotMessages.find(x=>x.id===prior.id),before);
 assert.equal(p.merge.pilot.retainedEarlierDigest,1);
 assert.deepEqual(api.plan(p.updated,source,pack,sha).updated,p.updated);
});
test('earlier digest never authorizes changed text, absent digest or foreign provenance',()=>{
 for(const [mutate,expected] of [
  [x=>{x.text='不同'},/正文不同/],
  [x=>{delete x.predecessorSource.sha256},/缺少有效舊雜湊/],
  [x=>{x.predecessorSource.chatId='other'},/聊天 ID/],
  [x=>{x.predecessorSource.id='other'},/原始訊息 ID/],
  [x=>{x.role='ai'},/角色/],
  [x=>{x.manager='其他前輩'},/副駕駛/]
 ]){
  const {r,source,pack}=joinedFixture(),first=api.plan(r,source,pack,sha).updated;
  const prior=first.pilotMessages.find(x=>x.predecessorSource?.id==='u1');prior.predecessorSource.sha256='b'.repeat(64);mutate(prior);
  const raw=JSON.stringify(first);assert.throws(()=>api.plan(first,source,pack,sha),expected);assert.equal(JSON.stringify(first),raw);
 }
});
