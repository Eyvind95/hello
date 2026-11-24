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
        const tx={objectStore:()=>({
          get:id=>{const request={result:structuredClone(records.get(id))};queueMicrotask(()=>request.onsuccess?.());return request},
          put:row=>records.set(row.id,structuredClone(row))
        })};
        // IndexedDB completes only after queued get callbacks have run.
        setImmediate(()=>tx.oncomplete?.());
        return tx;
      }
    },
    STORE:'cycles', WORLDSTORE:'worlds', worldDocs:{}, records:[...records.values()],
    $:()=>({}), importStatus:()=>{}, notify:()=>{},
    refresh:async()=>{context.records=[...records.values()]}
  });
  vm.runInContext(section('function archiveSpecialKey(', 'async function archiveSpecialReadDiagnostic('), context);
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


test('archive import accepts exactly paired original 日期不詳／時間不詳 replies with null clocks',()=>{
 const scan=fixture();
 const make=(scanIndex,role,text,id)=>({
  id:'legacy-'+id,role,text,scanIndex,messageOrder:scanIndex,
  gameTime:null,sourceEventId:id,sourcePartIndex:0,
  sourceKind:'gal-ai-native',chatKey:'source-chat'
 });
 scan.messages.push(
  make(4,'me','我詢問維度夾縫的狀況。','unknown-player-1'),
  make(5,'ai','｜日期不詳｜\n｜🕒時間不詳｜🚨意識崩潰｜\n｜📍維度夾縫｜\n劇情第一段。','unknown-ai-1'),
  make(6,'me','我要求繼續描述。','unknown-player-2'),
  make(7,'ai','｜日期不詳｜\n｜🕒時間不詳｜🚨維度抹除｜\n｜📍虛無之海｜\n劇情第二段。','unknown-ai-2')
 );
 scan.validation.pairs=3;
 scan.validation.gameTimeCount=2;
 scan.validation.unknownGameTimeCount=4;
 const {original,context}=archive(scan);
 const verified=context.galNativeVerify(scan,original);
 assert.deepEqual(asJSON(verified.fail),[]);
 assert.equal(verified.pairs,3);
 assert.equal(verified.unknownGameTimeCount,4);
 const plan=context.galNativeBuildPlan(scan,original);
 assert.equal(plan.ok,true,JSON.stringify(plan.fail));
 assert.equal(plan.sourceCounts.unknownGameTimeCount,4);
 assert.equal(plan.updated.messages.length,6);
 assert.deepEqual(asJSON(plan.updated.messages.slice(-4).map(row=>row.gameTime)),[null,null,null,null]);
 assert.deepEqual(asJSON(plan.updated.messages.slice(-4).map(row=>row.scanIndex)),[4,5,6,7]);
 assert.equal(plan.updated.events.length,1);
 assert.equal(plan.updated.notes,original.notes);

 const wrongHeader=structuredClone(scan);
 wrongHeader.messages[3].text='｜日期不詳｜\n｜🕒07:29｜\n狀態欄已經不是時間不詳。';
 assert.equal(context.galNativeBuildPlan(wrongHeader,original).ok,false);
 const forgedTime=structuredClone(scan);
 forgedTime.messages[3].gameTime='2026-08-23T00:00:00.000Z';
 assert.equal(context.galNativeBuildPlan(forgedTime,original).ok,false);
 const badPair=structuredClone(scan);
 badPair.messages[4].gameTime='2026-08-23T00:00:00.000Z';
 assert.equal(context.galNativeBuildPlan(badPair,original).ok,false);
 const badCount=structuredClone(scan);
 badCount.validation.unknownGameTimeCount=3;
 assert.equal(context.galNativeBuildPlan(badCount,original).ok,false);
});

test('an undated reply without an explicit leading status header still fails import',()=>{
 const scan=fixture();
 scan.messages[0].gameTime=null;
 scan.messages[1].gameTime=null;
 const {original,context}=archive(scan);
 const plan=context.galNativeBuildPlan(scan,original);
 assert.equal(plan.ok,false);
 assert.match(plan.fail.join(' '),/沒有可靠的 Gal AI 劇情時間/);
});


test('website imports uniquely source-verified untimed Yaoban reply without forging 18:42 timestamp',()=>{
 const scan=fixture();
 scan.messages[0].gameTime=null;
 scan.messages[1].gameTime=null;
 scan.messages[1].text='新隊員的身影消失在走廊盡頭，房門輕輕闔上。';
 scan.messages[1].nativeClockEvidence='verified-original-without-game-time';
 scan.validation.unknownGameTimeCount=2;
 scan.validation.verifiedUntimedCount=1;
 scan.validation.gameTimeCount=0;
 const {original,context}=archive(scan);
 const result=context.galNativeBuildPlan(scan,original);
 assert.equal(result.ok,true,JSON.stringify(result.fail));
 assert.equal(result.pairs,1);
 assert.equal(result.updated.messages[0].gameTime,null);
 assert.equal(result.updated.messages[1].gameTime,null);
 assert.equal(result.updated.messages[1].nativeClockEvidence,'verified-original-without-game-time');
 assert.equal(result.updated.notes,original.notes);
 assert.ok(result.warn.some(x=>x.includes('無時間欄')));
 for(const mutate of [
  copy=>{delete copy.messages[1].nativeClockEvidence},
  copy=>{copy.messages[1].nativeClockEvidence='fake-no-time'},
  copy=>{copy.messages[1].gameTime='2026-08-22T10:42:00.000Z'},
  copy=>{copy.messages[1].text='｜2026年8月22日｜\n｜🕒18:42｜\n'+copy.messages[1].text},
  copy=>{copy.messages[1].sourceEventId=''},
  copy=>{copy.validation.verifiedUntimedCount=0},
  copy=>{copy.validation.unknownGameTimeCount=0},
  copy=>{copy.messages[0].gameTime='2026-08-22T10:42:00.000Z'}
 ]){
  const forged=structuredClone(scan);mutate(forged);
  const blocked=context.galNativeBuildPlan(forged,original);
  assert.equal(blocked.ok,false,JSON.stringify(mutate.toString()));
 }
});

test('website requires original no-time provenance for AI only; explicit unknown HUD remains separate',()=>{
 const scan=fixture();
 scan.messages[0].gameTime=null;
 scan.messages[1].gameTime=null;
 scan.messages[1].text='｜日期不詳｜\n｜🕒時間不詳｜\n米契爾說話。';
 scan.messages[1].nativeClockEvidence='verified-original-without-game-time';
 scan.validation.unknownGameTimeCount=2;
 scan.validation.verifiedUntimedCount=1;
 const {original,context}=archive(scan);
 const rejected=context.galNativeBuildPlan(scan,original);
 assert.equal(rejected.ok,false);
 assert.match(rejected.fail.join('、'),/不應標成完全沒有時間欄/);
 const illegalPlayer=structuredClone(scan);
 delete illegalPlayer.messages[1].nativeClockEvidence;
 illegalPlayer.messages[0].nativeClockEvidence='verified-original-without-game-time';
 illegalPlayer.validation.verifiedUntimedCount=0;
 assert.equal(context.galNativeBuildPlan(illegalPlayer,original).ok,false);
});
