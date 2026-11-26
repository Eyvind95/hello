'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),p=require('node:path');
const source=fs.readFileSync(p.join(__dirname,'content.js'),'utf8'),block=source.slice(source.indexOf("  const HISTORY_LAUNCHER="),source.indexOf("  chrome.runtime.onMessage.addListener"));
function fixture(){
 const nodes=new Map(),calls=[];let route='/c/first',result={ok:true},saved=null,records={},readHook=null;
 const element=tag=>({tag,id:'',dataset:{},style:{},children:[],append(...children){this.children.push(...children);for(const n of children)if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id);for(const n of this.children)if(n.id)nodes.delete(n.id)},setAttribute(){},click(){return this.onclick?.()},scrollIntoView(){calls.push('existing')}});
 const body=element('body'),ctx={pc:require('./predecessor-chat-core'),document:{title:'測試前輩 - ChatGPT',body,createElement:element,getElementById:id=>nodes.get(id)},location:{origin:'https://chatgpt.com'},GalCheckpointMemory:{key:(source,slot)=>source+slot,read:async(...args)=>{if(readHook)await readHook(...args);return saved}},chrome:{storage:{local:{get:async()=>records}},runtime:{id:'testextension',getManifest:()=>({version:'0.10.48'}),sendMessage:async m=>{calls.push([m.type,m.expectedHash]);return {ok:true,readback:true,hash:m.expectedHash,count:2,runId:'run'}}}},historyRushTop:async (id,files,report)=>{calls.push(['rush',id,files]);report('navigation');return {ok:true,message:'navigation only'}},historyAnchorCapture:async (id,title,report,capture)=>{calls.push(['anchor',id,title,capture]);return {ok:true,message:'local evidence'}},HISTORY_PANEL:'active-scan',valid:()=>route.startsWith('/c/'),path:()=>route,historyBegin:async (title,sample,minimum,checkpoint)=>{calls.push(checkpoint?[title,checkpoint.hash]:sample?[title,sample]:minimum?[title,minimum]:title);return result}};
 Object.assign(ctx,{state:{},isGenerating:()=>false});vm.createContext(ctx);vm.runInContext(block+';globalThis.launch=historyLauncher;globalThis.popup=historyPopupCommand;',ctx);
 return {nodes,calls,launch:ctx.launch,route:x=>{route=x},result:x=>{result=x},saved:x=>{saved=x},records:x=>{records=x},readHook:x=>{readHook=x},popup:ctx.popup,state:ctx.state};
}
test('web button appears once, opens named scan directly without browser toolbar',async()=>{
 const f=fixture();f.launch();const button=f.nodes.get('ga-predecessor-page-launcher--testextension');assert.ok(button);f.launch();assert.equal(f.nodes.get(button.id),button);
 button.onclick();assert.equal(f.nodes.get('ga-predecessor-page-title--testextension').value,'測試前輩');
 await f.nodes.get('ga-predecessor-page-start--testextension').onclick();assert.deepEqual(f.calls,['測試前輩']);assert.equal(f.nodes.has('ga-predecessor-page-config--testextension'),false);
});
test('failed start preserves config; switching chats invalidates old form; non-chat hides launcher',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();f.result({ok:false,error:'busy'});
 await f.nodes.get('ga-predecessor-page-start--testextension').onclick();assert.ok(f.nodes.has('ga-predecessor-page-config--testextension'));assert.equal(f.nodes.get('ga-predecessor-page-start--testextension').disabled,false);
 f.route('/c/second');f.launch();assert.equal(f.nodes.has('ga-predecessor-page-config--testextension'),false);
 f.route('/');f.launch();assert.equal(f.nodes.has('ga-predecessor-page-launcher--testextension'),false);
});

test('ten-message sample button invokes independent limited scan',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 await f.nodes.get('ga-predecessor-page-test-ten--testextension').onclick();assert.deepEqual(f.calls,[['測試前輩',true]]);
 assert.equal(f.nodes.has('ga-predecessor-page-config--testextension'),false);
});

test('twenty-message option invokes bounded test and generic names are blocked',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 const input=f.nodes.get('ga-predecessor-page-title--testextension');input.value='新對話';
 await f.nodes.get('ga-predecessor-page-test-twenty--testextension').onclick();assert.deepEqual(f.calls,[]);
 input.value='測試前輩';await f.nodes.get('ga-predecessor-page-test-twenty--testextension').onclick();
 assert.deepEqual(f.calls,[['測試前輩',20]]);
});

test('full scan receives explicit known lower bound',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 f.nodes.get('ga-predecessor-page-minimum--testextension').value='179';
 await f.nodes.get('ga-predecessor-page-start--testextension').onclick();assert.deepEqual(f.calls,[['測試前輩',179]]);
});

test('resume picker does not launch without a selected checkpoint',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 assert.equal(f.nodes.get('ga-predecessor-page-checkpoint--testextension').type,'file');
 await f.nodes.get('ga-predecessor-page-resume--testextension').onclick();assert.deepEqual(f.calls,[]);
 assert.ok(f.nodes.get('ga-predecessor-page-config--testextension'));
});

test('resume can use remembered checkpoint without file picker',async()=>{const f=fixture();f.saved({data:{},hash:'a'.repeat(64)});f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();await f.nodes.get('ga-predecessor-page-resume--testextension').onclick();assert.deepEqual(f.calls,[['測試前輩','a'.repeat(64)]]);assert.equal(f.nodes.has('ga-predecessor-page-config--testextension'),false)});

test('offline import entry sends only hash, never private checkpoint bytes',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();f.nodes.get('ga-predecessor-page-checkpoint-hash--testextension').value='a'.repeat(64);await f.nodes.get('ga-predecessor-page-manual-import--testextension').onclick();assert.deepEqual(f.calls,[['predecessor-open-checkpoint-import','a'.repeat(64)]])});

test('installed import stays in original chat and sends only expected hash',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();f.nodes.get('ga-predecessor-page-checkpoint-hash--testextension').value='a'.repeat(64);await f.nodes.get('ga-predecessor-page-local-import--testextension').onclick();assert.deepEqual(f.calls,[['predecessor-installed-checkpoint-import','a'.repeat(64)]]);assert.ok(f.nodes.has('ga-predecessor-page-config--testextension'))});

test('targeted anchor controls dispatch local-only locate and current capture',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();f.nodes.get('ga-predecessor-page-anchor-id--testextension').value='user|turn:abc';await f.nodes.get('ga-predecessor-page-anchor-locate--testextension').onclick();await f.nodes.get('ga-predecessor-page-anchor-capture--testextension').onclick();assert.deepEqual(f.calls,[['anchor','user|turn:abc','測試前輩',false],['anchor','user|turn:abc','測試前輩',true]]);assert.ok(f.nodes.has('ga-predecessor-page-config--testextension'))});

test('anchor launcher exposes ten-minute budget',()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();assert.equal(f.nodes.get('ga-predecessor-page-anchor-locate--testextension').textContent,'依原文搜尋（10分鐘無進展停止）')});

test('anchor and complete scan are visibly distinct, with active status at top',async()=>{const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();const pane=f.nodes.get('ga-predecessor-page-config--testextension'),mode=f.nodes.get('ga-predecessor-page-mode--testextension'),anchor=f.nodes.get('ga-predecessor-page-anchor-locate--testextension'),resume=f.nodes.get('ga-predecessor-page-resume--testextension');assert.ok(pane.children.indexOf(mode)<pane.children.indexOf(anchor));assert.ok(pane.children.indexOf(anchor)<pane.children.indexOf(resume));assert.match(anchor.style.cssText,/display:block/);assert.match(resume.textContent,/完整聊天續掃/);f.nodes.get('ga-predecessor-page-anchor-id--testextension').value='user|turn:abc';await anchor.onclick();assert.match(mode.textContent,/目前模式：原文搜尋/);assert.match(mode.textContent,/user\|turn:abc/);assert.match(mode.textContent,/local evidence/);});


test('toolbar status exposes only metadata for current chat; resume reuses pinned checkpoint without starting a new scan',async()=>{
 const f=fixture(),hash='a'.repeat(64);
 f.records({'https://chatgpt.com/c/firstpinned':{raw:'private',count:120,hash,runId:'base'},'https://chatgpt.com/c/firstcandidate':{raw:'candidate private',count:200,hash:'b'.repeat(64),runId:'candidate'}});
 const status=await f.popup({type:'predecessor-popup-status',chat:'/c/first'});
 assert.equal(status.pinned.count,120);assert.equal(status.candidate.count,200);assert.equal(status.pinned.raw,undefined);
 assert.equal(status.busy,false);assert.deepEqual(f.calls,[]);
 f.saved({data:{},hash});
 f.readHook((storage,source,core,slot)=>{assert.equal(source,'https://chatgpt.com/c/first');assert.equal(slot,'pinned')});
 assert.equal((await f.popup({type:'predecessor-popup-resume',chat:'/c/first',title:'測試前輩'})).ok,true);
 assert.deepEqual(f.calls,[['測試前輩',hash]]);
});
test('toolbar rejects missing checkpoint, wrong chat, in-flight work, pending export and changed chat after read',async()=>{
 const f=fixture(),cmd={type:'predecessor-popup-resume',chat:'/c/first',title:'測試前輩'};
 await assert.rejects(f.popup(cmd),/尚無已記住/);
 await assert.rejects(f.popup({...cmd,chat:'/c/other'}),/聊天已切換/);
 f.saved({data:{},hash:'a'.repeat(64)});
 f.state.bulk={};await assert.rejects(f.popup(cmd),/請勿中斷/);delete f.state.bulk;
 f.nodes.set('active-scan',{});await assert.rejects(f.popup(cmd),/請勿中斷/);f.nodes.delete('active-scan');
 f.readHook(()=>f.route('/c/second'));await assert.rejects(f.popup(cmd),/聊天已切換/);
 assert.deepEqual(f.calls,[]);
});
test('toolbar advanced settings opens the existing page configuration without toggling it off or scanning',async()=>{
 const f=fixture(),cmd={type:'predecessor-popup-config',chat:'/c/first'};
 await f.popup(cmd);const pane=f.nodes.get('ga-predecessor-page-config--testextension');assert.ok(pane);
 await f.popup(cmd);assert.equal(f.nodes.get('ga-predecessor-page-config--testextension'),pane);
 for(const id of ['ga-predecessor-page-resume--testextension','ga-predecessor-page-checkpoint--testextension','ga-predecessor-page-resume-candidate--testextension','ga-predecessor-page-local-import--testextension','ga-predecessor-page-anchor-locate--testextension','ga-predecessor-page-start--testextension'])assert.ok(f.nodes.has(id));
 await assert.rejects(f.popup({...cmd,type:'predecessor-popup-resume'}),/已開啟的完整設定/);
 assert.deepEqual(f.calls,[]);
});
test('toolbar actual popup markup and callbacks preserve old entries and never fall back on failed resume',async()=>{
 const html=fs.readFileSync(p.join(__dirname,'popup.html'),'utf8'),js=fs.readFileSync(p.join(__dirname,'popup.js'),'utf8');
 new vm.Script(js);
 for(const id of ['predecessorUp','predecessorTestTen','predecessorTestTwenty','predecessorSaved','predecessorResume','predecessorConfig','scanDown','pickRange','backfill'])assert.ok(html.includes('id="'+id+'"'));
 const nodes=new Map(),calls=[],notices=[];
 const ctx={chat:'/c/first',$:id=>{if(!nodes.has(id))nodes.set(id,{value:'測試前輩'});return nodes.get(id)},notice:(...args)=>notices.push(args),sendTab:async m=>{calls.push(m.type);return m.type==='predecessor-popup-status'?{ok:true,pinned:{count:120,runId:'base',hash:'a'.repeat(64)},busy:false}:{ok:false,error:'no checkpoint'}}};
 vm.runInNewContext(js.slice(js.indexOf('// Toolbar entry points'))+';globalThis.refresh=refreshPredecessorSaved',ctx);
 await ctx.refresh();assert.equal(nodes.get('predecessorResume').disabled,false);
 await nodes.get('predecessorResume').onclick();
 assert.deepEqual(calls,['predecessor-popup-status','predecessor-popup-resume','predecessor-popup-status']);assert.match(notices[0][0],/無法續掃/);
 await nodes.get('predecessorConfig').onclick();assert.equal(calls.at(-1),'predecessor-popup-config');
});

test('new toolbar and left launcher ignore old-version right launcher and configuration without removing them',async()=>{
 const f=fixture();let legacyClicks=0;
 const oldButton={id:'ga-predecessor-page-launcher',click(){legacyClicks++}},oldPane={id:'ga-predecessor-page-config',dataset:{chat:'/c/first'}};
 f.nodes.set(oldButton.id,oldButton);f.nodes.set(oldPane.id,oldPane);
 await f.popup({type:'predecessor-popup-config',chat:'/c/first'});
 const launcher=f.nodes.get('ga-predecessor-page-launcher--testextension'),pane=f.nodes.get('ga-predecessor-page-config--testextension');
 assert.ok(launcher);assert.ok(pane);assert.match(launcher.style.cssText,/left:18px/);assert.match(pane.style.cssText,/left:18px/);
 assert.match(launcher.textContent,/V0\.10\.48/);assert.equal(legacyClicks,0);
 assert.equal(f.nodes.get(oldButton.id),oldButton);assert.equal(f.nodes.get(oldPane.id),oldPane);
 f.route('/c/second');f.launch();assert.equal(f.nodes.has(pane.id),false);assert.equal(f.nodes.get(oldPane.id),oldPane);
});
test('shared active panel from other version prevents opening settings or starting another scan',async()=>{
 const f=fixture();let detailClicks=0;
 f.nodes.set('active-scan',{dataset:{gaExtensionId:'old'},gaShowHistoryDetails(){detailClicks++}});
 f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 assert.equal(detailClicks,0);assert.equal(f.nodes.has('ga-predecessor-page-config--testextension'),false);
 await assert.rejects(f.popup({type:'predecessor-popup-config',chat:'/c/first'}),/請勿中斷/);
 assert.equal((await f.popup({type:'predecessor-popup-status',chat:'/c/first'})).busy,true);
 assert.deepEqual(f.calls,[]);
});

test('rush-to-top is a separate navigation-only entry with optional anchors and no scan dispatch',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 f.nodes.get('ga-predecessor-page-top-id--testextension').value='user|turn:abc';
 f.nodes.get('ga-predecessor-page-top-files--testextension').value='a.pdf,b.pdf,c.pdf';
 await f.nodes.get('ga-predecessor-page-rush-top--testextension').onclick();
 assert.deepEqual(f.calls,[['rush','user|turn:abc','a.pdf,b.pdf,c.pdf']]);
 assert.ok(f.nodes.has('ga-predecessor-page-config--testextension'));
 assert.match(f.nodes.get('ga-predecessor-page-mode--testextension').textContent,/不掃描/);
});
test('navigation loop refuses a false top with wrong anchor, can cancel, and never calls archive readers',async()=>{
 const block=source.slice(source.indexOf('  function historyTopNavigationSnapshot'),source.indexOf('  async function historyBegin'));
 let now=0,scrolls=0,snap={firstId:'user|turn:wrong',isUser:true,match:false,found:0,owner:{}},removed=0,loading=false,stop=false;
 const host={scrollTop:100,scrollHeight:2000},state={};
 const ctx={state,document:{getElementById:()=>null,createElement:()=>({dataset:{},isConnected:true,remove(){removed++}}),body:{append(){}}},chrome:{runtime:{id:'test'}},valid:()=>true,path:()=>'/c/test',isGenerating:()=>false,HISTORY_PANEL:'scan',historyHost:()=>host,historyLoading:()=>loading,historyScroll(h,to){assert.equal(to,0);scrolls++;h.scrollTop=to},sleep:async ms=>{now+=ms},Date:{now:()=>now}};
 vm.createContext(ctx);vm.runInContext(block+';historyTopNavigationSnapshot=()=>globalThis.snapshot();globalThis.rush=historyRushTop',ctx);ctx.snapshot=()=>snap;
 await assert.rejects(ctx.rush('user|turn:abc','a.pdf',()=>{},()=>stop),/未找到指定開頭/);
 assert.ok(scrolls>1);assert.equal(removed,1);assert.equal(state.bulk,null);
 now=0;scrolls=0;host.scrollTop=100;
 ctx.sleep=async ms=>{now+=ms;if(now>=12000)snap={firstId:'user|turn:abc',isUser:true,match:true,found:1,owner:{}}};
 const result=await ctx.rush('user|turn:abc','a.pdf',()=>{});
 assert.equal(result.verified,true);assert.ok(now>=20000);assert.equal(state.bulk,null);
 now=0;host.scrollTop=0;ctx.sleep=async ms=>{now+=ms};const unknown=await ctx.rush('','',()=>{});
 assert.equal(unknown.verified,false);assert.match(unknown.message,/尚未確認/);
 now=0;stop=true;await assert.rejects(ctx.rush('','',()=>{},()=>stop),/導航已停止/);
 assert.equal(state.bulk,null);
 assert.doesNotMatch(block,/\b(?:historyRead|historyDownload|historyRemember|historyPayload)\s*\(/);
});
test('attachment anchor must match the first user owner, not later turns or arbitrary prose',()=>{
 const block=source.slice(source.indexOf('  function historyTopNavigationSnapshot'),source.indexOf('  async function historyRushTop'));
 const chip=name=>({getAttribute:k=>k==='title'?name:null,innerText:name+'\\nPDF'});
 const first={getAttribute:k=>k==='data-turn-key'?'abc':null,contains:n=>n===first,querySelectorAll:()=>[chip('a.pdf'),chip('b.pdf'),chip('c.pdf')]},later={...first,getAttribute:k=>k==='data-turn-key'?'later':null};
 const ctx={historyRoot:()=>({querySelectorAll:()=>[first,later]}),historyVisible:()=>true,historyOwner:x=>x,outerUsers:()=>[first,later]};vm.createContext(ctx);vm.runInContext(block+';globalThis.snap=historyTopNavigationSnapshot',ctx);
 assert.equal(ctx.snap({},'user|turn:abc',['a.pdf','b.pdf','c.pdf']).match,true);
 assert.equal(ctx.snap({},'user|turn:later',['a.pdf']).match,false);
 assert.equal(ctx.snap({},'user|turn:abc',['a.pdf','missing.pdf']).match,false);
});
