'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {findScanBatches}=require('./find-scan-batches.js');
test('discovers two cycles and three same-day batches by v2 state path, not guessed suffixes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gal-batches-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(let i=0;i<4;i++){
  const cycle=i===3?'第09輪迴':'第05輪迴';
  const run='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  const folder=path.join(root,cycle,i%2?'事件三則測試':'完整掃描',
   '2026-11-24_16-31-'+String(i).padStart(2,'0')+'_'+run);
  fs.mkdirSync(folder,{recursive:true});
  const raw=path.join(folder,'未驗證掃描資料.json');
  fs.writeFileSync(raw,'{"format":"gal-ai-unverified-scan","importable":false}');
  fs.writeFileSync(path.join(folder,'掃描狀態.json'),JSON.stringify({
   format:'gal-archive-scan-status',version:2,scanRunId:run,
   cycleId:i===3?'cycle-nine':'cycle-five',cycleTitle:i===3?'第9周目':'第5輪迴',
   state:'failed',scope:i%2?'event-three':'full',scanned:382,
   startedAt:'2026-11-24T08:31:0'+i+'Z',endedAt:'2026-11-24T09:00:0'+i+'Z',
   files:{unverified:raw,result:path.join(folder,'原生正史.json')}
  }));
 }
 const result=findScanBatches(root);
 assert.equal(result.length,4);
 assert.ok(result.every(r=>r.state==='failed'&&r.scanned===382));
 assert.ok(result.every(r=>r.files.unverified&&r.files.result===undefined));
 assert.equal(findScanBatches(root,{cycle:'第9周目'}).length,1);
 assert.equal(findScanBatches(root,{scope:'full'}).length,2);
 assert.equal(new Set(result.map(r=>r.batchFolder)).size,4);
});
test('can still list older state file names without pretending failed raw evidence exists',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gal-old-batches-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'輪迴檔案館_掃描狀態_第9周目_failed_2026-11-24 (1).json'),
 JSON.stringify({format:'gal-archive-scan-status',version:1,
  scanRunId:'11111111-1111-4111-8111-111111111111',
  cycleId:'nine',cycleTitle:'第9周目',scope:'full',state:'failed',scanned:382,
  startedAt:'2026-11-24T09:01:26Z',files:{}}));
 const result=findScanBatches(root);
 assert.equal(result.length,1);
 assert.equal(result[0].legacy,true);
 assert.deepEqual(result[0].files,{});
});

test('world-scoped index reads same ordinal independently, preserves old unknown and rejects conflicting evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gal-world-batches-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const worlds=['《全員精神穩定，感情除外》','《身為冒險者就可以這樣那樣》'];
 const put=(n,worldName,sourceWorld,legacy=false)=>{
  const run='00000000-0000-4000-8000-'+String(n).padStart(12,'0'),cycleId='cycle-'+n;
  const folder=path.join(root,...(legacy?[]:[worldName.slice(1,-1)]),'第01輪迴','完整掃描','2026-11-25_01-00-00_'+run);
  fs.mkdirSync(folder,{recursive:true});
  const raw=path.join(folder,'原生正史.json'),source='https://www.whif.io/chat/test-'+n;
  fs.writeFileSync(raw,JSON.stringify({scanRunId:run,source:{url:source},target:{cycleId,cycleTitle:'第一輪迴',worldName:sourceWorld}}));
  fs.writeFileSync(path.join(folder,'掃描狀態.json'),JSON.stringify({format:'gal-archive-scan-status',version:2,scanRunId:run,cycleId,cycleTitle:'第一輪迴',worldName,state:'completed',scope:'full',source,startedAt:'2026-11-24T17:00:00Z',files:{result:raw}}));
 };
 put(1,worlds[0],worlds[0]);put(2,worlds[1],worlds[1]);
 put(3,undefined,undefined,true);put(4,worlds[1],worlds[0]);
 put(5,undefined,worlds[1],true);
 const all=findScanBatches(root),index=require('./find-scan-batches').latestWorldIndex(all);
 assert.equal(all.length,5);assert.equal(index.latestByWorldCycleScope.length,3);assert.equal(index.pendingReview.length,2);
 assert.equal(findScanBatches(root,{world:'sentinel',cycle:'第一輪迴'}).length,1);
 assert.equal(index.ordinalConflicts.length,1);
 const dest=fs.mkdtempSync(path.join(os.tmpdir(),'gal-world-cloud-'));t.after(()=>fs.rmSync(dest,{recursive:true,force:true}));
 const {syncWorldBatches}=require('./sync-scan-batches');
 const plan=syncWorldBatches(root,dest);assert.equal(plan.plan.filter(p=>p.action==='copy-plan').length,2);assert.deepEqual(fs.readdirSync(dest),[]);
 const result=syncWorldBatches(root,dest,{apply:true});assert.equal(result.index.latestByWorldCycleScope.length,2);
 const next=syncWorldBatches(root,dest,{apply:true});assert.equal(next.index.latestByWorldCycleScope.length,2);
 const copied=next.index.latestByWorldCycleScope[0];fs.writeFileSync(copied.files.result,'different');
 const conflict=syncWorldBatches(root,dest,{apply:true});assert.equal(conflict.plan.filter(p=>p.action==='conflict').length,1);assert.equal(fs.readFileSync(copied.files.result,'utf8'),'different');
 assert.equal(findScanBatches(root).length,5);
});
