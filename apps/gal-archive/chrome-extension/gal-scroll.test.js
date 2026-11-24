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


const recoveryCtx=vm.createContext({});
const rowStart=content.indexOf('function sameRow('),rowEnd=content.indexOf('\nfunction observeEventAudit(',rowStart);
vm.runInContext('const WAIT_MS=420,STABLE_MS=350;\n'+content.slice(start,end)+'\n'+content.slice(rowStart,rowEnd)+'\nthis.recoverScanOverlap=recoverScanOverlap;this.proveRecoveryOverlap=proveRecoveryOverlap;this.appendSample=appendSample;this.trustedRecoveryAnchor=trustedRecoveryAnchor;',recoveryCtx);
const recover=recoveryCtx.recoverScanOverlap;
const nativeRow=(id,text='測試 '+id)=>({role:'ai',text,formatSource:{nativeReply:{reason:'available',markerCount:1,messageId:id}}});
const playerRow=(text)=>({role:'me',text});
function recoveryFixture(){
 const all=[nativeRow('a'),playerRow('舊玩家'),nativeRow('b')];
 const good={rows:[playerRow('舊玩家'),nativeRow('b'),playerRow('新玩家'),nativeRow('c')]};
 const bad={rows:[nativeRow('unrelated')]};
 return {all,good,bad};
}
test('V0.8.48 recovery proves overlap after +484px layout growth, without appending probes',async()=>{
 const root=scrolling(402698.375,411814,905),{all,good,bad}=recoveryFixture();
 const trusted={top:402418.78125,height:411814,id:'b',relativeTop:100};
 let waits=0;
 const result=await recover(root,trusted,all,()=>Math.abs(root.scrollTop-402902.78125)<2?good:bad,()=>null,async()=>{
  if(++waits===1){root.scrollHeight=412298;root.scrollTop=402903.59375}
 });
 assert.equal(result.ok,true);assert.equal(all.length,3);
 const merged=recoveryCtx.appendSample(result.shot,all);
 assert.equal(merged.repeated,2);assert.equal(merged.added,2);assert.equal(all.length,5);
 assert.equal(recoveryCtx.appendSample(result.shot,all).added,0);
});
test('V0.8.48 height-decrease candidate is verified rather than treated as a failed absolute rollback',async()=>{
 const root=scrolling(5280,10000,900),{all,good,bad}=recoveryFixture();
 const trusted={top:5000,height:10000,id:'b',relativeTop:80};
 let waits=0;
 const result=await recover(root,trusted,all,()=>root.scrollTop===4516?good:bad,()=>null,async()=>{if(++waits===1)root.scrollHeight=9516});
 assert.equal(result.ok,true);assert.equal(root.scrollTop,4516);assert.equal(all.length,3);
});
test('V0.8.48 native marker offset locates a trusted window even when height delta is misleading',async()=>{
 const root=scrolling(5280,10000,900),{all,good,bad}=recoveryFixture();
 const trusted=recoveryCtx.trustedRecoveryAnchor({scrollTop:5000,scrollHeight:10000},{rows:all},()=>80);
 const result=await recover(root,trusted,all,()=>root.scrollTop===4900?good:bad,()=>4900-root.scrollTop+80,async()=>{});
 assert.equal(result.ok,true);assert.equal(root.scrollTop,4900);assert.equal(all.length,3);
});
test('V0.8.48 recovery rejects unrelated, conflicting, ambiguous or repeated native IDs and stops within six probes',async()=>{
 const root=scrolling(5280,10000,900),{all,good,bad}=recoveryFixture();
 const proof=recoveryCtx.proveRecoveryOverlap;
 assert.equal(proof({rows:[nativeRow('other',all[2].text)]},all),false);
 assert.equal(proof({rows:[nativeRow('b','改過的正文')]},all),false);
 assert.equal(proof({rows:[nativeRow('b'),nativeRow('b')]},all),false);
 assert.equal(proof({rows:[nativeRow('b'),nativeRow('a')]},all),false);
 assert.equal(proof({rows:[{role:'ai',text:all[2].text}]},all),false);
 assert.equal(proof(good,all),true);
 const result=await recover(root,{top:5000,height:10000,id:'b',relativeTop:80},all,()=>bad,()=>null,async()=>{});
 assert.equal(result.ok,false);assert.ok(result.attempts.length<=6);assert.equal(all.length,3);
 assert.match(content,/if\(!recovered\.ok\)\s*throw Error/);
});
test('V0.8.48 recovery honors cancellation and container replacement',async()=>{
 const root=scrolling(5280,10000,900),{all,bad}=recoveryFixture();
 const trusted={top:5000,height:10000,id:'b',relativeTop:80};
 await assert.rejects(recover(root,trusted,all,()=>bad,()=>null,async()=>{root.isConnected=false}),/更換了訊息容器/);
 root.isConnected=true;let stopped=false;
 await assert.rejects(recover(root,trusted,all,()=>bad,()=>null,async()=>{stopped=true},()=>{if(stopped)throw Error('停止')}),/停止/);
});
