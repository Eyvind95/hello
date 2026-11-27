// Standard Playwright runner for synthetic, isolated, real IndexedDB tests.
const {createServer}=require('node:http'),{readFileSync}=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const files=['archive-pilot-import.js','archive-pilot-revision.js','archive-pilot-revision-idb.js','archive-pilot-revision-browser.js'];
const server=createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8">'+files.map(f=>'<script src="/'+f+'"></script>').join(''))}
 const f=req.url.slice(1);if(!files.includes(f)){res.statusCode=404;return res.end()}
 res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(readFileSync(path.join(__dirname,f)));
});
(async()=>{
 let browser;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
  const page=await browser.newPage();
  page.on('pageerror',e=>console.error('Browser page error:',e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>globalThis.revisionBrowserResult!==undefined,{},{timeout:60000});
  const result=await page.evaluate(()=>globalThis.revisionBrowserResult);
  assert.ok(result?.ok,JSON.stringify(result));console.log(JSON.stringify(result,null,2));
 }finally{await browser?.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
