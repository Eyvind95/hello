'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyze,redact,quoteProjection}=require('./inspect-1685-projections.js');
function fixture(dom,native,id='native-1685'){
 const rows=Array.from({length:1687},(_,scanIndex)=>({
  scanIndex,role:'me',eventType:null,sourceMessageId:null,text:'玩家'
 }));
 rows[1685]={scanIndex:1685,role:'ai',eventType:null,
  sourceMessageId:id,nativeReason:'available',text:dom,nativeText:native};
 rows[1686].text='下一則玩家';
 return {format:'gal-ai-incomplete-scan-checkpoint',complete:false,importable:false,
  scanRunId:'test-1685',rows};
}
test('exact proof: two hidden templates, fenced visible body and trailing image',()=>{
 const dom='【無時間回覆】\n原文第一段\n普通段落\n原文最後一段';
 const native='【無時間回覆】\n{{internal-one}}\n原文第一段\n' +
  '\x60\x60\x60text\n普通段落\n\x60\x60\x60\n{{internal-two}}\n原文最後一段\n{{img:0f43}}';
 const result=analyze(fixture(dom,native));
 assert.ok(result.exactCandidateCount>0);
 const x=result.candidates.find(x=>x.exactNonWhitespaceMatch);
 assert.ok(x);
 assert.ok(x.operations.some(op=>op.kind==='hidden-template'));
 assert.ok(x.operations.some(op=>op.kind==='code-fence-body-only'));
 assert.ok(x.operations.some(op=>op.kind==='terminal-image-token'));
 assert.equal(result.scanIndex,1685);
});
test('only omitted balanced Chinese quote characters can be projected',()=>{
 const check=quoteProjection('說「你好」了','說你好了');
 assert.equal(check.pass,true);
 assert.equal(check.omitted,2);
 assert.equal(quoteProjection('說「你好」了','說你壞了').pass,false);
 assert.equal(quoteProjection('說「你好','說你好').pass,false);
});
test('real story differences cannot be explained by markup',()=>{
 const data=fixture('【原文】甲乙丙','{{prefix}}\n【原文】甲乙丁');
 const result=analyze(data);
 assert.equal(result.exactCandidateCount,0);
});
test('duplicate source IDs and non-checkpoint inputs are rejected',()=>{
 const sample=fixture('【章】正文','{{prefix}}\n【章】正文');
 sample.rows[6].sourceMessageId='native-1685';
 assert.throws(()=>analyze(sample),/不唯一/);
 sample.rows[6].sourceMessageId=null;
 sample.importable=true;
 assert.throws(()=>analyze(sample),/不可匯入/);
});
test('default diagnostics redact story contexts',()=>{
 const d=redact(analyze(fixture('【章】原文','{{hidden}}\n【章】原文')),false);
 assert.ok(!JSON.stringify(d).includes('原文'));
 assert.ok(!JSON.stringify(d).includes('{{hidden}}'));
 assert.equal(d.original.domContext,undefined);
 assert.ok(d.candidates.every(x=>!Object.hasOwn(x,'_privateContext')));
});
