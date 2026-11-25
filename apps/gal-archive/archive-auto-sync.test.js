'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const planner=require('./archive-auto-sync-core.js');
function cycle(id,updatedAt,count){return {id,title:'第'+id+'輪迴',updatedAt,messages:Array(count||0).fill({text:'正史'}),messageCount:count||0,acceptedEventCount:0}}
const local=()=>cycle('5','2026-11-24T06:30:00.000Z',2630);
const remote=()=>cycle('5','2026-11-23T06:30:00.000Z',1000);
test('latest desktop with old cloud uploads without pulling stale cloud into local',()=>{
 const p=planner.plan([local()],[remote()]);
 assert.equal(p.ok,true);
 assert.equal(p.needsPush,true);
 assert.equal(p.needsPull,false);
 assert.equal(p.snapshots.length,0);
 assert.equal(p.count.push,1);
});
test('old phone with newer cloud downloads and keeps a before-merge local snapshot',()=>{
 const p=planner.plan([remote()],[local()]);
 assert.equal(p.ok,true);
 assert.equal(p.needsPull,true);
 assert.equal(p.needsPush,false);
 assert.equal(p.snapshots.length,1);
 assert.equal(p.snapshots[0].messages.length,1000);
});
test('fresh phone downloads without uploading an empty device',()=>{
 const p=planner.plan([], [local()], [], [{id:'sentinel',updatedAt:'2026-11-24T06:20:00Z'}]);
 assert.equal(p.ok,true);assert.equal(p.needsPull,true);
 assert.equal(p.needsPush,false);assert.equal(p.snapshots.length,0);
});
test('mixed unique records and newer revisions create a non-destructive two-way plan',()=>{
 const p=planner.plan([
  cycle('5','2026-11-24T06:30:00Z',10),
  cycle('6','2026-11-24T06:35:00Z',12)
 ],[
  cycle('5','2026-11-23T06:30:00Z',9),
  cycle('7','2026-11-24T06:40:00Z',15)
 ]);
 assert.equal(p.ok,true);assert.equal(p.needsPull,true);
 assert.equal(p.needsPush,true);assert.equal(p.snapshots.length,0);
 assert.equal(p.count.push,2);assert.equal(p.count.pull,1);
});
test('unknown timestamps and duplicate IDs cannot authorize automatic overwrites',()=>{
 const bad=planner.plan([{id:'x',updatedAt:''}],[cycle('x','2026-11-24T00:00:00Z')]);
 assert.equal(bad.ok,false);
 assert.match(bad.problems.join(','),/revision-conflict/);
 const duplicates=planner.plan([cycle('5','2026-11-24T00:00:00Z'),
  cycle('5','2026-11-24T00:00:00Z')],[]);
 assert.equal(duplicates.ok,false);
 assert.match(duplicates.problems.join(','),/duplicate-id/);
});
test('cloud revision cannot automatically replace a longer canonical archive with fewer messages',()=>{
 const older=cycle('5','2026-11-23T00:00:00Z',2630);
 const newer=cycle('5','2026-11-24T00:00:00Z',1000);
 const p=planner.plan([older],[newer]);
 assert.equal(p.ok,false);
 assert.equal(p.needsPull,false);
 assert.match(p.problems.join(','),/cycle-remote-has-fewer-messages/);
});
test('legacy cloud without count evidence requires manual verification before replacing nonempty local data',()=>{
 const older=cycle('5','2026-11-23T00:00:00Z',2630);
 const newer=cycle('5','2026-11-24T00:00:00Z',2700);
 delete newer.messageCount;
 const p=planner.plan([older],[newer]);
 assert.equal(p.ok,false);
 assert.match(p.problems.join(','),/cycle-missing-remote-count-proof/);
});
test('accepted-event loss fails closed even when messages are a superset',()=>{
 const older=cycle('5','2026-11-23T00:00:00Z',500);
 older.events=[{status:'accepted',text:'事件1'},{status:'accepted',text:'事件2'}];
 const newer=cycle('5','2026-11-24T00:00:00Z',600);
 newer.acceptedEventCount=1;
 const p=planner.plan([older],[newer]);
 assert.equal(p.ok,false);
 assert.match(p.problems.join(','),/cycle-remote-has-fewer-accepted-events/);
});
test('equal revisions and unchanged local data create no automatic writes',()=>{
 const p=planner.plan([local()],[local()]);
 assert.equal(p.ok,true);assert.equal(p.needsPush,false);assert.equal(p.needsPull,false);
});
test('no automatic sync is performed without account authentication, and only server metadata authorizes decisions',()=>{
 const js=fs.readFileSync(path.join(root,'archive-auto-sync.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const handover=fs.readFileSync(path.join(root,'handover-cloud.js'),'utf8');
 assert.match(js,/if\(!uid\|\|!localReady\|\|\(!enabled&&!handoverOnly\)\|\|!app\.isSignedIn\(uid\)\)return/);
 assert.match(js,/checksAfterPlan\(plan\)/);
 assert.match(js,/plan\.snapshots/);
 assert.match(js,/gal-archive-world-pre-cloud:/);
 assert.match(js,/archive-world-before-auto-sync/);
 assert.match(js,/ArchiveTimeMachine\.captureBeforeNative/);
 assert.match(js,/safeAuto:true/);
 assert.match(js,/navigator\.locks\.request/);
 assert.match(js,/remote-only/);
 assert.match(js,/lastAttempt/);
 assert.match(handover,/if\(safeAuto&&\(removedThreads\.length\|\|removedEntries\.length\)\)/);
 assert.match(html,/get\(\{source:'server'\}\)/);
 assert.match(html,/users'\)\.doc\(user\.uid\)/);
 assert.match(html,/舊版 Firebase users 資料/);
 assert.match(html,/messageCount:\(r\.messages\|\|\[\]\)\.length/);
 assert.match(html,/id="archiveAutoSyncToggle"/);
 assert.match(html,/id="archiveAutoSyncNow"/);
 assert.match(html,/id="archiveAutoSyncStatus"/);
 assert.match(html,/archive-auto-sync-core\.js\?v=1/);
 assert.match(html,/archive-auto-sync\.js\?v=2/);
 assert.match(html,/archive:cloud-auth/);
 assert.match(html,/archive:local-changed/);
 assert.match(html,/archive:local-ready/);
 assert.match(html,/window\.ArchiveAutoSyncBridge=/);
 assert.match(html,/archiveManualBusy=true/);
 assert.match(html,/!window\.__archiveAutoApplyingCloud/);
 const version=html.match(/<h1>輪迴檔案館 V(\d+)\.(\d+)<\/h1>/);
 assert.ok(version&&(Number(version[1])>5||(Number(version[1])===5&&Number(version[2])>=67)),'auto sync website version must be V5.67 or newer');
 assert.ok(html.includes(`downloadText('輪迴檔案館_V${version[1]}.${version[2]}_網站.html'`),'standalone HTML filename must match website version');
});
test('PWA and self contained HTML download both include automatic sync code',()=>{
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const cache=sw.match(/^const CACHE='gal-archive-pwa-v([1-9]\d*)';$/m);
 assert.ok(cache&&Number(cache[1])>=100,'auto sync cache generation must be v100 or newer');
 assert.match(sw,/archive-auto-sync-core\.js/);
 assert.match(sw,/archive-auto-sync\.js/);
 assert.match(html,/for\(const asset of \[.*'archive-auto-sync-core\.js\?v=1','archive-auto-sync\.js\?v=2'/);
});

test('handover sync runs independently of canonical conflicts, even with no canonical changes',async()=>{
 const vm=require('node:vm'),js=fs.readFileSync(path.join(root,'archive-auto-sync.js'),'utf8');
 const calls=[],nodes=new Map(),handlers={};let failCanonical=true,auto=false;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},addEventListener:(type,fn)=>handlers[id+':'+type]=fn});return nodes.get(id)};
 const app={autoReady:async()=>{},user:()=>({uid:'u'}),isSignedIn:u=>u==='u',ensureRoot:async()=>{},isManualBusy:()=>false,isApplyingCloud:()=>false,setApplyingCloud:()=>{},currentWorldId:()=> 'adventure',localCycles:()=>[],localWorlds:()=>[],remoteMetadata:async()=>{calls.push('canon');if(failCanonical)throw Error('canonical conflict');return {cycles:[],worlds:[]}},firestore:()=>({})};
 const ctx={ArchiveAutoSyncCore:planner,ArchiveAutoSyncBridge:app,ArchiveHandoverCloud:{pull:async()=>{calls.push('pull');return {threads:1,text:1,files:0}},push:async()=>{calls.push('push');return {threads:0,text:0,files:0,worldInventory:{adventure:{local:2,remote:2}}}}},navigator:{locks:{request:async(_k,_o,fn)=>fn({})},onLine:true},localStorage:{getItem:k=>k.includes(':enabled:')?String(auto):null,setItem(){}},document:{readyState:'complete',hidden:false,getElementById:node,addEventListener(){}},window:{addEventListener:(k,fn)=>handlers[k]=fn},console:{error(){},warn(){}},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{handlers.poll=fn},Date};
 vm.createContext(ctx);vm.runInContext(js,ctx);await new Promise(setImmediate);
 handlers['archiveHandoverSyncNow:click']();await new Promise(setImmediate);
 assert.deepEqual(calls,['pull','push']);assert.match(node('archiveAutoSyncDetail').textContent,/本機 2、雲端 2/);
 // Re-enable auto and run a full sync explicitly through the actual closure.
 auto=true;handlers['archiveAutoSyncToggle:change']({target:{checked:true}});
 const instrumented=js.replace('if(document.readyState===','globalThis.testRun=run; if(document.readyState===');
 vm.runInContext(instrumented,ctx);await new Promise(setImmediate);
 calls.length=0;await ctx.testRun('test');
 assert.deepEqual(calls,['pull','push','canon']);assert.match(node('archiveAutoSyncDetail').textContent,/正史：canonical conflict/);
 assert.match(node('archiveAutoSyncDetail').textContent,/本機 2、雲端 2/);
 failCanonical=false;calls.length=0;await ctx.testRun('test');
 assert.deepEqual(calls,['pull','push','canon']);assert.match(node('archiveAutoSyncDetail').textContent,/雲端核對完成/);
});
test('handover local writes always emit user-edit event; visible polling and independent UI entry are installed',()=>{
 const js=fs.readFileSync(path.join(root,'archive-auto-sync.js'),'utf8'),h=fs.readFileSync(path.join(root,'handover.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(h,/if\(mode==='readwrite'\)\s*window\.dispatchEvent\(new CustomEvent\('archive:handover-changed'\)\)/);
 assert.match(js,/setInterval\(\(\)=>\{if\(!document.hidden&&!inProgress/);
 assert.match(html,/id="archiveHandoverSyncNow"/);
 assert.match(js,/run\('manual-handover',true\)/);
});

test('manual and automatic cloud operations cannot overlap in the same tab',()=>{
 const js=fs.readFileSync(path.join(root,'archive-auto-sync.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),h=fs.readFileSync(path.join(root,'handover-cloud.js'),'utf8');
 assert.match(js,/window\.__archiveAutoSyncBusy=true/);
 assert.match(js,/window\.__archiveAutoSyncBusy=false/);
 assert.equal((html.match(/if\(archiveManualBusy\|\|window\.__archiveAutoApplyingCloud\|\|window\.__archiveAutoSyncBusy\)/g)||[]).length,2);
 assert.match(h,/db\.transaction\(\[THREADS,ENTRIES,DELETES\],'readonly'\)/);
 assert.match(h,/if\(!equal\(req\.result,expected\)\)/);
 assert.match(h,/tx\.abort\(\)/);
});
