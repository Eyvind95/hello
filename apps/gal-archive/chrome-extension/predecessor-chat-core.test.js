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

test('composite read retains uncapped body and requires stable unique role evidence',()=>{
 const text='長'.repeat(45000)+'\n\n最後一句';
 const good={stableTurn:'turn-1',playerCount:1,parts:[{text,hasMedia:false},{text:'第二部分',hasMedia:false}],roleEvidence:['assistant-label:H5']};
 assert.deepEqual(c.compositeDecision(good),{ok:true,text:text+'\n第二部分'});
 for(const patch of [{stableTurn:''},{playerCount:2},{roleEvidence:[]},{unresolved:true}])assert.equal(c.compositeDecision({...good,...patch}).ok,false);
 assert.equal(c.compositeDecision({...good,parts:[],roleEvidence:[]}).empty,true);
 assert.equal(c.compositeDecision({...good,parts:[]}).empty,false);
 assert.equal(c.compositeDecision({...good,parts:[{text:'',hasMedia:true}]}).ok,true);
});
