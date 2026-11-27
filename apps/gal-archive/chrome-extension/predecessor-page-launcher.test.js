'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),p=require('node:path');
const source=fs.readFileSync(p.join(__dirname,'content.js'),'utf8'),block=source.slice(source.indexOf("  const HISTORY_LAUNCHER="),source.indexOf("  chrome.runtime.onMessage.addListener"));
function fixture(){
 const nodes=new Map(),calls=[],prefixModes=[];let route='/c/first',result={ok:true},saved=null,records={},readHook=null,localHook=null;
 const element=tag=>({tag,id:'',dataset:{},style:{},children:[],append(...children){this.children.push(...children);for(const n of children)if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id);for(const n of this.children)if(n.id)nodes.delete(n.id)},setAttribute(){},click(){return this.onclick?.()},scrollIntoView(){calls.push('existing')}});
 const body=element('body'),ctx={pc:require('./predecessor-chat-core'),document:{title:'測試前輩 - ChatGPT',body,createElement:element,getElementById:id=>nodes.get(id)},location:{origin:'https://chatgpt.com'},GalCheckpointMemory:{key:(source,slot)=>source+slot,read:async(...args)=>{if(readHook)await readHook(...args);return saved}},chrome:{storage:{local:{get:async()=>records}},runtime:{id:'testextension',getManifest:()=>({version:'0.10.48'}),sendMessage:async m=>{calls.push([m.type,m.expectedHash]);return {ok:true,readback:true,hash:m.expectedHash,count:2,runId:'run'}}}},historyPanelButton:(button,color)=>{button.type='button';button.style.cssText='background:'+color;return button},historyPrefixSupplement:async (id,files,title,checkpoint,report,cancel,observed=false)=>{prefixModes.push(observed);calls.push(['prefix',id,files,title,checkpoint.hash]);if(localHook)await localHook('prefix');return {ok:true,message:'prefix evidence'}},historyRushTop:async (id,files,report)=>{calls.push(['rush',id,files]);report('navigation');if(localHook)await localHook('rush');return {ok:true,message:'navigation only'}},historyAnchorCapture:async (id,title,report,capture,cancel,options)=>{calls.push(['anchor',id,title,capture]);if(options?.file)calls.push(['anchor-options',options.file.name,options.expectedHash,options.maxScreens]);return {ok:true,message:'local evidence'}},HISTORY_PANEL:'active-scan',valid:()=>route.startsWith('/c/'),path:()=>route,historyBegin:async (title,sample,minimum,checkpoint)=>{calls.push(checkpoint?[title,checkpoint.hash]:sample?[title,sample]:minimum?[title,minimum]:title);return result}};
 Object.assign(ctx,{state:{},isGenerating:()=>false});vm.createContext(ctx);vm.runInContext(block+';globalThis.launch=historyLauncher;globalThis.popup=historyPopupCommand;',ctx);
 return {nodes,calls,prefixModes,launch:ctx.launch,route:x=>{route=x},result:x=>{result=x},saved:x=>{saved=x},records:x=>{records=x},readHook:x=>{readHook=x},localHook:x=>{localHook=x},popup:ctx.popup,state:ctx.state};
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

test('new toolbar and left launcher ignore old-version launcher and configuration without removing them',async()=>{
 const f=fixture();let legacyClicks=0;
 const oldButton={id:'ga-predecessor-page-launcher',click(){legacyClicks++}},oldPane={id:'ga-predecessor-page-config',dataset:{chat:'/c/first'}};
 f.nodes.set(oldButton.id,oldButton);f.nodes.set(oldPane.id,oldPane);
 await f.popup({type:'predecessor-popup-config',chat:'/c/first'});
 const launcher=f.nodes.get('ga-predecessor-page-launcher--testextension'),pane=f.nodes.get('ga-predecessor-page-config--testextension');
 assert.ok(launcher);assert.ok(pane);assert.match(launcher.style.cssText,/left:18px!important;right:auto!important/);assert.match(pane.style.cssText,/left:18px!important;right:auto!important/);
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
 const ctx={state,document:{getElementById:()=>null,createElement:()=>({dataset:{},isConnected:true,remove(){removed++}}),body:{append(){}}},chrome:{runtime:{id:'test'}},valid:()=>true,path:()=>'/c/test',isGenerating:()=>false,HISTORY_PANEL:'scan',historyHost:()=>host,historyLoading:()=>loading,historyNativeFailure:()=>null,historyScroll(h,to){assert.equal(to,0);scrolls++;h.scrollTop=to},sleep:async ms=>{now+=ms},Date:{now:()=>now}};
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
test('rush handles native history retry before accepting top, never scrolls while retrying, and rejects invalid observed first',async()=>{
 const block=source.slice(source.indexOf('  function historyTopNavigationSnapshot'),source.indexOf('  async function historyBegin'));
 let now=0,failed=true,clicks=0,scrolls=0,removed=0,stop=false,first='user|turn:abc';
 const host={isConnected:true,scrollTop:0,scrollHeight:2000},state={};
 const ctx={state,document:{getElementById:()=>null,createElement:()=>({dataset:{},isConnected:true,remove(){removed++}}),body:{append(){}}},chrome:{runtime:{id:'test'}},valid:()=>true,path:()=>'/c/test',isGenerating:()=>false,HISTORY_PANEL:'scan',historyHost:()=>host,historyLoading:()=>false,historyNativeFailure:()=>failed?{button:{}}:null,historyNativeRetry:async(b,until,{guard,report,maxAttempts})=>{guard();assert.equal(maxAttempts,Infinity);assert.equal(b.host,host);assert.equal(b.rows.length,0);assert.ok(until>now);clicks++;report('retry');now+=2000;failed=false;guard();return true},historyScroll(){assert.equal(failed,false);scrolls++},sleep:async ms=>{now+=ms},Date:{now:()=>now}};
 vm.createContext(ctx);vm.runInContext(block+';historyTopNavigationSnapshot=()=>globalThis.snapshot();globalThis.rush=historyRushTop',ctx);ctx.snapshot=()=>({firstId:first,isUser:true,match:true,found:0,owner:{}});
 const ok=await ctx.rush('','',()=>{});assert.equal(ok.verified,false);assert.equal(clicks,1);assert.equal(scrolls,0);assert.ok(now>=10000);
 now=0;failed=true;ctx.historyNativeRetry=async()=>{throw Error('原生歷史載入失敗')};await assert.rejects(ctx.rush('','',()=>{}),/原生歷史載入失敗/);assert.equal(state.bulk,null);
 now=0;failed=false;first='';await assert.rejects(ctx.rush('','',()=>{}),/未確認抵頂/);assert.equal(state.bulk,null);
 now=0;failed=true;first='user|turn:abc';ctx.historyNativeRetry=async(b,until,{guard})=>{stop=true;guard()};await assert.rejects(ctx.rush('','',()=>{},()=>stop),/導航已停止/);assert.equal(state.bulk,null);
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

test('top-down supplement uses explicitly selected saved candidate without launching scan or replacing it',async()=>{
 const f=fixture();f.saved({data:{count:987},hash:'b'.repeat(64)});f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 f.nodes.get('ga-predecessor-page-config--testextension').isConnected=true;
 f.nodes.get('ga-predecessor-page-top-id--testextension').value='user|turn:abc';
 f.nodes.get('ga-predecessor-page-top-files--testextension').value='a.pdf,b.pdf,c.pdf';
 f.nodes.get('ga-predecessor-page-prefix-slot--testextension').value='candidate';
 f.readHook((storage,source,core,slot)=>assert.equal(slot,'candidate'));
 await f.nodes.get('ga-predecessor-page-prefix-start--testextension').onclick();
 assert.deepEqual(f.calls,[['prefix','user|turn:abc','a.pdf,b.pdf,c.pdf','測試前輩','b'.repeat(64)]]);
 assert.match(f.nodes.get('ga-predecessor-page-mode--testextension').textContent,/頂端向下補掃/);
});
test('prefix supplement uses strict contiguous overlap, at least two original starting rows, and never changes saved rows',()=>{
 const pc=require('./predecessor-chat-core'),ctx={pc};
 const block=source.slice(source.indexOf('  function historyPrefixMerge'),source.indexOf('  async function historyPrefixSupplement'));
 vm.createContext(ctx);vm.runInContext(block+';globalThis.merge=historyPrefixMerge;globalThis.join=historyPrefixJoin',ctx);
 const r=(id,role='user',text=id)=>({id,role,text,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[]});
 const a=r('a'),b=r('b','assistant'),c=r('c'),d=r('d','assistant'),e=r('e');
 const saved=[c,d,e],before=JSON.stringify(saved);
 assert.equal(ctx.join([a,b,c],saved),null);
 assert.equal(ctx.join([a,b,c,d],saved).matched,2);
 assert.equal(ctx.join([a,b,c,d],saved).added,2);
 assert.equal(JSON.stringify(ctx.join([a,b,c,d],saved).candidate),JSON.stringify([a,b,c,d,e]));
 assert.equal(JSON.stringify(saved),before);
 assert.equal(JSON.stringify(ctx.merge([a,b],[b,c,d])),JSON.stringify([a,b,c,d]));
 assert.equal(JSON.stringify(ctx.merge([a,b,c],[b,c])),JSON.stringify([a,b,c]));
 for(const bad of [[d,e],[a,c],[b,{...c,text:'changed'}],[b,a,c]])assert.throws(()=>ctx.merge([a,b,c],bad));
 for(const bad of [[a,d,e],[a,c,e],[a,c,{...d,text:'changed'}],[a,c,d,e,r('extra')]])assert.throws(()=>ctx.join(bad,saved));
});
test('prefix supplement current-top guard and evidence-only export, no scanning when opening is not proven',async()=>{
 const pc0=require('./predecessor-chat-core'),r=(id,role='user')=>({id,role,text:id,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[]});
 const a=r('user|turn:abc'),b=r('assistant|turn:abc','assistant'),c=r('user|turn:next'),d=r('assistant|turn:next','assistant'),e=r('user|turn:tail');
 let now=0,reads=0,downloads=[],moves=[],snapshot=true,host={scrollTop:0,scrollHeight:3000,clientHeight:600,isConnected:true};
 const ctx={pc:{...pc0,validateCheckpoint:()=>[c,d,e],sourceId:()=> 'test'},state:{},location:{origin:'https://chatgpt.com'},document:{title:'測試前輩',getElementById:()=>null,createElement:()=>({dataset:{},isConnected:true,remove(){}}),body:{append(){}}},chrome:{runtime:{id:'test',getManifest:()=>({version:'0.10.67'})}},crypto:{randomUUID:()=> 'test-run'},valid:()=>true,path:()=>'/c/test',isGenerating:()=>false,HISTORY_PANEL:'scan',historyHost:()=>host,historyTopNavigationSnapshot:()=>({match:snapshot,firstId:a.id,found:3}),historyLoading:()=>false,historyNativeFailure:()=>false,historyRead:()=>{reads++;return host.scrollTop===0?[a,b]:[b,c,d]},historyScroll:(h,to)=>{h.scrollTop=to;moves.push(to)},historyAtBottom:()=>false,sleep:async ms=>{now+=ms},Date:class extends Date{static now(){return now}},historyDownload:x=>{downloads.push(x);return 'evidence.json'}};
 const block=source.slice(source.indexOf('  function historyPrefixMerge'),source.indexOf('  async function historyAnchorCapture'));vm.createContext(ctx);vm.runInContext(block+';globalThis.supplement=historyPrefixSupplement',ctx);
 const cp={hash:'a'.repeat(64),data:{runId:'base'}};
 const result=await ctx.supplement(a.id,'a.pdf,b.pdf,c.pdf','測試前輩',cp,()=>{});
 assert.equal(result.ok,true);assert.ok(moves.every(x=>x>0));assert.equal(downloads[0].importable,false);assert.equal(downloads[0].continuity,false);assert.equal(downloads[0].evidence.openingVerified,true);assert.equal(downloads[0].evidence.added,2);assert.equal(downloads[0].evidence.matched,2);assert.equal(downloads[0].candidateRows.length,5);assert.equal(ctx.state.bulk,null);
 now=0;reads=0;moves=[];host.scrollTop=0;snapshot=false;
 assert.equal((await ctx.supplement(a.id,'a.pdf','測試前輩',cp,()=>{})).ok,false);
 assert.equal(reads,0);assert.equal(moves.length,0);assert.equal(downloads.at(-1).candidateRows,null);
 now=0;reads=0;moves=[];host.scrollTop=0;snapshot=true;
 assert.equal((await ctx.supplement('','','測試前輩',cp,()=>{})).ok,false);
 assert.equal((await ctx.supplement(a.id,'','測試前輩',cp,()=>{},()=>false,true)).ok,false);
 assert.equal((await ctx.supplement('','','測試前輩',cp,()=>{},()=>false,true)).ok,true);
 const observed=downloads.at(-1);
 assert.equal(observed.status,'joined-observed-prefix');assert.equal(observed.evidence.openingVerified,false);
 assert.equal(observed.evidence.observedTopVerified,true);assert.equal(observed.evidence.observedFirstId,a.id);
 assert.equal(observed.evidence.openingBasis,'observed-top-only');assert.equal(observed.importable,false);
 assert.equal(observed.canonical,false);assert.equal(observed.continuity,false);assert.equal(observed.candidateRows.length,5);
 now=0;reads=0;moves=[];host.scrollTop=0;snapshot=false;
 assert.equal((await ctx.supplement('','','測試前輩',cp,()=>{},()=>false,true)).ok,false);
 assert.equal(reads,0);assert.equal(moves.length,0);assert.equal(downloads.at(-1).evidence.openingVerified,false);
});

test('navigation and supplement move to compact left-bottom panel during work, then restore left-side settings and inputs',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 const get=n=>f.nodes.get('ga-predecessor-page-'+n+'--testextension'),pane=get('config'),mode=get('mode'),id=get('top-id'),file=get('prefix-file');
 pane.isConnected=true;id.value='user|turn:abc';f.saved({data:{count:987},hash:'a'.repeat(64)});get('prefix-slot').value='candidate';
 const original=pane.style.cssText,originalFile=file.style.cssText;
 let seen=[];
 f.localHook(kind=>{
  seen.push(kind);assert.match(pane.style.cssText,/left:12px!important;right:auto!important;bottom:156px/);
  assert.equal(mode.hidden,false);assert.equal(id.hidden,true);assert.match(file.style.cssText,/display:none!important/);
  assert.equal(get(kind==='rush'?'rush-stop':'prefix-stop').hidden,false);
  assert.equal(get(kind==='rush'?'prefix-stop':'rush-stop').hidden,true);
 });
 await get('rush-top').onclick();assert.equal(pane.style.cssText,original);assert.equal(id.value,'user|turn:abc');assert.equal(get('rush-stop').hidden,true);
 await get('prefix-start').onclick();assert.equal(pane.style.cssText,original);assert.equal(file.style.cssText,originalFile);assert.equal(get('prefix-slot').value,'candidate');assert.equal(get('prefix-stop').hidden,true);
 assert.deepEqual(seen,['rush','prefix']);
});

test('anchor DOM evidence is captured synchronously from the exact native assistant only',()=>{
 const target='assistant|message:target',other='assistant|message:other',row={id:target,role:'assistant',identityBasis:'native-dom-id',text:'A'},otherRow={...row,id:other},code={tagName:'CODE',attributes:[{name:'data-markdown-copy',value:'contents'}],innerText:'A',textContent:'A',outerHTML:'<code>A</code>'},quote={tagName:'BLOCKQUOTE',attributes:[],innerText:'程式碼\\nA',textContent:'程式碼\\nA',outerHTML:'<blockquote><button>程式碼</button><code>A</code></blockquote>'};
 const body={tagName:'DIV',isConnected:true,attributes:[{name:'data-response-body',value:'true'}],innerText:'程式碼\\nA',textContent:'程式碼\\nA',outerHTML:'<div data-response-body>'+quote.outerHTML+'</div>',contains:n=>[body,quote,code].includes(n),querySelectorAll:()=>[quote,code],getBoundingClientRect:()=>({x:1,y:2,width:3,height:4})};
 quote.parentElement=body;code.parentElement=quote;
 const owner={contains:n=>n===body,getAttribute:()=> 'turn'},entry={row,el:body,owner,body},unrelated={row:otherRow,get body(){throw Error('unrelated DOM must not be captured')}};
 let reads=0;
 const ctx={pc:require('./predecessor-chat-core'),historyRead:(host,fold,onEntries)=>{reads++;onEntries([entry,unrelated]);body.isConnected=false;body.outerHTML='';return [row,otherRow]}};
 const script=source.slice(source.indexOf('  function historyAnchorDomSnapshot'),source.indexOf('  async function historyAnchorCapture'));
 vm.createContext(ctx);vm.runInContext(script+';globalThis.read=historyAnchorReadWindow;globalThis.snapshot=historyAnchorDomSnapshot',ctx);
 const result=ctx.read({},()=>{},{id:target,role:'assistant',text:null},false);
 assert.equal(reads,1);assert.equal(result.observation.rawDom.status,'captured');assert.equal(result.observation.rawDom.messageId,target);
 assert.match(result.observation.rawDom.response.outerHTML.text,/程式碼/);
 assert.equal(result.observation.rawDom.details[1].node.textContent.text,'A');
 assert.equal(result.observation.rawDom.details[1].ancestors[0].tag,'blockquote');
 assert.equal(result.observation.rawDom.truncated,false);assert.equal(body.isConnected,false);
 assert.equal(ctx.snapshot(entry).status,'unavailable');
 assert.equal(ctx.read({},()=>{},{id:'assistant|message:missing',role:'assistant',text:null},false).observation,null);
 body.isConnected=true;body.outerHTML='x'.repeat(130000);
 const capped=ctx.snapshot(entry);assert.equal(capped.truncated,true);assert.equal(capped.response.outerHTML.length,130000);assert.equal(capped.response.outerHTML.text.length,120000);
});
test('assistant first-match evidence survives virtualization before the second observation',async()=>{
 const target='assistant|message:target',row={id:target,role:'assistant',identityBasis:'native-dom-id',text:'A'},host={scrollTop:10,scrollHeight:100,clientHeight:20};
 const body={tagName:'DIV',isConnected:true,attributes:[],innerText:'A',textContent:'A',outerHTML:'<div>A</div>',contains:n=>n===body,querySelectorAll:()=>[],getBoundingClientRect:()=>({x:0,y:0,width:10,height:10})},owner={contains:n=>n===body,getAttribute:()=> 'turn'};
 let mounted=true,reads=0,downloads=[];
 const ctx={pc:require('./predecessor-chat-core'),state:{},valid:()=>true,path:()=>'/c/test',location:{origin:'https://chatgpt.com'},document:{title:'測試',getElementById:()=>null},HISTORY_PANEL:'panel',isGenerating:()=>false,crypto:{randomUUID:()=> 'run'},GalCheckpointMemory:{read:async()=>null},chrome:{runtime:{getManifest:()=>({version:'0.10.69'})},storage:{local:{get:async()=>({}),set:async()=>{}}}},candidates:new Map(),historyHost:()=>host,historyLoading:()=>false,historyRead:(h,f,onEntries)=>{reads++;if(!mounted)return [];onEntries([{row,el:body,owner,body}]);return [row]},historyNativeProgress:()=>{},historyAtBottom:()=>false,historyDownload:e=>{downloads.push(e);return 'evidence.json'},sleep:async()=>{mounted=false;body.isConnected=false}};
 const script=source.slice(source.indexOf('  function historyAnchorDomSnapshot'),source.indexOf('  const HISTORY_LAUNCHER='));
 vm.createContext(ctx);vm.runInContext(script+';globalThis.capture=historyAnchorCapture',ctx);
 const result=await ctx.capture(target,'測試',()=>{},true);
 assert.equal(result.ok,true);assert.equal(reads,2);assert.equal(downloads.length,1);
 const e=downloads[0];assert.equal(e.status,'matched-unconfirmed');assert.equal(e.domCapture.status,'captured');assert.equal(e.domCapture.observations,1);
 assert.equal(e.observations[0].rawDom.response.outerHTML.text,'<div>A</div>');assert.equal(e.canonical,false);assert.equal(e.importable,false);
});

test('settling returns a diagnostic anchor immediately without another read or scroll; full scan ignores hook',async()=>{
 const target={id:'assistant|message:target',role:'assistant',text:'A'},host={},observation={rawDom:{status:'captured'}};
 let reads=0,anchorReads=0,sleeps=0,now=0;
 const ctx={pc:{fingerprint:()=> 'same'},historyGuard:()=>{},historyLoading:()=>false,historyRead:()=>{reads++;return [target]},historyFoldObservation:()=>{},historyAttachmentChange:()=>{},historyStatus:()=>{},sleep:async ms=>{sleeps++;now+=ms},Date:class extends Date{static now(){return now}}};
 ctx.pc.compareRow=()=>({changes:[]});
 const script=source.slice(source.indexOf('  async function historySettled'),source.indexOf('  function historyGuard'));
 vm.createContext(ctx);vm.runInContext(script+';globalThis.settle=historySettled',ctx);
 const hook=()=>{anchorReads++;return {rows:[target],observation}};
 const b={mode:'predecessor-anchor',host,scrollStats:{},stabilityIssues:[]};
 const rows=await ctx.settle(b,{anchorRead:hook});assert.equal(rows[0],target);assert.equal(anchorReads,1);assert.equal(reads,0);assert.equal(sleeps,0);
 await ctx.settle({...b,mode:'predecessor-history'},{anchorRead:hook});
 assert.equal(anchorReads,1);assert.ok(reads>=2);assert.ok(sleeps>=2);
});

test('guided anchor settings pass a readonly selected file and configurable coarse step',async()=>{
 const f=fixture();f.launch();f.nodes.get('ga-predecessor-page-launcher--testextension').onclick();
 const file={name:'checkpoint.json',size:200};
 f.nodes.get('ga-predecessor-page-anchor-id--testextension').value='assistant|message:target';
 f.nodes.get('ga-predecessor-page-anchor-file--testextension').files=[file];
 f.nodes.get('ga-predecessor-page-anchor-hash--testextension').value='a'.repeat(64);
 const step=f.nodes.get('ga-predecessor-page-anchor-step--testextension');assert.equal(step.value,'24');step.value='48';
 await f.nodes.get('ga-predecessor-page-anchor-locate--testextension').onclick();
 assert.deepEqual(f.calls,[['anchor','assistant|message:target','測試前輩',false],['anchor-options','checkpoint.json','a'.repeat(64),48]]);
});
test('guided anchor coarse moves, near moves, current-start probes and rank bounds',()=>{
 const pc=require('./predecessor-chat-core'),g={top:80000,height:100000,client:674};
 const far=pc.anchorDiagnosticHint(1,[84,85],g,{},24);
 assert.equal(far.mode,'coarse');assert.equal(far.top,80000-24*674);assert.equal(far.best.index,84);
 const near=pc.anchorDiagnosticHint(1,[3,4],{...g,top:10000},far,24);
 assert.equal(near.mode,'local-probe');assert.ok(Math.abs(near.top-10000)<674);
 const unknown=pc.anchorDiagnosticHint(undefined,[],g,{},24);
 assert.equal(unknown.top,80000-24*674);assert.equal(unknown.best,null);
 const below=pc.anchorDiagnosticHint(20,[3,4],{...g,top:10000},{},24);
 const above=pc.anchorDiagnosticHint(20,[40,41],{...g,top:50000},below,24);
 assert.equal(above.mode,'rank-bracket');assert.equal(above.top,30000);
 const changed=pc.anchorDiagnosticHint(20,[40],{...g,top:50000,height:120000},below,24);
 assert.equal(changed.low,null);assert.equal(changed.mode,'coarse');
 assert.throws(()=>pc.anchorDiagnosticHint(1,[3],g,{},65),/1至64/);
});
test('guided anchor lost live rank restored at most once until improvement',()=>{
 const pc=require('./predecessor-chat-core'),g={top:10000,height:100000,client:674};
 const best=pc.anchorDiagnosticHint(1,[5],g,{},24);
 const bottom={...g,top:99326};
 const restored=pc.anchorDiagnosticHint(1,[85],bottom,best,24);
 assert.equal(restored.mode,'restore-live-best');assert.equal(restored.restored,true);
 const repeated=pc.anchorDiagnosticHint(1,[85],bottom,restored,24);
 assert.equal(repeated.restore,false);assert.equal(repeated.restored,true);
 const better=pc.anchorDiagnosticHint(1,[2],{...g,top:5000},repeated,24);
 assert.equal(better.improved,true);assert.equal(better.restored,false);
 const edge=pc.anchorDiagnosticHint(undefined,[],{...g,top:0},{},24,4);
 assert.equal(edge.mode,'edge-probe');assert.ok(edge.top>0);
});


test('observed prefix mode is a visible explicit button, defaults off, and dispatches the exact selected mode',async()=>{
 const f=fixture(),get=id=>f.nodes.get('ga-predecessor-page-'+id+'--testextension');f.saved({data:{count:1110},hash:'a'.repeat(64)});f.launch();get('launcher').onclick();
 get('config').isConnected=true;
 const toggle=get('prefix-observed');assert.equal(toggle.tag,'button');assert.equal(toggle.type,'button');assert.match(toggle.style.cssText,/min-height:44px!important/);assert.match(toggle.textContent,/未選擇/);
 get('prefix-slot').value='candidate';get('top-id').value='';get('top-files').value='';
 toggle.onclick();assert.match(toggle.textContent,/已選擇/);assert.deepEqual(f.calls,[]);
 await get('prefix-start').onclick();assert.deepEqual(f.prefixModes,[true]);
 toggle.disabled=true;toggle.onclick();assert.match(toggle.textContent,/已選擇/);toggle.disabled=false;
 toggle.onclick();assert.match(toggle.textContent,/未選擇/);await get('prefix-start').onclick();assert.deepEqual(f.prefixModes,[true,false]);
});


test('prefix resume validates provenance and two consecutive live tail rows before extending',()=>{
 const pc0=require('./predecessor-chat-core'),pc={...pc0,sourceId:()=> 'test'},ctx={pc};
 const block=source.slice(source.indexOf('  function historyPrefixMerge'),source.indexOf('  async function historyPrefixSupplement'));
 vm.createContext(ctx);vm.runInContext(block+';globalThis.validate=historyPrefixResumeRows;globalThis.resume=historyPrefixResumeWindow',ctx);
 const row=(id,index)=>({id,role:'user',text:id,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[],index});
 const a=row('user|turn:a',0),b=row('user|turn:b',1),c=row('user|turn:c',2),d=row('user|turn:d',0),e=row('user|turn:e',1),saved=[d,e],sourceUrl='https://chatgpt.com/c/test',cp={hash:'a'.repeat(64),data:{runId:'base'}};
 const prior={hash:'b'.repeat(64),data:{format:'gal-predecessor-prefix-supplement-evidence',version:1,status:'failed',canonical:false,importable:false,continuity:false,chatId:'test',sourceUrl,runId:'prefix',candidateRows:null,count:3,rows:[a,b,c],base:{runId:'base',sha256:cp.hash,count:2,firstId:d.id},evidence:{observedTopVerified:true,originalCheckpointUnchanged:true,observedFirstId:a.id}}};
 const liveRow=({index,...row})=>row;
 const before=JSON.stringify(prior);const previous=ctx.validate(prior,cp,saved.map(liveRow),sourceUrl);
 assert.equal(JSON.stringify(ctx.resume(previous,[b,c,d,e].map(liveRow))),JSON.stringify([a,b,c,d,e].map(liveRow)));assert.equal(JSON.stringify(prior),before);
 for(const live of [[c,d],[b,d],[b,{...c,text:'changed'},d],[c,b,d]])assert.throws(()=>ctx.resume(previous,live.map(liveRow)),/重疊/);
 for(const change of [{chatId:'other'},{count:4},{sourceUrl:'wrong'},{canonical:true},{base:{...prior.data.base,sha256:'c'.repeat(64)}},{rows:[a,{...b,index:9},c]}])assert.throws(()=>ctx.validate({...prior,data:{...prior.data,...change}},cp,saved.map(liveRow),sourceUrl),/來源/);
});


test('prefix supplement runs beyond fifteen minutes when growing, still stops on no progress or cancellation',async()=>{
 const pc0=require('./predecessor-chat-core'),r=i=>({id:'user|turn:test-'+i,role:'user',text:'row '+i,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[]});
 const all=Array.from({length:16},(_,i)=>r(i)),saved=all.slice(12);let now=0,at=0,stop=false,mode='grow',moves=0;const downloads=[];
 const host={scrollTop:0,scrollHeight:100000,clientHeight:600,isConnected:true};
 const ctx={pc:{...pc0,validateCheckpoint:()=>saved,sourceId:()=> 'test'},state:{},location:{origin:'https://chatgpt.com'},document:{title:'測試前輩',getElementById:()=>null,createElement:()=>({dataset:{},isConnected:true,remove(){}}),body:{append(){}}},chrome:{runtime:{id:'test',getManifest:()=>({version:'0.10.76'})}},crypto:{randomUUID:()=> 'test-run'},valid:()=>true,path:()=>'/c/test',isGenerating:()=>false,HISTORY_PANEL:'scan',historyHost:()=>host,historyTopNavigationSnapshot:()=>({match:true,firstId:all[0].id,found:1}),historyLoading:()=>false,historyNativeFailure:()=>false,historyRead:()=>all.slice(at,at+2),historyScroll:(h,to)=>{h.scrollTop=to;moves++;now+=100000;if(mode==='grow')at++;if(mode==='cancel')stop=true},historyAtBottom:()=>false,sleep:async ms=>{now+=ms},Date:class extends Date{static now(){return now}},historyDownload:x=>{downloads.push(x);return 'evidence.json'}};
 const block=source.slice(source.indexOf('  function historyPrefixMerge'),source.indexOf('  async function historyAnchorCapture'));vm.createContext(ctx);vm.runInContext(block+';globalThis.supplement=historyPrefixSupplement',ctx);
 const cp={hash:'a'.repeat(64),data:{runId:'base'}},run=()=>ctx.supplement('','','測試前輩',cp,()=>{},()=>stop,true);
 assert.equal((await run()).ok,true);assert.ok(now>900000);assert.equal(downloads.at(-1).evidence.matched,2);assert.equal(downloads.at(-1).evidence.added,12);assert.equal(downloads.at(-1).importable,false);
 now=0;at=0;moves=0;host.scrollTop=0;mode='stalled';assert.equal((await run()).ok,false);assert.match(downloads.at(-1).error,/180秒無新增/);assert.equal(moves,2);assert.equal(downloads.at(-1).count,2);
 now=0;at=0;moves=0;host.scrollTop=0;mode='cancel';assert.equal((await run()).ok,false);assert.equal(downloads.at(-1).status,'cancelled');assert.equal(ctx.state.bulk,null);
});


test('prefix bottom snap restores a verified original window before advancing, refuses persistent or wrong-anchor returns',async()=>{
 const pc0=require('./predecessor-chat-core'),row=i=>({id:'user|turn:test-'+i,role:'user',text:'row '+i,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[]});
 const all=Array.from({length:9},(_,i)=>row(i)),saved=all.slice(3,6),downloads=[];let now=0,at=0,moves=[],mode='once',snapped=false,stop=false;
 const host={scrollTop:0,scrollHeight:4081005,clientHeight:730,isConnected:true};
 const ctx={pc:{...pc0,validateCheckpoint:()=>saved,sourceId:()=> 'test'},state:{},location:{origin:'https://chatgpt.com'},document:{title:'測試前輩',getElementById:()=>null,createElement:()=>({dataset:{},isConnected:true,remove(){}}),body:{append(){}}},chrome:{runtime:{id:'test',getManifest:()=>({version:'0.10.78'})}},crypto:{randomUUID:()=> 'test-run'},valid:()=>true,path:()=>'/c/test',isGenerating:()=>false,HISTORY_PANEL:'scan',historyHost:()=>host,historyTopNavigationSnapshot:()=>({match:true,firstId:all[0].id,found:0}),historyLoading:()=>false,historyNativeFailure:()=>false,historyRead:()=>all.slice(at,at+(at===1?4:2)),historyScroll:(h,to)=>{moves.push(to);if(!snapped||mode==='persistent'){snapped=true;h.scrollTop=h.scrollHeight-h.clientHeight;at=7;return}if(to===0&&mode==='cancel'){stop=true;return}if(mode==='wrong'){h.scrollTop=to;at=6;return}h.scrollTop=to;at=to===0?0:1},historyAtBottom:h=>h.scrollTop>=h.scrollHeight-h.clientHeight-6,sleep:async ms=>{now+=ms},Date:class extends Date{static now(){return now}},historyDownload:x=>{downloads.push(x);return 'evidence.json'}};
 const block=source.slice(source.indexOf('  function historyPrefixMerge'),source.indexOf('  async function historyAnchorCapture'));vm.createContext(ctx);vm.runInContext(block+';globalThis.supplement=historyPrefixSupplement',ctx);
 const cp={hash:'a'.repeat(64),data:{runId:'base'}},run=()=>ctx.supplement('','','測試前輩',cp,()=>{},()=>stop,true),reset=m=>{now=0;at=0;host.scrollTop=0;moves=[];mode=m;snapped=false;stop=false};
 assert.equal((await run()).ok,true);let d=downloads.at(-1);assert.equal(d.evidence.added,3);assert.equal(d.evidence.matched,2);assert.equal(d.rows.length,5);assert.equal(moves[1],0);assert.ok(moves[2]<moves[0]);assert.ok(d.evidence.recoveryTrace.some(x=>x.event==='restore-verified'));assert.ok(d.evidence.recoveryTrace.some(x=>x.event==='forward-conflict'&&x.top===4080275));assert.equal(d.importable,false);
 for(const m of ['persistent','wrong']){reset(m);assert.equal((await run()).ok,false);d=downloads.at(-1);assert.match(d.error,/無法復原已核對向下視窗/);assert.equal(d.count,2);assert.equal(d.candidateRows,null);assert.equal(d.evidence.recoveryTrace.filter(x=>x.event==='restore-rejected').length,3);assert.equal(d.evidence.recoveryTrace.some(x=>x.event==='restore-verified'),false);assert.equal(ctx.state.bulk,null)}
 reset('cancel');assert.equal((await run()).ok,false);assert.equal(downloads.at(-1).status,'cancelled');assert.equal(downloads.at(-1).count,2);assert.equal(ctx.state.bulk,null);
});
