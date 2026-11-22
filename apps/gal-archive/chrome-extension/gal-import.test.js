'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
require('./gal-core.js');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return page.slice(from, to);
}
function fixture() {
  const gameTime = '2026-08-22T01:30:00.000Z';
  const status = '｜2026年8月22日｜09:30｜';
  const row = (index, role, text, prefix) => ({
    id: 'legacy-' + prefix, role, text, scanIndex: index, messageOrder: index,
    gameTime, sourceEventId: prefix, sourcePartIndex: 0, sourceKind: 'gal-ai-native',
    chatKey: 'source-chat'
  });
  return {
    format: 'gal-ai-authoritative-scan', version: 1, scope: 'entire-opening-to-bottom',
    target: {cycleId:'native-cycle',worldName:'測試世界'},
    opening: '這是完整的輪迴開場。', readOnlyUntilImported: true,
    messages: [row(1,'me','玩家發言。','player'),row(3,'ai',status+'\n之前的格式。','reply')],
    events: [{...row(2,'ai','事件通知\n'+status,'event'),title:'事件通知',status:'accepted'}],
    validation: {ok:true,pairs:1,events:1,warnings:[],errors:[]}
  };
}
function newFormat(previous) {
  const candidate = structuredClone(previous);
  for (const row of [...candidate.messages,...candidate.events]) {
    row.id = row.sourceEventId;
    if (row.role==='ai') row.text = row.text.replace('\n','\n\n');
  }
  return candidate;
}
function archive(oldExport) {
  const original = {
    id:oldExport.target.cycleId, world:'fixture-world', title:'測試原生正史',
    opening:oldExport.opening, messages:structuredClone(oldExport.messages),
    events:structuredClone(oldExport.events), notes:'保留的筆記', updatedAt:'2026-08-22T00:00:00.000Z'
  };
  const records = new Map([[original.id, structuredClone(original)]]);
  const context = vm.createContext({
    structuredClone, WORLDS:[{id:original.world,name:oldExport.target.worldName}],
    validWorldId:id=>id===original.world,
    archiveParseGalAIClock:row=>{
      const time=GalArchiveCore.parseGameTime(row.text);
      return time?{ms:Date.parse(time.iso)}:null;
    },
    archiveStoryTimeline:cycle=>cycle.messages,
    archiveCheckDialoguePairs:messages=>({
      issues:messages.filter((row,i)=>row.role!==(i%2?'ai':'me')),timeIssues:[]
    }),
    db:{
      transaction(){
        const tx={objectStore:()=>({put:row=>records.set(row.id,structuredClone(row))})};
        queueMicrotask(()=>tx.oncomplete());
        return tx;
      }
    },
    STORE:'cycles', WORLDSTORE:'worlds', worldDocs:{}, records:[...records.values()],
    $:()=>({}), importStatus:()=>{}, notify:()=>{},
    refresh:async()=>{context.records=[...records.values()]}
  });
  vm.runInContext(section('function galNativeText(', 'function galNativeShowStatus('), context);
  vm.runInContext(section('function normalizeBackupCycle(', 'function importStatus('), context);
  vm.runInContext(section('function previewBackup(', "$('importBtn').onclick="), context);
  return {original,records,context};
}
const asJSON=value=>JSON.parse(JSON.stringify(value));

async function verifyImportAndRollback(oldExport,candidate) {
  const {original,records,context}=archive(oldExport);
  const snapshot=structuredClone(original);
  const plan=context.galNativeBuildPlan(candidate,original);
  assert.equal(plan.ok,true,JSON.stringify(plan.fail));
  assert.deepEqual(original,snapshot);
  assert.equal(plan.acceptedUnmatched,0);
  assert.deepEqual(asJSON(plan.updated.messages.map(row=>row.id)),original.messages.map(row=>row.id));
  assert.deepEqual(asJSON(plan.updated.events.map(row=>row.id)),original.events.map(row=>row.id));
  assert.deepEqual(asJSON(plan.updated.messages.map(row=>row.text)),candidate.messages.map(row=>row.text));
  assert.deepEqual(asJSON(plan.updated.events.map(row=>row.text)),candidate.events.map(row=>row.text));
  for(const event of plan.updated.events){
    const next=plan.updated.messages.find(row=>row.scanIndex>event.scanIndex);
    assert.equal(event.storyPlacement.beforeId,next?.id||null);
  }
  assert.equal(plan.updated.notes,original.notes);
  const ids=[...plan.updated.messages,...plan.updated.events].map(row=>row.id);
  assert.equal(new Set(ids).size,ids.length);
  const repeated=context.galNativeBuildPlan(candidate,plan.updated);
  assert.equal(repeated.ok,true);
  assert.deepEqual(asJSON(repeated.updated),asJSON(plan.updated));
  records.set(original.id,structuredClone(repeated.updated));
  const backup=JSON.stringify({format:'gal-ai-restore-backup',version:1,cycle:snapshot});
  await context.importBackupText(backup);
  assert.deepEqual(records.get(original.id),snapshot);
  assert.equal(records.size,1);
  const preview={...candidate,scope:'opening-first-pair-preview',readOnlyUntilImported:false};
  assert.equal(context.galNativeBuildPlan(preview,original).ok,false);
  assert.throws(()=>context.analyzeBackup(preview));
}

test('format-only updates reuse old IDs; repeated import and rollback are exact', async()=>{
  const older=fixture();
  await verifyImportAndRollback(older,newFormat(older));
});

test('same-cycle formatting import preserves corrections, attachments and ordering',()=>{
  const older=fixture();
  const more=structuredClone(older.messages);
  more.forEach((row,i)=>{
    row.id+='-next'; row.sourceEventId+='-next'; row.scanIndex=4+i;
    row.messageOrder=row.scanIndex;
  });
  older.messages.push(...more);
  older.validation.pairs=2;
  const {original,context}=archive(older);
  const [a,b,c,d]=original.messages;
  original.messages=[c,d,a,b];
  original.messages[0].sourceCreatedAt='2026-08-22T01:00:00.000Z';
  original.messages[0].sourceTimeOrigin='manual';
  original.messages[0].sourceTimePrecision='minute';
  original.messages[0].messageOrder=123;
  original.messages[0].images=[{id:'local-image'}];
  original.events[0].storyPlacement={beforeId:d.id,sequence:3};
  original.events[0].title='使用者調整的事件標題';
  const next=newFormat(older);
  const planned=context.galNativeBuildPlan(next,original);
  assert.equal(planned.ok,true);
  assert.deepEqual(asJSON(planned.updated.messages.map(row=>row.id)),original.messages.map(row=>row.id));
  for(const key of ['sourceCreatedAt','sourceTimeOrigin','sourceTimePrecision','messageOrder','images'])
    assert.deepEqual(asJSON(planned.updated.messages[0][key]),original.messages[0][key]);
  assert.deepEqual(asJSON(planned.updated.events[0].storyPlacement),original.events[0].storyPlacement);
  assert.equal(planned.updated.events[0].title,original.events[0].title);
  const wrongCycle={...original,id:'different-cycle'};
  assert.equal(context.galNativeBuildPlan(next,wrongCycle).ok,false);
});

if(process.env.GAL_ARCHIVE_OLDER_SCAN&&process.env.GAL_ARCHIVE_UPDATED_SCAN){
  test('cycle 17 exports update 70 messages and events 11/46 without duplication and roll back', async()=>{
    const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
    const older=read(process.env.GAL_ARCHIVE_OLDER_SCAN);
    const newer=read(process.env.GAL_ARCHIVE_UPDATED_SCAN);
    assert.equal(newer.messages.length,70);
    assert.deepEqual(newer.events.map(ev=>ev.scanIndex),[11,46]);
    for(const row of [...newer.messages,...newer.events])row.id=row.sourceEventId;
    await verifyImportAndRollback(older,newer);
  });
}
