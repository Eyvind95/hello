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
