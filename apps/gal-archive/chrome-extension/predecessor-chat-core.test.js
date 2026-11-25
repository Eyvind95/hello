'use strict';
const test=require('node:test'),a=require('node:assert/strict'),c=require('./predecessor-chat-core');
const r=(id,role='user',text='相同正文')=>({id,role,text,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[]});
test('upward overlap preserves identical text with distinct source IDs',()=>{
 const rows=c.mergeUp([r('3'),r('4','assistant')],[r('1'),r('2','assistant'),r('3')]);a.deepEqual(rows.map(x=>x.id),['1','2','3','4']);
 a.deepEqual(c.mergeUp(rows,[r('2','assistant'),r('3')]),rows);
});
test('no gap, reordered, changed ID content, or new tail accepted',()=>{
 const prev=[r('3'),r('4'),r('5')];
 for(const v of [[r('1')],[r('1'),r('4')],[r('3'),r('5')],[r('4'),r('3')],[r('3','user','changed')],[r('3'),r('4'),r('5'),r('6')],[r('3'),r('3')]])a.throws(()=>c.mergeUp(prev,v));
});
const raw={format:c.FORMAT,version:1,canonical:false,fidelity:'rendered-dom',status:'completed',runId:'run',title:'測試',chatId:'abc',sourceUrl:'https://chatgpt.com/c/abc',startedAt:'2026-11-25T00:00:00Z',finishedAt:'2026-11-25T00:01:00Z',count:2,rows:[{...r('1'),index:0},{...r('2','assistant'),index:1}],warnings:[],error:null,evidence:{bottomReached:true,topReached:true,bottomStableMs:3100,topStableMs:8400,continuity:true,firstId:'1',lastId:'2'}};
test('independent raw import requires boundary evidence; incomplete is not classifiable',()=>{
 a.equal(c.validateRaw(raw).size,2);
 a.throws(()=>c.validateRaw({...raw,evidence:{...raw.evidence,topStableMs:100}}));
 a.throws(()=>c.validateRaw({...raw,canonical:true}));a.throws(()=>c.validateRaw({...raw,chatId:'wrong'}));
 const hash='a'.repeat(64),data={format:c.CLASS,version:1,chatId:'abc',sourceSha256:hash,items:[{id:'i',title:'交接',category:'交接稿',messageIds:['1']}]};
 a.deepEqual(c.validateClassification(raw,data,hash),{items:1,covered:1,total:2});
 a.throws(()=>c.validateClassification({...raw,status:'failed'},data,hash));
 a.throws(()=>c.validateClassification(raw,{...data,sourceSha256:'b'.repeat(64)},hash));
 a.throws(()=>c.validateClassification(raw,{...data,items:[{...data.items[0],messageIds:['not-real']}]},hash));
 a.throws(()=>c.validateClassification(raw,{...data,items:[{...data.items[0],text:'rewrite'}]},hash));
});

test('top/bottom proof requires stable exact boundaries and respects known accessibility ordinals',()=>{
 const rows=[r('1'),r('2','assistant'),r('3')];
 a.equal(c.edgeProof(rows,rows,{edge:'top',atEdge:true,stableMs:8500,position:1,total:3}),true);
 a.equal(c.edgeProof(rows.slice(1),rows,{edge:'top',atEdge:true,stableMs:8500}),false);
 a.equal(c.edgeProof(rows,rows,{edge:'top',atEdge:true,stableMs:8500,position:2,total:4}),false);
 a.equal(c.edgeProof(rows,rows,{edge:'top',atEdge:true,stableMs:8500,loading:true}),false);
 a.equal(c.edgeProof(rows,rows,{edge:'bottom',atEdge:true,stableMs:3500,position:2,total:3}),false);
 a.equal(c.edgeProof(rows,rows,{edge:'bottom',atEdge:true,stableMs:3500,position:3,total:3}),true);
});
test('attachment-only rows accepted, repeated source IDs and positional evidence rejected',()=>{
 const media={...r('media'),text:'',attachments:[{kind:'attachment-reference',label:'file.pdf',url:null}]};
 a.equal(c.validateRows([media]).size,1);
 a.throws(()=>c.validateRows([{...media,attachments:[]}]));
 a.throws(()=>c.validateRows([{...media,identityBasis:'position'}]));
 a.throws(()=>c.validateRows([media,media]));
});

test('ten-message sample stops at ten, allows proven short chats, and cannot be imported as full history',()=>{
 const rows=Array.from({length:13},(_,i)=>({...r(String(i),i%2?'assistant':'user'),index:i}));
 a.equal(c.sampleReady(rows,false,false),false);
 a.equal(c.sampleReady(rows.slice(0,9),true,false),false);
 a.equal(c.sampleReady(rows.slice(0,9),true,true),true);
 a.equal(c.sampleReady(rows,true,false),true);
 a.deepEqual(c.sampleRows(rows).map(x=>x.id),rows.slice(3).map(x=>x.id));
 const tail=c.sampleRows(rows).map((x,index)=>({...x,index}));
 const sample={...raw,format:c.SAMPLE,scope:'sample-10',sampleLimit:10,importable:false,count:10,rows:tail,evidence:{...raw.evidence,topReached:false,topStableMs:0,firstId:'3',lastId:'12'}};
 a.equal(c.validateSample(sample).size,10);
 a.throws(()=>c.validateRaw(sample));a.throws(()=>c.validateRaw({...sample,format:c.FORMAT}));
 a.throws(()=>c.validateClassification(sample,{},'a'.repeat(64)));
 a.throws(()=>c.validateSample({...sample,count:9,rows:tail.slice(1)}));
 a.equal(c.validateSample({...sample,count:2,rows:raw.rows,evidence:raw.evidence}).size,2);
 a.equal(c.validateSample({...sample,status:'failed',count:0,rows:[],error:'failed'}).size,0);
});

test('temporary image references can rotate while preserving raw URL and evidence; other changes remain fatal',()=>{
 const old={...r('image'),attachments:[{kind:'image-reference',label:'附件',url:'blob:https://chatgpt.com/11111111-1111-4111-8111-111111111111'}]};
 const fresh={...old,attachments:[{...old.attachments[0],url:'blob:https://chatgpt.com/22222222-2222-4222-8222-222222222222'}]};
 const changes=[];a.deepEqual(c.mergeUp([old],[fresh],x=>changes.push(x)),[old]);a.equal(changes.length,1);a.equal(changes[0].bytesVerified,false);
 a.equal(c.fingerprint([old]),c.fingerprint([fresh]));
 for(const changed of [{...fresh,text:'正文改變'},{...fresh,structure:[{tag:'p',text:'改變'}]},{...fresh,attachments:[]},{...fresh,attachments:[{...fresh.attachments[0],label:'不同附件'}]},{...fresh,attachments:[{...fresh.attachments[0],url:'https://example.com/new.png'}]}]){
  a.throws(()=>c.mergeUp([old],[changed]),err=>err.overlapEvidence.messageId==='image'&&err.overlapEvidence.fields.length>0);
 }
});
test('twenty-message bounded proof and generic title rejection',()=>{
 const rows=Array.from({length:20},(_,i)=>({...r(String(i)),index:i}));
 a.equal(c.sampleReady(rows.slice(0,14),true,false,20),false);a.equal(c.sampleReady(rows,true,false,20),true);
 const sample={...raw,format:c.SAMPLE,scope:'sample-20',sampleLimit:20,importable:false,count:20,rows,evidence:{...raw.evidence,firstId:'0',lastId:'19',topReached:false,topStableMs:0}};
 a.equal(c.validateSample(sample).size,20);a.throws(()=>c.validateRaw(sample));
 a.throws(()=>c.validateSample({...sample,scope:'sample-10'}));
 for(const title of ['新對話','New chat','ChatGPT','新聊天 - ChatGPT'])a.equal(c.chatTitle(title),'');
 a.equal(c.chatTitle('小貓前輩 - ChatGPT'),'小貓前輩');
});

test('adaptive scan accelerates over repeated windows, never resets no-growth deadline on scrolling',()=>{
 a.equal(c.scrollStep(1000,0),850);a.equal(c.scrollStep(1000,3),1500);a.equal(c.scrollStep(1000,8),2500);
 a.equal(c.noNewRows(1000,60999),false);a.equal(c.noNewRows(1000,61000),true);
 a.equal(c.noNewRows(60000,61000),false);
 a.throws(()=>c.mergeUp([r('3')],[r('1')]));
 a.deepEqual(c.mergeUp([r('3')],[r('1'),r('2'),r('3')]).map(x=>x.id),['1','2','3']);
});

test('actual historyRun exits no-growth despite continued scroll movements',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  async function historyRun(b)'),src.indexOf('  async function historyBegin('));
 let now=1000,output,positions=[];
 const rows=[r('1'),r('2','assistant')];
 const host={scrollTop:100000,scrollHeight:100100,clientHeight:100};
 const b={host,rows:[],sample:20,bottomReached:false,topReached:false,bottomStableMs:0,topStableMs:0,windows:0,scrollStats:{attempts:0,overlapRetries:0,noGrowthWindows:0},overlapIssues:[],download:{},stop:{},pane:{}};
 const ctx={Date:{now:()=>now},pc:{...c,validateSample:()=>{}},state:{bulk:b},historyGuard:()=>{},historyLocateHost:async()=>{},historyHostObservation:()=>{},historyStatus:()=>{},historyScroll:(h,to)=>{h.scrollTop=Math.min(h.scrollHeight-h.clientHeight,Math.max(0,to));positions.push(h.scrollTop)},historySettled:async()=>{now+=700;return rows},historyAtBottom:h=>h.scrollTop===h.scrollHeight-h.clientHeight,historyLoading:()=>false,historyEdgeOrdinal:()=>({}),historyAttachmentChange:()=>{},historyTrace:()=>{},sleep:async ms=>{now+=ms},historyPayload:(b,status,error)=>({status,error,count:b.rows.length}),historyDownload:d=>{output=d;return 'sample.json'}};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.run=historyRun;',ctx);await ctx.run(b);
 a.equal(output.status,'failed');a.match(output.error,/60秒未取得新訊息/);a.equal(output.count,2);
 a.ok(b.scrollStats.noGrowthWindows>8);a.ok(positions.some((v,i)=>i>0&&positions[i-1]-v>=250));a.ok(now<75000);
});

test('downward auto-scroll jump is detected without mistaking height changes or small jitter',()=>{
 a.equal(c.scrollReset(7037,22200.8,22875,22875,674),true);
 a.equal(c.scrollReset(7037,7038,22875,22875,674),false);
 a.equal(c.scrollReset(7037,22200.8,25000,22875,674),false);
 a.equal(c.scrollReset(7037,5000,22875,22875,674),false);
});
test('scroll recovery returns to intended target, records the reset and does not claim new rows',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  async function historySettled('));
 const trace=[],b={host:{scrollTop:22200.8,scrollHeight:22875,clientHeight:674},scrollStats:{scrollResets:0},rows:[r('1')]};
 const ctx={pc:c,historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>h.scrollTop=to};
 vm.runInNewContext(block+';globalThis.recover=historyRecoverScroll;',ctx);
 a.equal(ctx.recover(b,7037,22875,'test').target,7037);a.equal(b.host.scrollTop,7037);a.equal(b.rows.length,1);a.equal(b.scrollStats.scrollResets,1);a.equal(trace[0].event,'scroll-reset');
 a.equal(ctx.recover(b,7037,22875,'test'),null);
});

test('late single generic user image observation enriches row, preserves evidence, never removes it',()=>{
 const old=r('late'),fresh={...old,attachments:[{kind:'image-reference',label:'使用者附件',url:'blob:https://chatgpt.com/11111111-1111-4111-8111-111111111111'}]};
 const changes=[];
 const rows=c.mergeUp([old],[r('older'),fresh],x=>changes.push(x));
 a.deepEqual(rows,[r('older'),fresh]);a.deepEqual(old.attachments,[]);
 a.equal(changes[0].type,'image-reference-appeared');a.deepEqual(changes[0].previousAttachments,[]);a.equal(changes[0].attachmentCountVerified,false);
 a.deepEqual(c.mergeUp(rows,[old],x=>changes.push(x)),rows);
 a.equal(changes[1].type,'image-reference-not-observed');
 for(const candidate of [{...fresh,text:'changed'},{...fresh,attachments:[...fresh.attachments,...fresh.attachments]},{...fresh,attachments:[{...fresh.attachments[0],label:'其他'}]},{...fresh,attachments:[{...fresh.attachments[0],url:'https://example.com/file'}]}])a.throws(()=>c.mergeUp([old],[candidate]));
 a.throws(()=>c.mergeUp([{...old,role:'assistant'}],[{...fresh,role:'assistant'}]));
 a.throws(()=>c.mergeUp([fresh],[{...fresh,attachments:[...fresh.attachments,...fresh.attachments]}]));
 const rejected=[];a.throws(()=>c.mergeUp([old,r('next')],[fresh,r('next','user','changed')],x=>rejected.push(x)));a.deepEqual(rejected,[]);
});

test('predecessor settle reads without clicking even when a long message has a fold control',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  async function historySettled('),src.indexOf('  function historyGuard('));
 let now=1000,reads=0,clicks=0;const rows=[r('1')];
 const control={click:()=>clicks++};
 const b={host:{scrollTop:100,scrollHeight:1000,clientHeight:100},scrollStats:{expansionClicks:0,expansionRestores:0,fingerprintChanges:0},stabilityIssues:[]};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyLoading:()=>false,historyRoot:()=>({querySelectorAll:()=>[control]}),expandButtons:()=>[control],historyVisible:()=>true,historyRead:(host,onFold)=>{reads++;onFold({messageId:'1',label:'顯示較多'});return rows},historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyStatus:()=>{},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 a.deepEqual(await ctx.settle(b),rows);a.equal(clicks,0);a.equal(reads,3);a.equal(b.scrollStats.expansionClicks,0);
 a.match(src,/await expandCollapsed\(4\)/);
});
test('passive text keeps complete DOM content and strips only a proven trailing UI control',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyReadText('),src.indexOf('  function historyRead(host'));
 let label='顯示較多',after='',contained=true;const observed=[];
 const control={get innerText(){return label},getAttribute:()=>null};
 const body={get innerText(){return '正文\n顯示較少\n'+label},contains:()=>contained,childNodes:[control]};
 const nestedControl={get innerText(){return label},getAttribute:()=>null};
 const owner={querySelectorAll:()=>[control,nestedControl]};
 const ctx={expandButtons:()=>[control],historyVisible:()=>true,EXPAND_LABEL:/^顯示較多$/,document:{createRange:()=>({setStartAfter:()=>{},setEnd:()=>{},toString:()=>after})}};
 vm.runInNewContext(block+';globalThis.read=historyReadText;',ctx);
 a.equal(ctx.read(body,owner,'1',x=>observed.push(x)),'正文\n顯示較少');
 label='顯示較少';a.equal(ctx.read(body,owner,'1',()=>{}),'正文\n顯示較少');
 after='真正的後續正文';a.equal(ctx.read(body,owner,'1',()=>{}),body.innerText);
 after='';contained=false;a.equal(ctx.read(body,owner,'1',()=>{}),body.innerText);
 a.equal(observed[0].fullTextVerified,false);
});

test('virtualized height changes do not mask a large jump to bottom',()=>{
 // Synthetic coordinates representing the observed failure pattern.
 a.equal(c.scrollRecoveryTarget(19586,40543.2,41217,40478,674),20325);
 a.equal(c.scrollRecoveryTarget(27064,41568,42242,41217,674),28089);
 a.equal(c.scrollRecoveryTarget(15271,40886.4,41560,41217,674),15614);
 // Normal prepend/resize, small shift near bottom, and upward movement.
 a.equal(c.scrollRecoveryTarget(19586,20325,41217,40478,674),null);
 a.equal(c.scrollRecoveryTarget(39800,40543.2,41217,40478,674),null);
 a.equal(c.scrollRecoveryTarget(19586,19000,41217,40478,674),null);
 a.equal(c.scrollRecoveryTarget(19586,35000,41217,40478,674),null);
});
test('settle recovers across height change before accepting stable rows without expanding',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000;const rows=[r('1')],trace=[],positions=[];
 const b={host:{scrollTop:40543.2,scrollHeight:41217,clientHeight:674},scrollStats:{scrollResets:0,fingerprintChanges:0},stabilityIssues:[]};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyLoading:()=>false,historyRead:()=>rows,historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyStatus:()=>{},historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>{h.scrollTop=to;positions.push(to)},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 a.deepEqual(await ctx.settle(b,{upward:true,target:19586,targetHeight:40478}),rows);
 a.deepEqual(positions,[20325]);a.equal(b.scrollStats.scrollResets,1);a.equal(trace[0].expectedHeight,40478);a.equal(trace[0].currentHeight,41217);
});

test('breakthrough activates at five resets, tries three increasing steps, resets after growth',()=>{
 const state={resets:4,attempts:0};
 a.equal(c.breakthroughStep(state,674),0);
 state.resets=5;a.equal(c.breakthroughStep(state,674),3370);
 state.attempts=1;a.equal(c.breakthroughStep(state,674),5055);
 state.attempts=2;a.equal(c.breakthroughStep(state,674),6740);
 state.attempts=3;a.equal(c.breakthroughStep(state,674),0);
 state.resets=0;state.attempts=0;a.equal(c.breakthroughStep(state,674),0);
 a.equal(c.frontierPosition({top:10000,height:500000},501000,674),11000);
 a.equal(c.frontierPosition(null,501000,674),null);
 // No new window is accepted simply because its coordinate is plausible.
 a.throws(()=>c.mergeUp([r('anchor')],[r('unknown')]));
});
test('five repeated resets recover from the accepted frontier and cap strong attempts',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  async function historySettled('));
 const trace=[],b={host:{scrollTop:499326,scrollHeight:500000,clientHeight:674},scrollStats:{scrollResets:0},rows:[r('anchor')],breakthrough:{resets:4,attempts:0,frontier:{id:'anchor',top:10000,height:500000}}};
 const ctx={pc:c,historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>h.scrollTop=to};
 vm.runInNewContext(block+';globalThis.recover=historyRecoverScroll;',ctx);
 for(const expected of [6630,4945,3260,10000]){
  b.host.scrollTop=499326;a.equal(ctx.recover(b,450000,500000,'test').target,expected);
 }
 a.equal(b.scrollStats.breakthroughAttempts,3);a.equal(b.rows.length,1);
 a.equal(trace.filter(x=>x.event==='breakthrough-attempt').length,3);
});

test('zero range and known minimum prevent false completed tail',()=>{
 a.equal(c.scrollRange(674,674),0);
 a.equal(c.fullCoverageGate(4,179,0,false),false);
 a.equal(c.fullCoverageGate(4,179,20000,true),false);
 a.equal(c.fullCoverageGate(179,179,20000,false),false);
 a.equal(c.fullCoverageGate(179,179,20000,true),true);
 const fake={...raw,scannerVersion:'0.10.19',evidence:{...raw.evidence,scrollTrace:[{scrollHeight:674,clientHeight:674}],breakthroughState:{frontier:{height:674}}}};
 a.throws(()=>c.validateRaw(fake),/無有效捲動距離/);
 a.throws(()=>c.validateRaw({...raw,scannerVersion:'0.10.20'}),/缺少可捲動容器/);
 a.equal(c.validateRaw({...raw,scannerVersion:'0.10.20',evidence:{...raw.evidence,knownMinimum:2,hostProof:{maxRange:2000,observedMovement:true}}}).size,2);
});

test('overlap retry coordinates are rebased after virtualized height growth',()=>{
 const anchor={top:7245.6,height:189467};
 a.equal(c.rejoinTarget(anchor,210101,674,0),27879.6);
 a.equal(c.rejoinTarget(anchor,207817,674,0),25595.6);
 a.equal(c.rejoinTarget(anchor,207817,674,0,false),7245.6);
 a.equal(c.rejoinTarget(anchor,207817,674,-674),24921.6);
 a.equal(c.rejoinTarget(anchor,1000,674,-100000),0);
 a.throws(()=>c.mergeUp([r('anchor')],[r('unrelated')]),/沒有重疊/);
});
test('rejoin recovery suppresses further breakthroughs without dropping reset evidence',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  async function historySettled('));
 const b={host:{scrollTop:209427,scrollHeight:210101,clientHeight:674},scrollStats:{scrollResets:0},rows:[r('anchor')],breakthrough:{resets:4,attempts:0,frontier:null}};
 const ctx={pc:c,historyTrace:()=>{},historyScroll:(h,to)=>h.scrollTop=to};
 vm.runInNewContext(block+';globalThis.recover=historyRecoverScroll;',ctx);
 const actual=ctx.recover(b,7245.6,189467,'test',false);
 a.equal(actual.target,27879.6);a.equal(b.breakthrough.resets,5);a.equal(b.breakthrough.attempts,0);
});
test('actual historyRun rejoins after height changes during an unsuccessful upward probe',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  async function historyRun(b)'),src.indexOf('  async function historyBegin('));
 let now=1000,output,up=0,targets=[];
 const tail=[r('tail')],older=[r('older'),r('tail')],host={scrollTop:10000,scrollHeight:10100,clientHeight:100};
 const b={host,rows:[],sample:10,bottomReached:false,topReached:false,bottomStableMs:0,topStableMs:0,windows:0,scrollStats:{attempts:0,overlapRetries:0,noGrowthWindows:0},overlapIssues:[],download:{},stop:{},pane:{}};
 const ctx={Date:{now:()=>now},pc:{...c,sampleReady:rs=>rs.length===2,validateSample:()=>{}},state:{bulk:b},historyGuard:()=>{},historyLocateHost:async()=>{},historyHostObservation:()=>{},historyStatus:()=>{},historyScroll:(h,to)=>h.scrollTop=Math.min(h.scrollHeight-h.clientHeight,Math.max(0,to)),historySettled:async(b,o)=>{now+=700;if(!o.upward)return tail;targets.push({target:o.target,allowBoost:o.allowBoost});if(++up===1){host.scrollHeight+=20000;return [r('unrelated')]}return older},historyAtBottom:h=>h.scrollTop===h.scrollHeight-h.clientHeight,historyLoading:()=>false,historyEdgeOrdinal:()=>({}),historyAttachmentChange:()=>{},historyTrace:()=>{},sleep:async ms=>{now+=ms},historyPayload:(b,status,error)=>({status,error,count:b.rows.length}),historyDownload:d=>{output=d;return 'sample.json'}};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.run=historyRun;',ctx);await ctx.run(b);
 a.equal(output.status,'completed');a.equal(output.count,2);a.equal(targets[0].target,9915);a.equal(targets[1].target,29957.5);a.equal(targets[1].allowBoost,false);a.equal(b.scrollStats.rejoinSuccesses,1);
});

test('two distinct delayed generic images enrich empty or exact ordered subset observations',()=>{
 const old=r('multi'),img=i=>({kind:'image-reference',label:'使用者附件',url:'blob:https://chatgpt.com/'+i.repeat(8)+'-1111-4111-8111-111111111111'});
 const fresh={...old,attachments:[img('1'),img('2')]},changes=[];
 a.deepEqual(c.mergeUp([old],[fresh],x=>changes.push(x)),[fresh]);
 a.equal(changes[0].currentAttachments.length,2);
 a.deepEqual(c.mergeUp([fresh],[old]),[fresh]);
 a.deepEqual(c.mergeUp([{...old,attachments:[img('1')]}],[fresh]),[fresh]);
 a.throws(()=>c.mergeUp([{...old,attachments:[img('3')]}],[fresh]));
 a.throws(()=>c.mergeUp([old],[{...fresh,attachments:[img('1'),img('1')]}]));
 a.throws(()=>c.mergeUp([old],[{...fresh,text:'changed'}]));
});
test('resume checkpoint rejects samples, false edges, other chats and unverified inherited checkpoints',()=>{
 const cp={...raw,status:'failed',scannerVersion:'0.10.21',error:'stopped',evidence:{...raw.evidence,topReached:false,continuity:false,windows:3,hostProof:{maxRange:2000,observedMovement:true}}};
 const rows=c.validateCheckpoint(cp,raw.sourceUrl);
 a.deepEqual(rows,[r('1'),r('2','assistant')]);
 a.throws(()=>c.validateCheckpoint(raw,raw.sourceUrl));
 a.throws(()=>c.validateCheckpoint(cp,'https://chatgpt.com/c/other'));
 a.throws(()=>c.validateCheckpoint({...cp,evidence:{...cp.evidence,hostProof:{maxRange:0,observedMovement:false}}},raw.sourceUrl));
 a.throws(()=>c.validateCheckpoint({...cp,evidence:{...cp.evidence,resume:{tailVerified:true,frontierVerified:false}}},raw.sourceUrl));
});
test('resume validates tail, fast return interior, and two adjacent frontier rows without accepting gaps',()=>{
 const saved=Array.from({length:30},(_,i)=>r(String(i)));
 const seeded=c.resumeSeed(saved,saved.slice(-3));
 a.equal(seeded.minIndex,27);a.equal(seeded.rows.length,30);a.equal(seeded.frontier,false);
 a.equal(c.resumeStep(674,27),3370);a.equal(c.resumeStep(674,12),0);
 a.throws(()=>c.resumeSeed(saved,saved.slice(5,10)));
 a.throws(()=>c.resumeSeed(saved,[saved[27],saved[29]]));
 a.throws(()=>c.resumeSeed(saved,[saved[28],{...saved[29],text:'different'}]));
 a.equal(c.resumeWindow(saved,saved.slice(0,1)).frontier,false);
 a.equal(c.resumeWindow(saved,saved.slice(0,2)).frontier,true);
 a.deepEqual(c.mergeUp(saved,[r('earlier'),...saved.slice(0,2)]).map(x=>x.id),['earlier',...saved.map(x=>x.id)]);
 a.throws(()=>c.validateRaw({...raw,evidence:{...raw.evidence,resume:{baseCount:2,tailVerified:true,frontierVerified:false,sourceSha256:'a'.repeat(64)}}}));
});

test('actual historyRun resumes from a validated tail, fast returns and then extends the checkpoint',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  async function historyRun(b)'),src.indexOf('  async function historyBegin('));
 const saved=Array.from({length:30},(_,i)=>r(String(i))),older=r('older');
 let now=1000,output,up=0;const trace=[],targets=[];
 const host={scrollTop:10000,scrollHeight:10100,clientHeight:100};
 const b={host,rows:[],sample:0,knownMinimum:30,resumeRows:saved,resume:{baseCount:30,tailVerified:false,frontierVerified:false,minIndex:30,checkedWindows:0},hostProof:{maxRange:10000,observedMovement:true},bottomReached:false,topReached:false,bottomStableMs:0,topStableMs:0,windows:0,scrollStats:{attempts:0,overlapRetries:0,noGrowthWindows:0},overlapIssues:[],download:{},stop:{},pane:{},chat:'/c/abc'};
 const ctx={Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},pc:{...c,validateRaw:()=>{}},state:{bulk:b},chrome:{storage:{local:{set:async()=>{}}}},historyGuard:()=>{},historyLocateHost:async()=>{},historyHostObservation:()=>{},historyStatus:()=>{},historyScroll:(h,to)=>h.scrollTop=Math.min(h.scrollHeight-h.clientHeight,Math.max(0,to)),historySettled:async(b,o)=>{
   now+=1000;if(!o.upward)return saved.slice(-3);
   targets.push(o.target);up++;
   if(up===1)return saved.slice(24,28);
   if(up===2)return saved.slice(8,12);
   if(up===3)return saved.slice(0,3);
   host.scrollTop=0;return [older,...saved.slice(0,3)];
 },historyAtBottom:h=>h.scrollTop===h.scrollHeight-h.clientHeight,historyLoading:()=>false,historyEdgeOrdinal:()=>({}),historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push(event),sleep:async ms=>{now+=ms},historyPayload:(b,status,error)=>({status,error,count:b.rows.length,rows:b.rows,evidence:{resume:b.resume}}),historyDownload:d=>{output=d;return 'resume.json'}};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.run=historyRun;',ctx);await ctx.run(b);
 a.equal(output.status,'completed',output.error);a.equal(output.count,31);a.equal(output.rows[0].id,'older');
 a.equal(output.evidence.resume.tailVerified,true);a.equal(output.evidence.resume.frontierVerified,true);
 a.equal(targets[0],9500);a.ok(trace.includes('resume-tail-verified'));a.ok(trace.includes('resume-frontier-verified'));
});

test('repeated recovery destinations lock for three attempts instead of chasing alternating heights',()=>{
 const p={};a.equal(c.recoveryCycle(p,2982,674).delay,180);
 a.equal(c.recoveryCycle(p,8625,674).detected,false);
 const lock=c.recoveryCycle(p,2982,674);a.equal(lock.detected,true);a.equal(lock.destination,2982);a.equal(lock.delay,800);
 a.equal(c.recoveryCycle(p,8625,674).destination,2982);
 a.equal(c.recoveryCycle(p,2982,674).delay,2400);
 a.equal(c.recoveryCycle(p,8625,674).exhausted,true);
});
test('actual historySettled bounds recovery cycle and emits recoverable error',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000;const trace=[],delays=[];
 const b={host:{scrollTop:761642,scrollHeight:762316,clientHeight:674},scrollStats:{scrollResets:0},rows:[r('anchor')],breakthrough:{resets:0,attempts:3,frontier:null}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>{h.scrollTop=to},sleep:async ms=>{now+=ms;delays.push(ms);b.host.scrollHeight=b.host.scrollHeight===762316?756683:762316;b.host.scrollTop=b.host.scrollHeight-674}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 await a.rejects(ctx.settle(b,{upward:true,target:2982,targetHeight:756683,allowBoost:false}),e=>e.code==='HISTORY_RECOVERY_RETRY');
 a.equal(b.scrollStats.recoveryCycles,1);a.ok(delays.includes(800));a.ok(delays.includes(1600));a.ok(b.scrollStats.scrollResets<=9);
 a.equal(b.rows.length,1);
});
test('actual historyRun tries another overlap plan after bounded recovery failure',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  async function historyRun(b)'),src.indexOf('  async function historyBegin('));
 let now=1000,output,up=0;const targets=[];
 const tail=[r('tail')],older=[r('older'),r('tail')],host={scrollTop:10000,scrollHeight:10100,clientHeight:100};
 const b={host,rows:[],sample:10,bottomReached:false,topReached:false,bottomStableMs:0,topStableMs:0,windows:0,scrollStats:{attempts:0,overlapRetries:0,noGrowthWindows:0},overlapIssues:[],download:{},stop:{},pane:{}};
 const ctx={Date:{now:()=>now},pc:{...c,sampleReady:rs=>rs.length===2,validateSample:()=>{}},state:{bulk:b},historyGuard:()=>{},historyLocateHost:async()=>{},historyHostObservation:()=>{},historyStatus:()=>{},historyScroll:(h,to)=>h.scrollTop=Math.min(h.scrollHeight-h.clientHeight,Math.max(0,to)),historySettled:async(b,o)=>{now+=700;if(!o.upward)return tail;targets.push(o);if(++up===1)throw Object.assign(Error('頁面反覆自動返回底端；本次定位策略無法穩定'),{code:'HISTORY_RECOVERY_RETRY'});return older},historyAtBottom:h=>h.scrollTop===h.scrollHeight-h.clientHeight,historyLoading:()=>false,historyEdgeOrdinal:()=>({}),historyAttachmentChange:()=>{},historyTrace:()=>{},sleep:async ms=>{now+=ms},historyPayload:(b,status,error)=>({status,error,count:b.rows.length}),historyDownload:d=>{output=d;return 'sample.json'}};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.run=historyRun;',ctx);await ctx.run(b);
 a.equal(output.status,'completed');a.equal(output.count,2);a.equal(targets[1].allowBoost,false);a.equal(b.scrollStats.recoveryPlanRetries,1);
});

test('two resets per stable old window retain cross-window cycle evidence',()=>{
 const state={resets:4,attempts:3};
 let p=c.recoveryPolicy(state);
 c.recoveryCycle(p,10199.8,674);c.recoveryCycle(p,15832.8,674);
 // A successful read of the same old window is not historical progress.
 p=c.recoveryPolicy(state);
 const lock=c.recoveryCycle(p,10199.8,674);
 a.equal(lock.detected,true);a.equal(lock.crossWindow,true);a.equal(lock.destination,10199.8);
 a.equal(c.recoveryCycle(p,15832.8,674).destination,10199.8);
 p=c.recoveryPolicy(state);
 a.equal(c.recoveryCycle(p,10199.8,674).delay,2400);
 a.equal(c.recoveryCycle(p,15832.8,674).exhausted,true);
 c.alternateRecoveryPolicy(state);a.equal(state.recoveryAvoidFrontier,true);
 a.equal(c.recoveryPolicy(state).locked,null);
 c.clearRecoveryPolicy(state);a.equal(state.recoveryAvoidFrontier,undefined);
 a.deepEqual(c.recoveryPolicy(state).recent,[]);
});
test('actual historyRecoverScroll preserves a new probe rather than competing frontier compensation',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  async function historySettled('));
 const b={host:{scrollTop:765609,scrollHeight:766283,clientHeight:674},scrollStats:{scrollResets:0},rows:[r('anchor')],breakthrough:{resets:4,attempts:3,frontier:{id:'anchor',top:5700.8,height:761784}}};
 const ctx={pc:c,historyTrace:()=>{},historyScroll:(h,to)=>h.scrollTop=to};
 vm.runInNewContext(block+';globalThis.recover=historyRecoverScroll;',ctx);
 a.ok(Math.abs(ctx.recover(b,14137.4,766273,'test').target-10199.8)<.01);
 c.alternateRecoveryPolicy(b.breakthrough);b.host.scrollTop=765609;
 a.equal(ctx.recover(b,14137.4,766273,'test',false).target,14137.4);
 a.equal(b.scrollStats.frontierRestores,1);
});
test('actual historySettled detects A/B/A across independently stable old windows',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8');
 const block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000,phase=0,scrolls=0;const trace=[],rows=[r('old')];
 const b={host:{scrollTop:765609,scrollHeight:766283,clientHeight:674},scrollStats:{scrollResets:0,fingerprintChanges:0},stabilityIssues:[],rows,breakthrough:{resets:0,attempts:3,frontier:{id:'old',top:5700.8,height:761784}}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>rows,historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>{h.scrollTop=to;scrolls++},sleep:async ms=>{now+=ms;if(phase===0&&scrolls===1){b.host.scrollHeight=771916;b.host.scrollTop=771242}}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 await ctx.settle(b,{upward:true,target:14137.4,targetHeight:766273,allowBoost:false});
 a.equal(b.scrollStats.scrollResets,2);a.equal(b.scrollStats.recoveryCycles,undefined);
 phase=1;b.host.scrollHeight=766283;b.host.scrollTop=765609;
 await ctx.settle(b,{upward:true,target:14137.4,targetHeight:766273,allowBoost:false});
 a.equal(b.scrollStats.crossWindowCycles,1);
 a.equal(trace.find(x=>x.event==='recovery-cycle').crossWindow,true);
 a.equal(b.rows.length,1);
});

test('only proven composite code label and span split is equivalent; preserve both observations',()=>{
 const code='line one\n\nline two 99.7%',text='before\n'+code+'\nafter';
 const row={...r('code','assistant'),text,contentBasis:'composite-after-user-dom',structure:[{tag:'code',text:code}],domTextSegments:[{tag:'span',text:'before'},{tag:'span',text:code},{tag:'span',text:'after'}]};
 const metrics=x=>({...x,sourceTextNodes:x.domTextSegments.length,sourceTextCharacters:x.domTextSegments.reduce((n,z)=>n+z.text.length,0)});
 const a0=metrics(row),b0=metrics({...row,text:'before\n程式碼\n'+code+'\nafter',domTextSegments:[row.domTextSegments[0],{tag:'div',text:'程式碼'},{tag:'span',text:'line one'},{tag:'span',text:'\n\n'},{tag:'span',text:'line two 99'},{tag:'span',text:'.7%'},row.domTextSegments[2]]});
 const changes=[];a.deepEqual(c.mergeUp([a0],[b0],x=>changes.push(x)),[a0]);a.equal(changes[0].type,'code-render-label-variant');a.deepEqual(changes[0].current,b0);
 a.deepEqual(c.mergeUp([b0],[a0]),[b0]);
 a.throws(()=>c.mergeUp([a0],[{...b0,structure:[]}]));
 a.throws(()=>c.mergeUp([a0],[{...b0,text:b0.text.replace('99.7','99.8')}]));
 a.throws(()=>c.mergeUp([a0],[metrics({...b0,domTextSegments:b0.domTextSegments.map((z,i)=>i===1?{...z,tag:'span'}:z)})]));
 a.throws(()=>c.mergeUp([a0],[{...b0,sourceTextNodes:99}]));
});
test('bottom escape requires repeated actual edge resets, limited to two until progress',()=>{
 const state={resets:5};
 a.equal(c.bottomEscape(state,500,50000,51000,674),null);
 for(let i=0;i<2;i++)a.equal(c.bottomEscape(state,500,50326,51000,674),null);
 a.equal(c.bottomEscape(state,500,50326,51000,674),49989);
 for(let i=0;i<2;i++)a.equal(c.bottomEscape(state,500,50326,51000,674),null);
 a.equal(c.bottomEscape(state,500,50326,51000,674),49989);
 for(let i=0;i<4;i++)a.equal(c.bottomEscape(state,500,50326,51000,674),null);
 c.clearRecoveryPolicy(state);a.equal(state.bottomEscapeAttempts,undefined);
});
test('actual settle nudges up from bottom before returning to upper target',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000;const trace=[],moves=[],rows=[r('anchor')];
 const b={host:{scrollTop:50326,scrollHeight:51000,clientHeight:674},scrollStats:{scrollResets:0},rows,breakthrough:{resets:4,attempts:3,frontier:null,bottomEscapeHits:2}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>rows,historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push(event),historyScroll:(h,to)=>{h.scrollTop=to;moves.push(to)},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 await ctx.settle(b,{upward:true,target:500,targetHeight:51000,allowBoost:false});
 a.deepEqual(moves,[49989,500]);a.equal(b.scrollStats.bottomEscapeAttempts,1);a.equal(b.scrollStats.bottomEscapeDepartures,1);a.ok(trace.includes('bottom-escape-return'));a.equal(b.rows.length,1);
});

test('long alternate recovery can escape a far bottom even after two direct attempts, but is bounded',()=>{
 const state={resets:53,bottomEscapeAttempts:2,recoveryAvoidFrontier:true};
 for(let i=0;i<2;i++)a.equal(c.bottomEscape(state,1998.8,842380,843054,674),null);
 a.equal(c.bottomEscape(state,1998.8,842380,843054,674),842043);
 for(let i=0;i<2;i++)a.equal(c.bottomEscape(state,2841.3,842380,843054,674),null);
 a.equal(c.bottomEscape(state,2841.3,842380,843054,674),842043);
 for(let i=0;i<4;i++)a.equal(c.bottomEscape(state,2841.3,842380,843054,674),null);
 a.equal(c.escapeStageCount(842043,1998.8,674),13);
 a.equal(c.escapeStageCount(1410338,0,674),21);
 a.equal(c.escapeStageCount(5000000,0,674),24);
 a.equal(c.escapeStageCount(49989,500,674),1);
 a.equal(c.escapeStageTarget(100,0,2),50);
});
test('actual settle stages the long bottom return; verifies stable rows after landing',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000;const trace=[],moves=[],rows=[r('anchor')];
 const b={host:{scrollTop:842380,scrollHeight:843054,clientHeight:674},scrollStats:{scrollResets:0},rows,breakthrough:{resets:53,attempts:0,frontier:null,bottomEscapeHits:2,bottomEscapeAttempts:2,recoveryAvoidFrontier:true}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>rows,historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push(event),historyScroll:(h,to)=>{moves.push(to);h.scrollTop=Math.abs(h.scrollTop-to)>180000?842380:to},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 const result=await ctx.settle(b,{upward:true,target:1998.8,targetHeight:843054,allowBoost:false});
 a.deepEqual(result,rows);a.equal(moves.length,14);a.equal(moves[0],842043);a.ok(Math.abs(moves.at(-1)-1998.8)<.01);
 a.equal(b.scrollStats.stagedReturnLandings,13);a.equal(b.scrollStats.stagedReturnArrivals,1);a.equal(b.rows.length,1);
 a.ok(trace.includes('bottom-escape-arrived'));
});
test('actual long staged return fails closed when an intermediate waypoint snaps back',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000,reads=0;const trace=[],rows=[r('anchor')];
 const b={host:{scrollTop:842380,scrollHeight:843054,clientHeight:674},scrollStats:{scrollResets:0},rows,breakthrough:{resets:53,attempts:0,frontier:null,bottomEscapeHits:2,bottomEscapeAttempts:2,recoveryAvoidFrontier:true}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>{reads++;return rows},historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event)=>trace.push(event),historyScroll:(h,to)=>{h.scrollTop=Math.abs(h.scrollTop-to)>50000?842380:to},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 await a.rejects(ctx.settle(b,{upward:true,target:1998.8,targetHeight:843054,allowBoost:false}),e=>e.code==='HISTORY_RECOVERY_RETRY');
 a.equal(reads,0);a.equal(b.scrollStats.stagedReturnArrivals,undefined);a.equal(b.rows.length,1);a.ok(trace.includes('bottom-escape-stage-failed'));
});

// Synthetic coordinates only. Height changes may occur below a commanded waypoint.
for(const basis of ['direct','height-rebased','snap'])test('staged return with changing height: '+basis,async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000,reads=0,moves=0;const trace=[],rows=[r('anchor')];
 const b={host:{scrollTop:838528,scrollHeight:839202,clientHeight:674},scrollStats:{scrollResets:0},rows,breakthrough:{resets:53,attempts:0,frontier:null,bottomEscapeHits:2,bottomEscapeAttempts:2,recoveryAvoidFrontier:true}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>{reads++;return rows},historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>{h.scrollTop=to;if(++moves===2){if(basis==='snap'){h.scrollHeight+=947;h.scrollTop=h.scrollHeight-h.clientHeight}else{h.scrollHeight-=947;if(basis==='height-rebased')h.scrollTop-=947}}},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 const run=ctx.settle(b,{upward:true,target:3206.8,targetHeight:839202,allowBoost:false});
 if(basis==='snap'){await a.rejects(run,e=>e.code==='HISTORY_RECOVERY_RETRY');a.equal(reads,0);a.equal(b.scrollStats.stagedReturnArrivals,undefined);a.equal(trace.find(x=>x.event==='bottom-escape-stage').held,false)}
 else{a.deepEqual(await run,rows);a.equal(trace.find(x=>x.event==='bottom-escape-stage').landingBasis,basis);a.equal(b.scrollStats.stagedReturnLandings,13);a.equal(b.scrollStats.stagedReturnArrivals,1);a.ok(reads>0)}
 a.equal(b.rows.length,1);a.ok(now<61000);
});

// Intermediate reflow is bounded by the two coordinate frames, not identity evidence.
test('observed mixed-height intermediate landing is allowed but final landing and bottom snap are rejected',()=>{
 const first={start:851288,waypoint:785940.9538386419,actual:785070.375,height:852299,nowHeight:850315,viewport:674};
 const second={start:851276.8125,waypoint:786061.0884540265,actual:785191.1875,height:852288,nowHeight:850305,viewport:674};
 for(const v of [first,second]){a.equal(c.escapeLanding(v),'height-envelope');a.equal(c.escapeLanding({...v,final:true}),null);a.equal(c.escapeLanding({...v,actual:v.nowHeight-v.viewport}),null);a.equal(c.escapeLanding({...v,actual:v.actual-10000}),null)}
 a.equal(c.escapeLanding({...first,actual:first.start-5}),null);
});
test('actual staged return accepts mixed height intermediate landing and reaches strict final landing',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000,moves=0,reads=0;const trace=[],rows=[r('anchor')];
 const b={host:{scrollTop:851625,scrollHeight:852299,clientHeight:674},scrollStats:{scrollResets:0},rows,breakthrough:{resets:53,attempts:0,frontier:null,bottomEscapeHits:2,bottomEscapeAttempts:2,recoveryAvoidFrontier:true}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>{reads++;return rows},historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>{h.scrollTop=to;if(++moves===2){h.scrollHeight-=1984;h.scrollTop-=870.58}},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 a.deepEqual(await ctx.settle(b,{upward:true,target:1776.4,targetHeight:852299,allowBoost:false}),rows);
 a.equal(b.scrollStats.stagedEnvelopeLandings,1);a.equal(b.scrollStats.stagedReturnArrivals,1);a.equal(b.rows.length,1);a.ok(reads>0);a.equal(trace.find(x=>x.event==='bottom-escape-stage').landingBasis,'height-envelope');
});
test('actual bottom snap makes next long return smaller without counting a landing',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyRecoverScroll('),src.indexOf('  function historyGuard('));
 let now=1000,moves=0;const trace=[],rows=[r('anchor')];
 const b={host:{scrollTop:842380,scrollHeight:843054,clientHeight:674},scrollStats:{scrollResets:0},rows,breakthrough:{resets:53,attempts:0,frontier:null,bottomEscapeHits:2,bottomEscapeAttempts:2,recoveryAvoidFrontier:true}};
 const ctx={Date:{now:()=>now},pc:c,historyGuard:()=>{},historyStatus:()=>{},historyLoading:()=>false,historyRead:()=>rows,historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyTrace:(b,event,details)=>trace.push({event,...details}),historyScroll:(h,to)=>{h.scrollTop=to;if(++moves===2)h.scrollTop=h.scrollHeight-h.clientHeight},sleep:async ms=>{now+=ms}};
 vm.runInNewContext(block+';globalThis.settle=historySettled;',ctx);
 await a.rejects(ctx.settle(b,{upward:true,target:1998.8,targetHeight:843054,allowBoost:false}),e=>e.code==='HISTORY_RECOVERY_RETRY');
 a.equal(b.breakthrough.stagedEscapeBackoff,2);a.equal(b.scrollStats.stagedReturnLandings,undefined);a.equal(b.scrollStats.stagedReturnBackoffs,1);
 b.breakthrough.bottomEscapeHits=2;
 a.deepEqual(await ctx.settle(b,{upward:true,target:1998.8,targetHeight:843054,allowBoost:false}),rows);
 a.deepEqual(trace.filter(x=>x.event==='bottom-escape-return').map(x=>x.stages),[13,26]);a.equal(b.scrollStats.stagedReturnLandings,26);a.equal(b.rows.length,1);c.clearRecoveryPolicy(b.breakthrough);a.equal(b.breakthrough.stagedEscapeBackoff,undefined);
});

// Synthetic references, no private chat text or URLs.
test('exact ordered attachment subset preserves both snapshots and allows strict adjacent merge',()=>{
 const img=i=>({kind:'image-reference',label:'使用者附件',url:'blob:https://chatgpt.com/'+i.repeat(8)+'-1111-4111-8111-111111111111'});
 const A=img('1'),B=img('2'),C=img('3'),old={...r('anchor'),attachments:[A]},live={...old,attachments:[B,A]},tail=r('tail','assistant'),earlier=r('earlier'),changes=[];
 a.deepEqual(c.mergeUp([old,tail],[earlier,live,tail],x=>changes.push(x)),[earlier,live,tail]);
 a.deepEqual(old.attachments,[A]);a.equal(changes[0].type,'image-reference-subset-enriched');
 a.deepEqual(changes[0].previousAttachments,[A]);a.deepEqual(changes[0].currentAttachments,[B,A]);
 a.equal(changes[0].bytesVerified,false);a.equal(changes[0].attachmentCountVerified,false);
 a.deepEqual(c.mergeUp([live,tail],[old,tail],x=>changes.push(x)),[live,tail]);a.equal(changes[1].type,'image-reference-subset-not-observed');
 for(const bad of [{...old,attachments:[B,C]},{...old,attachments:[A,A]},{...old,attachments:[A,{...B,label:'other'}]},{...old,attachments:[A,{...B,url:'https://example.com/image'}]},{...live,text:'changed'},{...live,structure:[{tag:'b',text:'changed'}]}])a.throws(()=>c.mergeUp([old,tail],[bad,tail]));
 a.throws(()=>c.mergeUp([live,tail],[{...live,attachments:[A,B,C]},tail]));
 a.throws(()=>c.mergeUp([old,tail],[earlier,live,r('unrelated'),tail]));
});

test('trusted wheel observation is passive, scoped and bounded',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyObserveWheel('),src.indexOf('  function historyStatus('));
 const ctx={};vm.runInNewContext(block+';globalThis.observe=historyObserveWheel;',ctx);
 const host={contains:x=>x==='inside',scrollTop:123,scrollHeight:456},b={host,rows:[r('anchor')]};
 ctx.observe(b,{isTrusted:false,target:'inside',deltaY:-30,deltaMode:0});
 ctx.observe(b,{isTrusted:true,target:'outside',deltaY:-30,deltaMode:0});
 a.equal(b.trustedWheelCount,undefined);
 for(let i=0;i<65;i++)ctx.observe(b,{isTrusted:true,target:'inside',deltaY:-30,deltaMode:0});
 a.equal(b.trustedWheelCount,65);a.equal(b.trustedWheelTrace.length,64);a.equal(b.trustedWheelOverflow,1);a.equal(b.trustedWheelTrace[0].scrollTop,123);a.equal(host.scrollTop,123);a.equal(b.rows.length,1);
});

test('predecessor status panel stays at bottom, supports compact view and moves without scrolling',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'content.js'),'utf8'),block=src.slice(src.indexOf('  function historyPanelControls('),src.indexOf('  function historyAtBottom('));
 const element=()=>({style:{},children:[],hidden:false,setAttribute(k,v){this[k]=v},append(...nodes){this.children.push(...nodes)}});
 const ctx={document:{createElement:element},window:{innerWidth:450}};vm.runInNewContext(block+';globalThis.controls=historyPanelControls;globalThis.status=historyStatus;',ctx);
 const pane=element(),b={info:element(),summary:element(),download:{hidden:true},rows:[r('anchor')]};
 const bar=ctx.controls(pane,b);a.equal(pane.style.left,'12px');a.equal(pane.style.right,'auto');a.equal(b.info.hidden,true);
 ctx.status(b,'測試');a.match(b.summary.textContent,/已保全 1 則/);a.match(b.info.textContent,/測試/);
 bar.children[1].onclick();a.equal(pane.style.right,'12px');a.equal(pane.style.left,'auto');
 bar.children[0].onclick();a.equal(b.info.hidden,false);bar.children[0].onclick();a.equal(b.info.hidden,true);
 b.showPanelDetails();a.equal(b.info.hidden,false);b.download.hidden=false;ctx.status(b,'已下載');a.match(b.summary.textContent,/已結束/);
 a.equal(b.rows.length,1);a.equal(src.includes("top:auto;box-sizing:border-box;max-width:calc(100vw - 24px)"),true);
 a.equal(src.includes("active.scrollIntoView({block:'nearest'})"),false);
});
