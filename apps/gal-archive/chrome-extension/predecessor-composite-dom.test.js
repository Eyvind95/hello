'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),p=require('node:path');
const s=fs.readFileSync(p.join(__dirname,'content.js'),'utf8'),block=s.slice(s.indexOf("  const HISTORY_STRUCT="),s.indexOf("  function historyRead(host,"));
function fixture(){
 let order=0;
 const make=(tag,text='',attrs={})=>{
  const n={nodeType:1,tagName:tag.toUpperCase(),attrs,children:[],childNodes:[],parentElement:null,order:order++,getAttribute:k=>attrs[k]??null,contains(other){return other===this||this.childNodes.some(c=>c.contains(other))},matches(selector){return selector.split(',').some(x=>{x=x.trim();return x===tag||(x==='button'&&tag==='button')||(x==='[data-testid="turn-actions"]'&&attrs['data-testid']==='turn-actions')||(x==='[hidden]'&&attrs.hidden!==undefined)})},closest(selector){for(let x=this;x;x=x.parentElement)if(x.matches(selector))return x;return null},compareDocumentPosition(other){return other.order>this.order?4:2},add(...items){for(const i of items){i.parentElement=this;this.childNodes.push(i);if(i.nodeType===1)this.children.push(i)}return this},get innerText(){return this.childNodes.map(c=>c.nodeType===3?c.nodeValue:c.innerText).join('')},get textContent(){return this.innerText}};
  if(text)n.add({nodeType:3,nodeValue:text,order:order++,contains(other){return other===this}});
  return n;
 };
 const ctx={Node:{ELEMENT_NODE:1,TEXT_NODE:3,DOCUMENT_POSITION_FOLLOWING:4},FALLBACK_SKIP:'button,[hidden]',RESPONSE_LABEL:/^(?:ChatGPT 說|你說)$/,getComputedStyle:n=>({display:['SPAN','A','CODE','STRONG','BR','IMG'].includes(n.tagName)?'inline':'block',visibility:'visible'}),historyVisible:n=>!n.closest('[hidden]'),isUserDescendant:n=>!!n.closest('[data-testid="user"]')};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.read=historyCompositeRead;',ctx);
 const owner=make('div','',{'data-turn-key':'stable'}),user=make('div','玩家秘密正文',{'data-testid':'user'});owner.add(user);
 return {make,owner,user,read:ctx.read};
}
test('composite GPT full DOM read has no legacy 30000 limit, preserves literal text and formatting after user',()=>{
 const f=fixture(),{make,owner,user}=f;
 const huge='長'.repeat(41000);
 owner.add(make('h2','ChatGPT 說'),make('p','原文 '+huge).add(make('strong','粗體')),make('pre','保留\n  縮排'),make('p','ChatGPT 說'),make('button','複製'),make('div','工具文字',{'data-testid':'turn-actions'}),make('img','',{src:'blob:attachment',alt:'圖'}));
 const r=f.read(owner,[user]);
 assert.ok(r.text.includes(huge));assert.ok(r.text.includes('保留\n  縮排'));assert.ok(r.text.includes('ChatGPT 說'));
 assert.doesNotMatch(r.text,/玩家秘密正文|工具文字|複製/);
 assert.equal(r.structure.find(x=>x.tag==='strong').text,'粗體');assert.equal(r.attachments[0].url,'blob:attachment');assert.ok(r.sourceTextCharacters>41000);assert.equal(r.segments.map(s=>s.text).join('').includes(huge),true);
});
test('composite boundary rejects missing stable source, ambiguous user or only UI',()=>{
 const f=fixture();f.owner.add(f.make('button','複製'));
 assert.throws(()=>f.read(f.owner,[f.user]),/未找到/);
 assert.throws(()=>f.read(f.owner,[]),/唯一玩家/);
 f.owner.attrs['data-turn-key']=null;assert.throws(()=>f.read(f.owner,[f.user]),/穩定回合 ID/);
});

test('composite ordering is tied to the unique paired user even if the DOM anchor is the owner',()=>{
 const compare=s.slice(s.indexOf('    entries.sort((a,b)=>{',s.indexOf('  function historyRead(host,')),s.indexOf('    for(const group of owners.values())',s.indexOf('  function historyRead(host,')));
 const owner={compareDocumentPosition:()=>4},user={compareDocumentPosition:()=>2};const entries=[{owner,el:owner,row:{role:'assistant',contentBasis:'composite-after-user-dom'}},{owner,el:user,row:{role:'user'}}];
 vm.runInNewContext(compare,{entries,Node:{DOCUMENT_POSITION_FOLLOWING:4}});assert.deepEqual(entries.map(x=>x.row.role),['user','assistant']);
});


test('current response body identity is corroborated, duplicate identical search IDs are not two messages',()=>{
 const helper=s.slice(s.indexOf('  function historyResponseIdentity('),s.indexOf('  function historyRead(host,'));
 const id='answer-native-id',unit={getAttribute:k=>k==='data-chatgpt-search-unit-key'?'fallback-turn-3:2:assistant':id+' '+id};
 const owner={contains:x=>x===unit},body={getAttribute:()=>id,closest:()=>unit,querySelectorAll:()=>[{getAttribute:()=>id}]};
 const read=vm.runInNewContext(helper+';historyResponseIdentity',{historyIssue:m=>Error(m),isUserDescendant:()=>false});
 assert.equal(read(body,owner),id);
 unit.getAttribute=k=>k==='data-chatgpt-search-unit-key'?'fallback-turn-3:0:user':id;
 assert.throws(()=>read(body,owner),/無法唯一核對/);
 unit.getAttribute=k=>k==='data-chatgpt-search-unit-key'?'fallback-turn-3:2:assistant':id+' another';
 assert.throws(()=>read(body,owner),/無法唯一核對/);
});
test('marked response with nested PDF citation is read once in full before legacy fallback, native identity differs from turn',()=>{
 const source=s.slice(s.indexOf('  function historyResponseIdentity('),s.indexOf('  function historyEdgeOrdinal('));
 const attrs=(values)=>({getAttribute:k=>values[k]??null,hasAttribute:k=>k in values});
 const turn={...attrs({'data-turn-key':'question-id'}),parentElement:null,contains:n=>[user,body,citation,unit,turn].includes(n)};
 const unit={...attrs({'data-chatgpt-search-unit-key':'fallback-turn-3:2:assistant','data-chatgpt-search-message-ids':'answer-id answer-id'})};
 const user={...attrs({}),closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[],compareDocumentPosition:()=>4};
 const citation={...attrs({}),closest:()=>null,querySelectorAll:()=>[],compareDocumentPosition:()=>2};
 const text='完整回答第一段\nPDF引用\n最後一段';
 const body={...attrs({'data-response-body':'answer-id'}),parentElement:{closest:()=>null},contains:n=>n===citation||n===body,closest:q=>q==='[data-chatgpt-search-unit-key]'?unit:null,querySelectorAll:q=>q==='[data-chatgpt-selection-message-id]'?[{getAttribute:()=> 'answer-id'}]:[],compareDocumentPosition:()=>2};
 const root={contains:n=>turn.contains(n),querySelectorAll:q=>q==='[data-response-body]'?[body]:q==='[data-message-author-role]'?[]:[turn]};
 const read=vm.runInNewContext(source+';historyRead',{historyRoot:()=>root,historyVisible:()=>true,historyOwner:()=>turn,isUserDescendant:n=>n===user,outerUsers:()=>[user],assistantElements:()=>[citation],assistantFallbackTexts:new Map(),historyReadText:(n,scope)=>{if(n===body){assert.equal(scope,body);return text}return '原題'},historyIssue:m=>Error(m),getVisibleSourceTime:()=>null,HISTORY_STRUCT:'p',HISTORY_ATTACHMENT:'img',historyAttachment:()=>{throw Error('unexpected attachment')},USER_BUBBLE_SELECTOR:'bubble',Node:{DOCUMENT_POSITION_FOLLOWING:4},pc:{validateRows:()=>{}}});
 const rows=read(root);
 assert.equal(rows.length,2);assert.equal(rows[0].id,'user|turn:question-id');assert.equal(rows[1].id,'assistant|message:answer-id');assert.equal(rows[1].text,text);
});
