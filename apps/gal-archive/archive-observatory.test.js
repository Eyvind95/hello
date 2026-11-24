'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('./archive-observatory-core.js');
const root=__dirname;
function example(){
 return [
  {id:'cycle-3',world:'sentinel',title:'第3輪迴',opening:'真正開場',hero:'暗芒',
   messages:[
    {id:'s1',role:'me',text:'玩家在2026年8月24日'},
    {id:'s2',role:'ai',text:'｜2026年8月24日｜\n｜🕒12:00｜\nGal AI 回覆',
     gameTime:'2026-08-24T04:00:00.000Z',sourceCreatedAt:'2026-11-24T04:00:00Z'},
    {id:'s3',role:'me',text:'玩家向前走'},
    {id:'s4',role:'ai',text:'｜2026年8月25日｜\n｜🕒08:15｜\n繼續',
     gameTime:'2026-08-25T00:15:00.000Z'}
   ],
   events:[
    {id:'evt-1',status:'accepted',role:'ai',title:'突發雷暴',
     text:'事件到達：閃電',gameTime:'2026-08-24T05:30:00.000Z'},
    {id:'evt-2',status:'pending',role:'ai',title:'未接支線',text:'事件未接取'},
    {id:'evt-3',status:'declined',role:'ai',title:'拒絕支線',text:'事件已拒絕'}
   ]},
  {id:'cycle-16',world:'sentinel',title:'第16輪迴',opening:'起始',
   messages:[{id:'m1',role:'me',text:'早安，杜林'},{id:'m2',role:'ai',text:'沒有時間的回覆',gameTime:null,
    nativeClockEvidence:'verified-original-without-game-time'}],
   events:[]},
  {id:'cycle-1',world:'adventure',title:'第1輪迴',opening:'另一個世界觀',
   messages:[{id:'a1',role:'me',text:'冒險開始'},{id:'a2',role:'ai',text:'第3000年',
    gameTime:'3000-01-01T00:00:00.000Z'}],
   events:[]}
 ];
}
function adapt(records,cycleComparator){
 const storyTimeline=r=>[
  ...r.messages.map((entry,index)=>({entry,index,type:'message'})),
  ...r.events.map((entry,index)=>({entry,index,type:'event'})).filter(x=>x.entry.status==='accepted')
 ];
 const dialogueAudit=rows=>{
  const issues=[],timeIssues=[],skipIssues=[];
  for(let i=1;i<rows.length;i++){
   if(rows[i].type==='message'&&rows[i-1].type==='message'&&
      rows[i].entry.role===rows[i-1].entry.role)issues.push({index:i,text:'連續同側回覆'});
  }
  return {issues,timeIssues,skipIssues,pairs:2,autoContinues:[]};
 };
 return core.build(records,{worlds:[
  {id:'sentinel',name:'《全員精神穩定，感情除外》'},
  {id:'adventure',name:'《身為冒險者就可以這樣那樣》'}],
  cycleComparator,storyTimeline,dialogueAudit,galTimeContext:()=>{
   const m=new Map();
   for(const r of records)for(const row of r.messages)if(row.gameTime)
    m.set(row,{domain:'story',ms:Date.parse(row.gameTime)});
   return m;
  }});
}
test('all-cycle indexed timeline merges ONLY accepted events and remains read-only',()=>{
 const records=example(),before=JSON.stringify(records);
 const index=adapt(records);
 assert.equal(index.counts.cycles,3);
 assert.equal(index.counts.messages,8);
 assert.equal(index.counts.acceptedEvents,1);
 assert.equal(index.entries.length,9);
 assert.ok(!index.entries.some(e=>e.preview.includes('未接支線')));
 assert.deepEqual(index.cycles.filter(c=>c.world==='sentinel').map(c=>c.number),[3,16]);
 assert.equal(JSON.stringify(records),before);
});
test('timeline follows the exact existing sidebar comparator for new-to-old, old-to-new, latest-updated and Chinese numerals',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 // Verify against the REAL sidebar implementation so the two cannot silently diverge.
 const fnNames=['cycleOrdinalFromText','cycleOrdinal','archiveCompareCycleList'];
 const implementations=fnNames.map(name=>{
   const start=html.indexOf('function '+name+'(');
   assert.ok(start>=0,name+' exists in sidebar');
   const match=html.slice(start).match(/^function [^(]+\([^)]*\)\{[\s\S]*?\n\}/);
   assert.ok(match,name+' function body is readable');
   return match[0];
 }).join('\n');
 const comparatorFor=mode=>new Function('cycleSortMode',
   implementations+'\nreturn archiveCompareCycleList;')(mode);
 const records=example();
 records[0].updatedAt='2026-11-24T10:00:00Z';
 records[1].updatedAt='2026-11-23T10:00:00Z';
 const chinese={...records[1],id:'cycle-17',title:'第十七輪迴',updatedAt:'2026-11-22T10:00:00Z',
  messages:[{id:'s17-player',role:'me',text:'新輪迴'},{id:'s17-ai',role:'ai',text:'接續'}]};
 records.push(chinese);
 for(const [mode,want] of [
   ['number-desc',['cycle-17','cycle-16','cycle-3']],
   ['number-asc',['cycle-3','cycle-16','cycle-17']],
   ['updated',['cycle-3','cycle-16','cycle-17']]
 ]){
  const comparator=comparatorFor(mode);
  const rows=adapt(records,comparator);
  const actual=rows.cycles.filter(c=>c.world==='sentinel').map(c=>c.id);
  assert.deepEqual(actual,want,mode+' health and timeline must agree with sidebar');
  const fromTimeline=core.timelineGroups(rows,{world:'sentinel'}).groups.map(g=>g.cycle.id);
  assert.deepEqual(fromTimeline,want,mode+' timeline must use index order');
  assert.equal(rows.cycles.at(-1).world,'adventure','worlds follow left world-tab order');
 }
});
test('world and cycle filter remain separate from global story-time ordering',()=>{
 const index=adapt(example());
 const grouped=core.timelineGroups(index,{world:'sentinel',clock:'story',datedOnly:true});
 assert.equal(grouped.total,3);
 assert.equal(grouped.groups.length,1);
 assert.equal(grouped.groups[0].cycle.id,'cycle-3');
 assert.deepEqual(grouped.groups[0].days.map(x=>x.day),['2026-08-24','2026-08-25']);
 const adventure=core.timelineGroups(index,{world:'adventure',clock:'story',datedOnly:true});
 assert.equal(adventure.total,1);
 assert.equal(adventure.groups[0].days[0].day,'3000-01-01');
 assert.equal(core.timelineGroups(index,{cycle:'cycle-16',clock:'story'}).groups[0].days[0].day,'unknown');
});
test('real source timestamps are separate; no mixing with storyline year 3000',()=>{
 const index=adapt(example());
 const real=core.timelineGroups(index,{world:'sentinel',clock:'real',datedOnly:true});
 assert.equal(real.total,1);
 assert.equal(real.groups[0].days[0].day,'2026-11-24');
 const all=core.timelineGroups(index,{clock:'real',datedOnly:false});
 assert.ok(all.groups.some(g=>g.days.some(d=>d.day==='unknown')));
});
test('keyword and role filters search actual archived content without truncation',()=>{
 const index=adapt(example());
 const result=core.timelineGroups(index,{kind:'event',query:'閃電'});
 assert.equal(result.total,1);
 assert.equal(result.groups[0].days[0].items[0].kind,'event');
 assert.equal(core.filteredEntries(index,{kind:'me',query:'杜林'}).length,1);
 assert.equal(core.filteredEntries(index,{kind:'ai',query:'杜林'}).length,0);
});
test('health center includes existing red/orange audit, duplicates, orphan event placement and missing opening',()=>{
 const data=example();
 data[0].messages.push({id:'s4',role:'ai',text:'再一則同側 AI'});
 data[0].events[0].storyPlacement={beforeId:'missing-id'};
 data[1].opening='';
 const index=adapt(data);
 const codes=index.issues.map(i=>i.code);
 assert.ok(codes.includes('duplicate-message-id'));
 assert.ok(codes.includes('pair'));
 assert.ok(codes.includes('dangling-event-anchor'));
 assert.ok(codes.includes('missing-opening'));
 const byCycle=index.issues.filter(i=>i.cycleId==='cycle-3');
 assert.ok(byCycle.every(x=>x.cycleTitle==='第3輪迴'));
 assert.ok(index.counts.errors>0);
});
test('native time absence is not assumed an error or filled with previous turn time',()=>{
 const index=adapt(example());
 const cycle=index.cycles.find(c=>c.id==='cycle-16');
 assert.equal(cycle.untimed,2);
 assert.equal(cycle.storyTimed,0);
 assert.equal(index.entries.find(e=>e.cycleId==='cycle-16'&&e.kind==='ai').storyMs,null);
 assert.ok(!cycle.issues.some(i=>i.code==='conflicting-native-clock'));
 const bad=example();
 bad[1].messages[1].gameTime='2026-08-24T01:00:00Z';
 const issues=adapt(bad).issues;
 assert.ok(issues.some(i=>i.code==='conflicting-native-clock'));
});
test('escape and script load integration: actual website includes both tools, shared bridge and standalone export',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'archive-observatory.js'),'utf8');
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 assert.match(html,/id="archiveHealthOpen"/);
 assert.match(html,/id="archiveTimelineOpen"/);
 assert.match(html,/window\.ArchiveObservatoryBridge=/);
 assert.match(html,/cycleComparator:\(a,b\)=>archiveCompareCycleList\(a,b\)/);
 assert.match(js,/cycleComparator:bridge\.cycleComparator/);
 const cache=sw.match(/^const CACHE='gal-archive-pwa-v([1-9]\d*)';$/m);
 assert.ok(cache&&Number(cache[1])>=100,'observatory cache generation must be v100 or newer');
 assert.match(html,/<script src="\.\/archive-observatory-core\.js\?v=2"><\/script>/);
 assert.match(html,/<script src="\.\/archive-observatory\.js\?v=2"><\/script>/);
 assert.match(html,/archive-observatory\.css\?v=1/);
 assert.match(html,/for\(const asset of \[.*'archive-observatory-core\.js\?v=2','archive-observatory\.js\?v=2'/);
 assert.match(html,/cssAsset='archive-observatory\.css\?v=1'/);
 assert.match(sw,/archive-observatory-core\.js/);
 assert.match(sw,/archive-observatory\.js/);
 assert.match(sw,/archive-observatory\.css/);
 assert.doesNotMatch(js,/\b(?:db\.transaction|firebase\.firestore|\.put\(|\.delete\()\b/);
});
