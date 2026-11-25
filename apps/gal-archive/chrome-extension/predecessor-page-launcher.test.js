'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),p=require('node:path');
const source=fs.readFileSync(p.join(__dirname,'content.js'),'utf8'),block=source.slice(source.indexOf("  const HISTORY_LAUNCHER="),source.indexOf("  chrome.runtime.onMessage.addListener"));
function fixture(){
 const nodes=new Map(),calls=[];let route='/c/first',result={ok:true};
 const element=tag=>({tag,id:'',dataset:{},style:{},children:[],append(...children){this.children.push(...children);for(const n of children)if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id);for(const n of this.children)if(n.id)nodes.delete(n.id)},setAttribute(){},scrollIntoView(){calls.push('existing')}});
 const body=element('body'),ctx={pc:require('./predecessor-chat-core'),document:{title:'測試前輩 - ChatGPT',body,createElement:element,getElementById:id=>nodes.get(id)},chrome:{runtime:{getManifest:()=>({version:'0.10.10'})}},HISTORY_PANEL:'active-scan',valid:()=>route.startsWith('/c/'),path:()=>route,historyBegin:async (title,sample)=>{calls.push(sample?[title,sample]:title);return result}};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.launch=historyLauncher;',ctx);
 return {nodes,calls,launch:ctx.launch,route:x=>{route=x},result:x=>{result=x}};
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
