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
 assert.match(js,/if\(!uid\|\|!localReady\|\|!enabled\|\|!app\.isSignedIn\(uid\)\)return/);
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
 assert.match(html,/archive-auto-sync\.js\?v=1/);
 assert.match(html,/archive:cloud-auth/);
 assert.match(html,/archive:local-changed/);
 assert.match(html,/archive:local-ready/);
 assert.match(html,/window\.ArchiveAutoSyncBridge=/);
 assert.match(html,/archiveManualBusy=true/);
 assert.match(html,/!window\.__archiveAutoApplyingCloud/);
 assert.match(html,/downloadText\('輪迴檔案館_V5\.66_網站\.html'/);
});
test('PWA and self contained HTML download both include automatic sync code',()=>{
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(sw,/gal-archive-pwa-v100/);
 assert.match(sw,/archive-auto-sync-core\.js/);
 assert.match(sw,/archive-auto-sync\.js/);
 assert.match(html,/for\(const asset of \[.*'archive-auto-sync-core\.js\?v=1','archive-auto-sync\.js\?v=1'/);
});
