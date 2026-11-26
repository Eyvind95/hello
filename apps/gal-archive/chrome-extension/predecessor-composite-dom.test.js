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

function codeFixture({value='原樣程式碼\n  第二行',label='純文字',ambiguous=false,extra='',hiddenCode=false,labelTag='div',copyLabel='複製'}={}){
 const make=(tag,txt='')=>({nodeType:1,tagName:tag.toUpperCase(),innerText:txt,textContent:txt,childNodes:txt?[{nodeType:3,nodeValue:txt}]:[],parentElement:null,previousElementSibling:null,nextElementSibling:null,matches(q){return q.split(',').includes(tag)},closest(){return null},querySelectorAll(){return []}});
 const code=make('code',value);if(hiddenCode)code.innerText='';
 const before=make('p','唯一前文'),after=make('p',ambiguous?'唯一前文':'唯一後文'),body=make('article');
 const group=make('div');group.childNodes=[make(labelTag,label),code,make('button',copyLabel),make('span',extra)];group.previousElementSibling=before;group.nextElementSibling=after;group.parentElement=body;code.parentElement=group;group.querySelectorAll=q=>q==='code'?[code]:[];body.querySelectorAll=q=>q==='code'?[code]:[];
 const helper=s.slice(s.indexOf('  function historyAssistantCodeText('),s.indexOf('  function historyRead(host,'));
 const read=vm.runInNewContext(helper+';historyAssistantCodeText',{historyVisible:()=>true,historyIssue:(m,o,d)=>Object.assign(Error(m),{details:d})});
 return {body,code,read,value,raw:'唯一前文\n\n唯一後文'};
}
test('missing rendered code and fully mounted code normalize to exact same anchored text',()=>{
 const f=codeFixture({hiddenCode:true});
 const short=f.read(f.body,f.body,'assistant|message:a',f.raw);
 const long=f.read(f.body,f.body,'assistant|message:a','唯一前文\n\n純文字\n'+f.value+'\n\n唯一後文');
 assert.equal(short,'唯一前文\n\n'+f.value+'\n\n唯一後文');assert.equal(long,short);
});
test('code normalization preserves literal UI label in source, indentation and surrounding prose',()=>{
 const f=codeFixture({value:'純文字\n  原文'});
 assert.equal(f.read(f.body,f.body,'a','純文字是正文\n\n'+f.raw),'純文字是正文\n\n唯一前文\n\n純文字\n  原文\n\n唯一後文');
});
test('unproven placement, unknown wrapper text, or changed prose never silently accepted',()=>{
 for(const f of [codeFixture({ambiguous:true}),codeFixture({extra:'不是工具文字'})]){
  assert.throws(()=>f.read(f.body,f.body,'a',f.raw),/無法安全確認完整正文/);
 }
 const f=codeFixture();assert.throws(()=>f.read(f.body,f.body,'a','唯一前文\n\n額外正文\n\n唯一後文'),/無法安全確認完整正文/);
});
test('ordinary inline code remains unchanged, missing inline code is rejected',()=>{
 const f=codeFixture();f.code.parentElement=f.body;
 const raw='普通段落 '+f.value+' 結尾';
 assert.equal(f.read(f.body,f.body,'a',raw),raw);
 assert.throws(()=>f.read(f.body,f.body,'a','普通段落 結尾'),/無法安全確認完整正文/);
});

test('literal paragraph label and wrapper without a copy control are not treated as renderer UI',()=>{
 for(const f of [codeFixture({labelTag:'p'}),codeFixture({copyLabel:'其他操作'})]){
  const raw='唯一前文\n\n純文字\n'+f.value+'\n\n唯一後文';
  assert.equal(f.read(f.body,f.body,'a',raw),raw);
  assert.throws(()=>f.read(f.body,f.body,'a',f.raw),/無法安全確認完整正文/);
 }
});

// CAT-0012-R3 structural replay, synthetic text only (no private chat data).
function dividerFixture({value='修'.repeat(55),hiddenCode=true,separator='hr',separatorText='',ambiguous=false,extra=''}={}){
 const make=(tag,txt='',attrs={})=>({nodeType:1,tagName:tag.toUpperCase(),innerText:txt,textContent:txt,childNodes:txt?[{nodeType:3,nodeValue:txt}]:[],parentElement:null,previousElementSibling:null,nextElementSibling:null,getAttribute:k=>attrs[k]??null,matches(q){return q.split(',').includes(tag)},closest(){return null},querySelectorAll(){return []}});
 const link=(parent,...children)=>{parent.childNodes=children;children.forEach((n,i)=>{n.parentElement=parent;n.previousElementSibling=children[i-1]||null;n.nextElementSibling=children[i+1]||null});parent.querySelectorAll=q=>q==='code'?children.flatMap(n=>n.tagName==='CODE'?[n]:n.querySelectorAll(q)):[];return parent};
 const code=make('code',value);if(hiddenCode)code.innerText='';
 const source=link(make('div','',{'data-code-block-source':'true'}),code);
 const toolbar=link(make('div','',{'data-markdown-copy':'exclude'}),make('div','純文字'),make('button','',{'aria-label':'複製代碼'}),make('span',extra));
 const wrapper=link(make('div','',{'data-code-block':'true','data-markdown-copy':'code-block'}),toolbar,source);
 const group=link(make('div'),wrapper),before=make('p','唯一前文'),after=make('p',ambiguous?'唯一前文':'唯一後文');
 const markdown=link(make('div'),before,group,make(separator,separatorText),after),selection=link(make('div'),markdown),body=link(make('div'),selection);
 const helper=s.slice(s.indexOf('  function historyAssistantCodeText('),s.indexOf('  function historyRead(host,'));
 const read=vm.runInNewContext(helper+';historyAssistantCodeText',{historyVisible:()=>true,historyIssue:(m,o,d)=>Object.assign(Error(m),{details:d})});
 return {body,read,value,raw:'唯一前文\n\n唯一後文'};
}
test('CAT-0012 seven-level code wrapper followed by HR: both render states normalize identically',()=>{
 for(const value of ['修'.repeat(55),'正'.repeat(120)]){
  const off=dividerFixture({value}),on=dividerFixture({value,hiddenCode:false});
  const expected='唯一前文\n\n'+value+'\n\n唯一後文';
  assert.equal(off.read(off.body,off.body,'a',off.raw),expected);
  for(const gap of ['\n\n純文字\n'+value+'\n','\n\n純文字\n'+value+'\n\n'])assert.equal(on.read(on.body,on.body,'a','唯一前文'+gap+'唯一後文'),expected);
 }
});
test('divider recovery does not cross unknown nodes, nonempty separators, duplicate anchors or extra prose',()=>{
 for(const opts of [{separator:'div'},{separatorText:'正文'},{ambiguous:true},{extra:'額外正文'}]){
  const f=dividerFixture(opts);assert.throws(()=>f.read(f.body,f.body,'a',f.raw),/無法安全確認完整正文/);
 }
 const f=dividerFixture();assert.throws(()=>f.read(f.body,f.body,'a','唯一前文\n\n額外正文\n\n唯一後文'),/無法安全確認完整正文/);
});

test('CAT-0015 repeated right paragraph: uniquely bounded exact gap works in both states',()=>{
 const f=codeFixture({hiddenCode:true});
 const raw='唯一前文\n\n唯一後文\n\n額外段落\n\n唯一後文';
 const expected='唯一前文\n\n'+f.value+'\n\n唯一後文\n\n額外段落\n\n唯一後文';
 assert.equal(f.read(f.body,f.body,'a',raw),expected);
 assert.equal(f.read(f.body,f.body,'a','唯一前文\n純文字\n'+f.value+'\n\n唯一後文\n\n額外段落\n\n唯一後文'),expected);
 assert.throws(()=>f.read(f.body,f.body,'a','唯一前文\n\n唯一後文\n\n唯一前文\n\n唯一後文'),/無法安全確認完整正文/);
 assert.throws(()=>f.read(f.body,f.body,'a','不是唯一前文\n\n唯一後文'),/無法安全確認完整正文/);
});
test('two independent code blocks preserve original order and normalize both render states',()=>{
 const f=codeFixture({value:'甲'.repeat(24),hiddenCode:true}),g=codeFixture({value:'乙'.repeat(69),hiddenCode:true});
 const group=g.code.parentElement;
 group.parentElement=f.body;group.previousElementSibling.innerText='第二前文';group.nextElementSibling.innerText='第二後文';
 f.body.querySelectorAll=q=>q==='code'?[f.code,g.code]:[];
 const plain='唯一前文\n\n唯一後文\n\n第二前文\n\n第二後文\n\n唯一後文';
 const one='唯一前文\n純文字\n'+f.value+'\n\n唯一後文\n\n第二前文\n\n第二後文\n\n唯一後文';
 const both='唯一前文\n純文字\n'+f.value+'\n\n唯一後文\n\n第二前文\n\n純文字\n'+g.value+'\n\n第二後文\n\n唯一後文';
 const want='唯一前文\n\n'+f.value+'\n\n唯一後文\n\n第二前文\n\n'+g.value+'\n\n第二後文\n\n唯一後文';
 for(const raw of [plain,one,both])assert.equal(f.read(f.body,f.body,'a',raw),want);
});
test('identity recovery walks live viewport and returns only a stable matching window',async()=>{
 const source=s.slice(s.indexOf('  function historyMountedFrontier('),s.indexOf('  async function historyRun(b){'));
 const host={scrollTop:0,scrollHeight:6000,clientHeight:600};
 const marker={getAttribute:()=> 'frontier'};
 let now=0,reads=0;
 const root={querySelectorAll:q=>q==='[data-response-body]'&&host.scrollTop<=1800?[marker]:[]};
 const row={id:'assistant|message:frontier'};
 const ctx={historyRoot:()=>root,historyVisible:()=>true,historyGuard:()=>{},historyTrace:()=>{},historyStatus:()=>{},historyScroll:(h,x)=>{h.scrollTop=Math.max(0,Math.min(x,h.scrollHeight-h.clientHeight))},historyLoading:()=>false,historyNativeRetry:async()=>false,historyAtBottom:h=>h.scrollTop===h.scrollHeight-h.clientHeight,sleep:async x=>{now+=x},Date:{now:()=>now},historySettled:async()=>{reads++;return [row]}};
 const recover=vm.runInNewContext(source+';historyRejoinByIdentity',ctx);
 host.scrollTop=5400;const b={host,rows:[row],scrollStats:{}};
 assert.equal((await recover(b,10000))[0],row);assert.equal(reads,1);assert.equal(host.scrollTop,1800);
 ctx.historySettled=async()=>[{id:'assistant|message:wrong'}];
 host.scrollTop=5400;assert.equal(await recover(b,10000),null);
});
