'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const audit=require('./gal-format-evidence.js');
require('./gal-core.js');
const core=globalThis.GalArchiveCore;
const row=(role,text,id,sourceText,eventType=null)=>({
 role,text,eventType,
 formatSource:id?{nativeReply:{
  reason:'available',markerCount:1,messageId:id,scannedText:text,text:sourceText
 }}:undefined
});
test('format failure after successful integrity retains entire native/DOM story and adjacent messages, ID, marker offsets and time',()=>{
 const opener=row('ai','開場完整正文。','open-001','開場完整正文。');
 const previous=row('me','我：「繼續。」');
 const event=row('ai','事件開始。\n｜2026年8月23日｜\n｜🕒08:15｜\n正文狀態。','event-067',
  '事件開始。\n｜2026年8月23日｜\n｜🕒08:15｜\n{{post-context}}\n正文「狀態」。','event');
 const after=row('me','下一則玩家繼續。');
 const r=[opener,previous,event,after];
 const complete=audit.summarize(r,[
  {check:{scanIndex:0,reason:'source-matched-no-change',source:'whif-message-content'}},
  {check:{scanIndex:2,reason:'content-mismatch',source:'rendered-dom',
   comparison:{contentEqual:false,clockEqual:true}}}
 ],core,true);
 assert.equal(complete.integrityOk,true);
 assert.equal(complete.nativeFormatComplete,false);
 assert.equal(complete.checkedNativeRows,2);
 assert.equal(complete.verifiedNativeRows,1);
 assert.equal(complete.failedNativeRows,1);
 const e=complete.failures[0];
 assert.equal(e.scanIndex,2);assert.equal(e.sourceMessageId,'event-067');
 assert.equal(e.originalDomText,event.text);
 assert.equal(e.originalNativeText,event.formatSource.nativeReply.text);
 assert.equal(e.time.scanned.iso,e.time.native.iso);
 assert.ok(e.nativeFormatMarkers.some(x=>x.kind==='template'&&x.utf16Offset>0));
 assert.ok(e.nativeFormatMarkers.some(x=>x.kind==='chinese-open-quote'));
 assert.equal(e.neighborhood.length,3);
 assert.equal(e.neighborhood[0].domText,previous.text);
 assert.equal(e.neighborhood[2].domText,after.text);
});
test('only all independently verified native formats can be marked complete',()=>{
 const rows=[row('ai','開場完整內容。','opening','開場完整內容。'),row('me','我繼續。'),
 row('ai','普通 AI 完整內容。','ai-one','普通 AI 完整內容。')];
 const complete=audit.summarize(rows,[0,2].map(scanIndex=>({
  check:{scanIndex,reason:'source-matched-no-change',source:'whif-message-content'}
 })),core,true);
 assert.equal(complete.nativeFormatComplete,true);
 const missing=audit.summarize(rows,[{check:{scanIndex:2,
  reason:'source-matched-no-change',source:'whif-message-content'}}],core,true);
 assert.equal(missing.nativeFormatComplete,false);
 assert.equal(missing.failures[0].scanIndex,0);
});
test('unverified native format cannot turn successful structural check into canonical export',()=>{
 const content=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
 const bg=fs.readFileSync(require.resolve('./background.js'),'utf8');
 assert.match(bg,/files:\['gal-core\.js','gal-format-evidence\.js','gal-content\.js'\]/);
 assert.match(content,/nativeFormatAudit\.nativeFormatComplete\)\{\s*const failed=/);
 assert.match(content,/lastResult=null;exportButton\.disabled=true/);
 assert.match(content,/nativeFormatAudit\.failures/);
 assert.match(content,/if\(lastResult\?\.validation\?\.ok&&lastResult\.validation\.nativeFormatComplete===true\)/);
 assert.match(content,/requireFormatEvidence\(\)\.inspectRaw\(/);
 assert.match(content,/validationPhases:\{integrity:/);
});
test('failed structural check still generates full original native-format diagnostics, even for wrong source IDs',()=>{
 const rows=[
 row('ai','開場完整內容。','same','開場完整內容。'),
 row('me','玩家內容。'),
 row('ai','故事正文。','same','故事正文。'),
 row('ai','沒有原生資料。')
 ];
 const result=audit.inspectRaw(rows,core,false);
 assert.equal(result.integrityOk,false);
 assert.equal(result.nativeFormatComplete,false);
 assert.equal(result.failedNativeRows>=3,true);
 assert.ok(result.failures.some(x=>x.sourceMessageId==='same'));
 assert.ok(result.failures.some(x=>x.originalNativeText===null));
 assert.ok(result.failures.some(x=>x.neighborhood.length>=2));
});
test('sensitive content is not sent to GitHub, evidence is kept in local JSON only',()=>{
 const x=audit.markerPositions('{{post-status}}\n「需要保留」');
 assert.equal(x[0].kind,'template');
 assert.equal(x[0].utf16Offset,0);
 assert.equal(x[1].kind,'chinese-open-quote');
 assert.equal(x[2].kind,'chinese-close-quote');
 assert.equal(x[1].nonWhitespaceOffset,x[0].nonWhitespaceLength);
});

test('both scanner launch paths load the audit before content and preflight its version',()=>{
 const vm=require('node:vm');
 const content=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
 for(const file of ['background.js','gal-popup.js']){
  const src=fs.readFileSync(require.resolve('./'+file),'utf8');
  const launches=[...src.matchAll(/files:\[([^\]]*'gal-content\.js'[^\]]*)\]/g)];
  // Scan, event, anchor recovery and no-scan tools all inject the audit before the scanner.
  assert.equal(launches.length,file==='gal-popup.js'?4:1);
  for(const m of launches)assert.match(m[1],/'gal-core\.js','gal-format-evidence\.js','gal-content\.js'/);
  assert.match(src,/formatEvidenceReady!==true/);
 }
 const first=content.indexOf('function formatEvidenceReady()');
 const end=content.indexOf('\nconst STOP=',first);
 const sandbox=vm.createContext({SCANNER_VERSION:audit.version});
 vm.runInContext(content.slice(first,end),sandbox);
 assert.equal(sandbox.formatEvidenceReady(),false);
 assert.throws(()=>sandbox.requireFormatEvidence(),/驗收模組/);
 sandbox.GalArchiveFormatEvidence={version:audit.version,summarize(){}};
 assert.equal(sandbox.formatEvidenceReady(),false);
 sandbox.GalArchiveFormatEvidence=audit;
 assert.equal(sandbox.formatEvidenceReady(),true);
 assert.equal(sandbox.requireFormatEvidence(),audit);
 assert.match(content,/phaseStatus\('failure'[\s\S]*?try\{diagnostic\.nativeFormatAudit=requireFormatEvidence\(\)\.inspectRaw\(/);
 assert.match(content,/catch\(error\)\{diagnostic\.nativeFormatAudit=\{nativeFormatComplete:false/);
});

test('both popups display the installed manifest version, not an obsolete static label',()=>{
 const vm=require('node:vm');
 const manifest=require('./manifest.json');
 for(const name of ['popup','gal-popup']){
  const html=fs.readFileSync(require.resolve('./'+name+'.html'),'utf8');
  const js=fs.readFileSync(require.resolve('./'+name+'.js'),'utf8');
  assert.match(html,/<span id="releaseVersion">版本讀取中…<\/span>/);
  assert.doesNotMatch(html,/V0\.8\.\d+\s+測試版/);
  const line=js.split('\n').find(l=>l.includes("$('releaseVersion').textContent="));
  assert.ok(line);
  for(const version of [manifest.version,'0.8.999']){
   const label={textContent:''};
   vm.runInNewContext(line,{$:id=>{assert.equal(id,'releaseVersion');return label},chrome:{runtime:{getManifest:()=>({version})}}});
   assert.equal(label.textContent,'V'+version);
  }
 }
 const content=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
 assert.ok(content.includes("Gal AI 原生正史掃描器 V'+SCANNER_VERSION+'"));
 assert.ok(content.includes("const SCANNER_VERSION='"+manifest.version+"'"));
 assert.equal(core.version,manifest.version);
 assert.equal(audit.version,manifest.version);
});
