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
 const ctx={Date:{now:()=>now},pc:{...c,validateSample:()=>{}},state:{bulk:b},historyGuard:()=>{},historyStatus:()=>{},historyScroll:(h,to)=>{h.scrollTop=Math.min(h.scrollHeight-h.clientHeight,Math.max(0,to));positions.push(h.scrollTop)},historySettled:async()=>{now+=700;return rows},historyAtBottom:h=>h.scrollTop===h.scrollHeight-h.clientHeight,historyLoading:()=>false,historyEdgeOrdinal:()=>({}),historyAttachmentChange:()=>{},historyTrace:()=>{},sleep:async ms=>{now+=ms},historyPayload:(b,status,error)=>({status,error,count:b.rows.length}),historyDownload:d=>{output=d;return 'sample.json'}};
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
