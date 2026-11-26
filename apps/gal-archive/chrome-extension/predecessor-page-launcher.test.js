'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),p=require('node:path');
const source=fs.readFileSync(p.join(__dirname,'content.js'),'utf8'),block=source.slice(source.indexOf("  const HISTORY_LAUNCHER="),source.indexOf("  chrome.runtime.onMessage.addListener"));
function fixture(){
 const nodes=new Map(),calls=[];let route='/c/first',result={ok:true},saved=null;
 const element=tag=>({tag,id:'',dataset:{},style:{},children:[],append(...children){this.children.push(...children);for(const n of children)if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id);for(const n of this.children)if(n.id)nodes.delete(n.id)},setAttribute(){},scrollIntoView(){calls.push('existing')}});
 const body=element('body'),ctx={pc:require('./predecessor-chat-core'),document:{title:'測試前輩 - ChatGPT',body,createElement:element,getElementById:id=>nodes.get(id)},location:{origin:'https://chatgpt.com'},GalCheckpointMemory:{key:(source,slot)=>source+slot,read:async()=>saved},chrome:{storage:{local:{get:async()=>({})}},runtime:{getManifest:()=>({version:'0.10.45'}),sendMessage:async m=>{calls.push([m.type,m.expectedHash]);return {ok:true,readback:true,hash:m.expectedHash,count:2,runId:'run'}}}},historyAnchorCapture:async (id,title,report,capture)=>{calls.push(['anchor',id,title,capture]);return {ok:true,message:'local evidence'}},HISTORY_PANEL:'active-scan',valid:()=>route.startsWith('/c/'),path:()=>route,historyBegin:async (title,sample,minimum,checkpoint)=>{calls.push(checkpoint?[title,checkpoint.hash]:sample?[title,sample]:minimum?[title,minimum]:title);return result}};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.launch=historyLauncher;',ctx);
 return {nodes,calls,launch:ctx.launch,route:x=>{route=x},result:x=>{result=x},saved:x=>{saved=x}};
}
test('web button appears once, opens named scan directly without browser toolbar',async()=>{
 const f=fixture();f.launch();const button=f.nodes.get('ga-predecessor-page-launcher');assert.ok(button);f.launch();assert.equal(f.nodes.get(button.id),button);
 button.onclick();assert.equal(f.nodes.get('ga-predecessor-page-title').value,'測試前輩');
 await f.nodes.get('ga-predecessor-page-start').onclick();assert.deepEqual(f.calls,['測試前輩']);assert.equal(f.nodes.has('ga-predecessor-page-config'),false);
});
test('failed start preserves config; switching chats invalidates old form; non-chat hides launcher',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();f.result({ok:false,error:'busy'});
 await f.nodes.get('ga-predecessor-page-start').onclick();assert.ok(f.nodes.has('ga-predecessor-page-config'));assert.equal(f.nodes.get('ga-predecessor-page-start').disabled,false);
 f.route('/c/second');f.launch();assert.equal(f.nodes.has('ga-predecessor-page-config'),false);
 f.route('/');f.launch();assert.equal(f.nodes.has('ga-predecessor-page-launcher'),false);
});

test('ten-message sample button invokes independent limited scan',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();
 await f.nodes.get('ga-predecessor-page-test-ten').onclick();assert.deepEqual(f.calls,[['測試前輩',true]]);
 assert.equal(f.nodes.has('ga-predecessor-page-config'),false);
});

test('twenty-message option invokes bounded test and generic names are blocked',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();
 const input=f.nodes.get('ga-predecessor-page-title');input.value='新對話';
 await f.nodes.get('ga-predecessor-page-test-twenty').onclick();assert.deepEqual(f.calls,[]);
 input.value='測試前輩';await f.nodes.get('ga-predecessor-page-test-twenty').onclick();
 assert.deepEqual(f.calls,[['測試前輩',20]]);
});

test('full scan receives explicit known lower bound',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();
 f.nodes.get('ga-predecessor-page-minimum').value='179';
 await f.nodes.get('ga-predecessor-page-start').onclick();assert.deepEqual(f.calls,[['測試前輩',179]]);
});

test('resume picker does not launch without a selected checkpoint',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();
 assert.equal(f.nodes.get('ga-predecessor-page-checkpoint').type,'file');
 await f.nodes.get('ga-predecessor-page-resume').onclick();assert.deepEqual(f.calls,[]);
 assert.ok(f.nodes.get('ga-predecessor-page-config'));
});

test('resume can use remembered checkpoint without file picker',async()=>{const f=fixture();f.saved({data:{},hash:'a'.repeat(64)});f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();await f.nodes.get('ga-predecessor-page-resume').onclick();assert.deepEqual(f.calls,[['測試前輩','a'.repeat(64)]]);assert.equal(f.nodes.has('ga-predecessor-page-config'),false)});

test('offline import entry sends only hash, never private checkpoint bytes',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();f.nodes.get('ga-predecessor-page-checkpoint-hash').value='a'.repeat(64);await f.nodes.get('ga-predecessor-page-manual-import').onclick();assert.deepEqual(f.calls,[['predecessor-open-checkpoint-import','a'.repeat(64)]])});

test('installed import stays in original chat and sends only expected hash',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();f.nodes.get('ga-predecessor-page-checkpoint-hash').value='a'.repeat(64);await f.nodes.get('ga-predecessor-page-local-import').onclick();assert.deepEqual(f.calls,[['predecessor-installed-checkpoint-import','a'.repeat(64)]]);assert.ok(f.nodes.has('ga-predecessor-page-config'))});

test('targeted anchor controls dispatch local-only locate and current capture',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();f.nodes.get('ga-predecessor-page-anchor-id').value='user|turn:abc';await f.nodes.get('ga-predecessor-page-anchor-locate').onclick();await f.nodes.get('ga-predecessor-page-anchor-capture').onclick();assert.deepEqual(f.calls,[['anchor','user|turn:abc','測試前輩',false],['anchor','user|turn:abc','測試前輩',true]]);assert.ok(f.nodes.has('ga-predecessor-page-config'))});

test('anchor launcher exposes ten-minute budget',()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher').onclick();assert.equal(f.nodes.get('ga-predecessor-page-anchor-locate').textContent,'依原文搜尋（10分鐘無進展停止）')});
