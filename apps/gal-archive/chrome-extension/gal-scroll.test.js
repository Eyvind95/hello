'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const content=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
const start=content.indexOf('async function advanceScanScroll(');
const end=content.indexOf('\nfunction hash(',start);
assert.ok(start>0&&end>start,'scroll-recovery helper must exist');
const ctx=vm.createContext({});
vm.runInContext(
  'const WAIT_MS=420,STABLE_MS=350;\n'+content.slice(start,end)+
  '\nfunction isBottom(root){return root.scrollTop+root.clientHeight>=root.scrollHeight-5;}\nthis.advanceScanScroll=advanceScanScroll;',
  ctx
);
const advance=ctx.advanceScanScroll;

function scrolling(initial=100,height=1000,clientHeight=100){
 let y=initial,h=height;
 return {
  isConnected:true,
  clientHeight,
  get scrollTop(){return y},
  set scrollTop(value){y=Math.max(0,Math.min(h-clientHeight,value))},
  get scrollHeight(){return h},
  set scrollHeight(value){h=value}
 };
}

test('WHIF lazy-load reset after first scroll retries and advances without skipping source rows',async()=>{
 const root=scrolling(100,1000),start=100;
 let waits=0;
 const result=await advance(root,200,async()=>{
  waits++;
  if(waits===1){root.scrollTop=start;root.scrollHeight=1300}
 });
 assert.equal(waits,2);
 assert.equal(result.moved,true);
 assert.equal(result.atBottom,false);
 assert.equal(root.scrollTop,300);
 assert.equal(result.attempts.length,2);
 assert.equal(result.attempts[0].scrollHeightBefore,1000);
 assert.equal(result.attempts[0].scrollHeightAfter,1300);
});

test('scroll clamping at newly loaded bottom must defer to existing stability proof',async()=>{
 const root=scrolling(850,1050);
 const result=await advance(root,200,async()=>{
  root.scrollHeight=950;
  root.scrollTop=850; // WHIF anchored the visible item while its height changed.
 });
 assert.equal(result.moved,false);
 assert.equal(result.atBottom,true);
 assert.equal(result.attempts.length,1);
});

test('permanently immobile container remains a safe failure after four attempts',async()=>{
 const root=scrolling(100,2000);
 Object.defineProperty(root,'scrollTop',{get:()=>100,set:()=>{}});
 let attempts=0;
 const result=await advance(root,200,async()=>{attempts++});
 assert.equal(attempts,4);
 assert.equal(result.moved,false);
 assert.equal(result.atBottom,false);
 assert.equal(result.geometryShift,false);
 assert.equal(result.attempts.length,4);
});

test('scroll position jumping backwards does not silently advance the scan',async()=>{
 const root=scrolling(400,1500);
 const result=await advance(root,200,async()=>{root.scrollTop=300});
 assert.equal(result.moved,false);
 assert.equal(result.atBottom,false);
 assert.equal(result.geometryShift,true);
});

test('container replaced during recovery causes safe stop',async()=>{
 const root=scrolling(100,2000);
 await assert.rejects(advance(root,200,async()=>{root.isConnected=false}),/更換了訊息容器/);
});

test('an already reached bottom never qualifies as completion without later proof',async()=>{
 const root=scrolling(900,1000),result=await advance(root,200,async()=>{});
 assert.equal(result.moved,false);
 assert.equal(result.atBottom,true);
 assert.equal(result.attempts.length,1);
});

test('scanner retains strict ordered overlap and 8-second bottom proof',()=>{
 assert.match(content,/const info=appendSample\(shot,collected\)|info=appendSample\(shot,collected\)/);
 assert.match(content,/const movement=await advanceScanScroll\(root,stepPx\)/);
 assert.match(content,/if\(!movement\.moved&&!movement\.atBottom\)/);
 assert.match(content,/scrollStall,scrollAtFailure,/);
 assert.match(content,/BOTTOM_CONFIRM_MS=8000/);
 assert.match(content,/BOTTOM_POLL_MS=750/);
 assert.match(content,/while\(Date\.now\(\)-proofStarted<BOTTOM_CONFIRM_MS\)/);
 assert.match(content,/tailSignature\(probe\.rows\)!==proofSignature/);
 assert.match(content,/if\(root\.scrollHeight!==proofHeight\|\|!isBottom\(root\)\)/);
});

test('cycle 3 step 400: +20075px WHIF height and -43px anchoring requires resnapshot, not failure or progress',async()=>{
 const root=scrolling(122399.9921875,124018,989);
 const result=await advance(root,306,async()=>{
  root.scrollHeight=144093;
  root.scrollTop=122356.796875;
 });
 assert.equal(result.moved,false);
 assert.equal(result.atBottom,false);
 assert.equal(result.geometryShift,false);
 assert.equal(result.reanchor,true);
 assert.equal(result.attempts.length,1);
 assert.equal(result.attempts[0].scrollHeightAfter-result.attempts[0].scrollHeightBefore,20075);
 assert.ok(result.attempts[0].after<result.attempts[0].before);
});

test('grown scroll with already-visible overlap cannot silently skip or duplicate messages',()=>{
 const first=content.indexOf('function sameRow(');
 const end=content.indexOf('\nfunction observeEventAudit(',first);
 assert.ok(first>0&&end>first);
 const sandbox=vm.createContext({});
 vm.runInContext(content.slice(first,end)+'\nthis.appendSample=appendSample;',sandbox);
 const collected=[
  {role:'ai',text:'可靠舊訊息 246',formatSource:{nativeReply:{messageId:'m246'}}},
  {role:'me',text:'可靠舊訊息 247'},
  {role:'ai',text:'可靠舊訊息 248',formatSource:{nativeReply:{messageId:'m248'}}}
 ];
 const current={rows:[
  {role:'me',text:'可靠舊訊息 247',id:null},
  {role:'ai',text:'可靠舊訊息 248',id:null,formatSource:{nativeReply:{messageId:'m248'}}},
  {role:'me',text:'新的訊息 249',id:null},
  {role:'ai',text:'新的訊息 250',id:'m250',formatSource:{nativeReply:{messageId:'m250'}}}
 ]};
 const aligned=sandbox.appendSample(current,collected);
 assert.equal(aligned.repeated,2);
 assert.equal(aligned.added,2);
 assert.equal(collected.length,5);
 assert.equal(collected.at(-1).text,'新的訊息 250');
 assert.throws(()=>sandbox.appendSample({rows:[
  {role:'ai',text:'中間訊息遺失而無法比對 253',id:'m253'}
 ]},collected),/無法找到順序重疊/);
});

test('WHIF backward scroll without new height remains a safe geometry-shift stop',async()=>{
 const root=scrolling(122400,124018,989);
 const result=await advance(root,306,async()=>{root.scrollTop=122356});
 assert.equal(result.geometryShift,true);
 assert.equal(result.reanchor,undefined);
});

test('main scanner re-anchors only by a new ordered overlap, with a finite retry limit',()=>{
 const snippet=content.slice(content.indexOf('const movement=await advanceScanScroll('));
 assert.match(snippet,/if\(movement\.reanchor\)\{/);
 assert.match(snippet,/geometryReanchors\+\+/);
 assert.match(snippet,/if\(geometryReanchors>8\)/);
 assert.match(snippet,/bottomFrames=0/);
 assert.match(snippet,/stepCount\+\+;\s*continue;/);
 assert.match(content,/info=appendSample\(shot,collected\)/);
 assert.match(content,/scrollStall,scrollAtFailure,/);
});


test('failed 3-row preview exposes precise pairing evidence instead of masking validator errors',()=>{
 assert.match(content,/openingPreviewStructure:\{/);
 assert.match(content,/rowRoles:rowFacts\.map\(row=>row\.role\)\.join\(' → '\)/);
 assert.match(content,/pairs:validation\.pairs,events:validation\.events\.length/);
 assert.match(content,/errors:validation\.errors\.slice\(0,12\)/);
 assert.match(content,/acceptedOpening:index===0\?core\.isAllowedOpeningRow\(row\):null/);
 assert.match(content,/clock:parsed\?\.iso\|\|null/);
 assert.match(content,/if\(collected\.length!==3\|\|validation\.pairs!==1\|\|validation\.events\.length\|\|!validation\.ok\)/);
 assert.match(content,/validation\.errors\.length\?validation\.errors\.slice\(0,4\)\.join\('；'\)/);
 // Story prose and unredacted WHIF native IDs must not enter diagnostics.
 const area=content.slice(content.indexOf('const rowFacts=collected.map('),content.indexOf("if(!validation.ok)throw Error(",content.indexOf('const rowFacts=collected.map(')));
 assert.doesNotMatch(area,/text:row\.text|nativeMessageId:|sampleText:|bodyText:/);
});


test('cycle 5 timed opening and native-verified untimed first reply remain paired with null clock provenance',()=>{
 assert.match(content,/const validation=core\.validate\(collected,target\.worldName\)/);
 assert.match(content,/if\(row\.verifiedUntimedNative\)messages\[i\]\.nativeClockEvidence='verified-original-without-game-time'/);
 assert.match(content,/verifiedUntimedNative:entry\.verifiedUntimedNative===true/);
 assert.match(content,/verifiedUntimedCount:valid\.verifiedUntimedCount\|\|0/);
 assert.match(content,/verifiedUntimedNative:index>0&&row\.role==='ai'/);
 assert.match(content,/openingPreviewStructure:\{/);
 assert.match(content,/if\(!validation\.ok\)throw Error/);
});

test('bottom completion hands off to named responsive validation stages',()=>{
 for(const stage of ['bottom-confirm','bottom-confirmed','integrity','source-audit','native-format','native-summary','serialize','download','failure'])
  assert.ok(content.includes("phaseStatus('"+stage+"'"),stage);
 assert.match(content,/checkedNative%8===0/);
 assert.match(content,/await yieldUi\(\);ensureRunning\(\)/);
 assert.match(content,/hash\(row\.text\)\]\.join/);
 assert.match(content,/背景下載佇列等待超過 12 秒/);
});
