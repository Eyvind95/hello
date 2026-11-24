'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {inspect,diff}=require('./inspect-checkpoint.js');

test('zero-based 1685 AI / 1686 player and four event indices remain distinct',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gal-archive-audit-'));
 try{
  const rows=Array.from({length:1687},(_,scanIndex)=>({
   scanIndex,role:'me',eventType:null,text:'測試',nativeText:null,nativeReason:null,
   sourceMessageId:null
  }));
  for(const scanIndex of [95,1567,1588,1599]){
   rows[scanIndex]={scanIndex,role:'ai',eventType:'event',text:'事件內容',nativeText:'事件內容',
    nativeReason:'available',sourceMessageId:'event-'+scanIndex};
  }
  rows[1685]={scanIndex:1685,role:'ai',eventType:null,
   text:'沒有時間的原文測試',
   nativeText:'{{內文隱藏標記}}\n\n沒有時間的原文測試',
   nativeReason:'available',sourceMessageId:'ai-1685'};
  rows[1686]={scanIndex:1686,role:'me',eventType:null,
   text:'玩家回覆',nativeText:null,nativeReason:null,sourceMessageId:'me-1686'};
  const f=path.join(dir,'checkpoint.json');
  fs.writeFileSync(f,JSON.stringify({
   format:'gal-ai-incomplete-scan-checkpoint',importable:false,complete:false,
   scanRunId:'test',target:{cycleId:'cycle'},rows
  }));
  const result=inspect(f);
  assert.equal(result.retainedRows,1687);
  assert.deepEqual(result.allObservedEventPositions,[95,1567,1588,1599]);
  assert.ok(result.requiredEventEvidence.every(x=>x.nativePresent&&x.sourceIdOccurrences===1));
  assert.equal(result.failedAi.scanIndex,1685);
  assert.equal(result.followingPlayer.scanIndex,1686);
  assert.equal(result.failedAi.domClock,null);
  assert.equal(result.failedAi.nativeClock,null);
  assert.equal(result.failedAi.nativeStartsWithHiddenTemplate,true);
  assert.equal(result.failedAi.comparison.exactNativeProjectionAccepted,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('read-only audit rejects unknown/authoritative files rather than importing them',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gal-archive-audit-'));
 try{
  const f=path.join(dir,'not-checkpoint.json');
  fs.writeFileSync(f,JSON.stringify({format:'gal-ai-authoritative-scan',
   importable:true,complete:true,rows:[]}));
  assert.throws(()=>inspect(f),/拒絕分析/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('diff does not equate a real body change to formatting differences',()=>{
 const d=diff('原生內容甲','原生內容乙');
 assert.equal(d.unexplainedScanned,1);
 assert.equal(d.unexplainedNative,1);
 assert.equal(d.scannedWindow.includes('甲'),true);
 assert.equal(d.nativeWindow.includes('乙'),true);
});
