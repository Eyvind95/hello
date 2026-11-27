// Run isolated synthetic browser tests using the runner's existing Chrome.
// No production URL or private data is loaded.
const {createServer}=require('node:http'),{readFileSync,mkdtempSync,rmSync}=require('node:fs'),{spawn}=require('node:child_process'),{tmpdir}=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const files=['archive-pilot-import.js','archive-pilot-revision.js','archive-pilot-revision-idb.js','archive-pilot-revision-browser.js'];
const server=createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8">'+files.map(f=>'<script src="/'+f+'"></script>').join(''))}
 const f=req.url.slice(1);if(!files.includes(f)){res.statusCode=404;return res.end()}
 res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(readFileSync(path.join(__dirname,f)));
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let child,ws,stderr='';const dir=mkdtempSync(path.join(tmpdir(),'revision-browser-'));
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port+'/';
  child=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,url],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',x=>{stderr=(stderr+x.toString()).slice(-4000)});let launchError;child.on('error',e=>{launchError=e});
  let port;for(let i=0;i<100;i++){if(launchError)throw launchError;if(child.exitCode!==null)throw Error('Chrome exited '+stderr);try{port=Number(readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break}catch(_){}await sleep(100)}
  assert.ok(port,'no DevTools port');
  let tab;for(let i=0;i<100;i++){const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();tab=list.find(x=>x.type==='page'&&x.url.startsWith(url));if(tab)break;await sleep(100)}
  assert.ok(tab,'no test tab');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let seq=0;const pending=new Map();ws.onmessage=e=>{const x=JSON.parse(e.data);if(pending.has(x.id)){const f=pending.get(x.id);pending.delete(x.id);x.error?f.reject(Error(x.error.message)):f.resolve(x.result)}};
  const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('CDP timeout'))},10000).unref()});
  let result;for(let i=0;i<300;i++){const x=await call('Runtime.evaluate',{expression:'globalThis.revisionBrowserResult',returnByValue:true});result=x.result?.value;if(result)break;await sleep(100)}
  assert.ok(result?.ok,JSON.stringify(result||{error:'no test result'}));console.log(JSON.stringify(result,null,2));
 }finally{ws?.close();child?.kill();server.close();await sleep(200);try{rmSync(dir,{recursive:true,force:true})}catch(_){}}
})().catch(e=>{console.error(e);process.exitCode=1});
