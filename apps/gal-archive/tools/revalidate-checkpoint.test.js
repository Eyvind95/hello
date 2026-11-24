'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replay}=require('./revalidate-checkpoint.js');
function fixture(){
 const events=new Set([95,1567,1588,1599,1600]);
 const rows=[{scanIndex:0,role:'ai',text:'獨立無時間開場。',eventType:null}];
 let ordinary=0;
 for(let i=1;i<=1687;i++){
  if(events.has(i)){
   rows.push({scanIndex:i,role:'ai',eventType:'event',
    text:'事件到達：這是第 '+i+' 筆事件',
    sourceMessageId:'evt-'+i,nativeReason:'available',
    nativeText:'事件到達：這是第 '+i+' 筆事件'});
  }else{
   ordinary++;
   const ai=ordinary%2===0;
   rows.push({scanIndex:i,role:ai?'ai':'me',eventType:null,
    text:ai?'｜2026年8月22日｜\n｜🕒18:45｜\n正常的時間回覆':'玩家輸入 '+i});
  }
 }
 assert.equal(rows[1685].role,'ai');
 assert.equal(rows[1686].role,'me');
 const title='【無時間回覆】',first='隊友往前走',last='故事繼續';
 rows[1685]={scanIndex:1685,role:'ai',eventType:null,
  text:[title,first,'字'.repeat(50),last].join('\n'),
  nativeText:[title,'{{背景模板}}',first,'\x60\x60\x60\n'+'字'.repeat(50)+'\n\x60\x60\x60',last,'{{img:tail}}'].join('\n'),
  sourceMessageId:'unique-1685',nativeReason:'available'};
 return {format:'gal-ai-incomplete-scan-checkpoint',importable:false,complete:false,
  scanRunId:'test-1685',target:{cycleId:'cycle-test',worldName:'全員精神穩定，感情除外'},rows};
}
test('read-only replay validates 1685 as untimed without treating checkpoint as importable',()=>{
 const result=replay(fixture());
 assert.equal(result.scannerCore,'0.8.45');
 assert.equal(result.validationOkOffline,true,JSON.stringify(result.errors));
 assert.equal(result.problem1685.sourceVerifiedUntimedNative,true);
 assert.equal(result.problem1685.gameTime,null);
 assert.equal(result.problem1685.nextRowRole,'me');
 assert.ok(result.expectedEvents.every(e=>e.recognizedAsEvent&&e.sourceIdUnique));
 assert.equal(result.importable,false);
});
test('read-only replay flags changed story and missing provenance instead of filling clock',()=>{
 const damaged=fixture();
 damaged.rows[1685].nativeText=damaged.rows[1685].nativeText.replace('故事繼續','故事被更改');
 const result=replay(damaged);
 assert.equal(result.validationOkOffline,false);
 assert.equal(result.problem1685.sourceVerifiedUntimedNative,false);
 assert.ok(result.errors.some(x=>x.includes('1686')));
 const forged=fixture();forged.rows[1685].sourceMessageId=null;
 assert.throws(()=>replay(forged),/不唯一或不存在/);
 const malformed=fixture();malformed.importable=true;
 assert.throws(()=>replay(malformed),/不可匯入/);
});
