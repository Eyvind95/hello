'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
const start=source.indexOf('function bindingStateIssue(');
const end=source.indexOf('\nasync function fetchCurrentBinding(',start);
assert.ok(start>0&&end>start,'binding guard must remain available');
const context=vm.createContext({});
vm.runInContext(source.slice(start,end)+'\nthis.bindingStateIssue=bindingStateIssue;',context);
const issue=context.bindingStateIssue;
const url='https://www.whif.io/chat/chat-B';
const old={cycleId:'cycle-A',cycleTitle:'第13輪迴'};
const bound={cycleId:'cycle-B',cycleTitle:'第14輪迴',worldName:'《全員精神穩定，感情除外》'};
test('correct page binding authorizes the intended cycle',()=>{
 assert.equal(issue(bound,{ok:true,source:url,profile:bound},url),'');
});
test('stale scanner panel is blocked instead of silently redirecting to another cycle',()=>{
 const message=issue(old,{ok:true,source:url,profile:bound},url);
 assert.match(message,/第13輪迴/);
 assert.match(message,/第14輪迴/);
 assert.match(message,/重新讀取目前綁定/);
});
test('unbound WHIF page cannot scan even with an old target',()=>{
 const message=issue(old,{ok:true,source:url,profile:null},url);
 assert.match(message,/尚未儲存輪迴綁定/);
});
test('URL disagreement aborts before choosing a cycle',()=>{
 const message=issue(bound,{ok:true,source:'https://www.whif.io/chat/chat-A',profile:bound},url);
 assert.match(message,/網址正在切換/);
});
test('failed binding-state request does not bypass scan guard',()=>{
 assert.match(issue(bound,{ok:false,error:'連線中斷'},url),/連線中斷/);
});
test('explicitly refreshing binding updates target without starting scan',()=>{
 const match=source.match(/async function refreshBoundTarget\(\)\{([\s\S]*?)\n\}\nfunction mount/);
 assert.ok(match);
 assert.match(match[1],/await fetchCurrentBinding\(\)/);
 assert.match(match[1],/target=\{/);
 assert.doesNotMatch(match[1],/\bscan\s*\(/);
});
test('full and event preview scans verify binding before any page content scan',()=>{
 assert.match(source,/if\(managed\)\{\s*await fetchCurrentBinding\(profile\);\s*const response=await chrome.runtime.sendMessage\(\{type:'gal-run-start'/);
 assert.match(source,/await fetchCurrentBinding\(profile\);\s*const response=await chrome.runtime.sendMessage\(\{type:'gal-run-start'/);\n assert.match(source,/run.batchFolder=response.status\?\.batchFolder;registered=true;activeRun=run;\s*const shot=snapshot\(null,'auto',false,true\)/);
});
