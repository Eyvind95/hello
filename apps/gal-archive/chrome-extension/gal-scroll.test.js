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

test('scanner retains strict ordered overlap and 15-second bottom proof',()=>{
 assert.match(content,/const info=appendSample\(shot,collected\)|info=appendSample\(shot,collected\)/);
 assert.match(content,/const movement=await advanceScanScroll\(root,stepPx\)/);
 assert.match(content,/if\(!movement\.moved&&!movement\.atBottom\)/);
 assert.match(content,/scrollStall,scrollAtFailure,/);
 assert.match(content,/BOTTOM_CONFIRM_MS=15000/);
 assert.match(content,/if\(root\.scrollHeight!==proofHeight\|\|!isBottom\(root\)\)/);
});
