'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),p=require('node:path'),crypto=require('node:crypto');
const {plan,sync}=require('./predecessor-chat-library.js'),{ROOT,TOP}=require('./predecessor-library.js');
const raw={format:'gal-predecessor-chat',version:1,canonical:false,fidelity:'rendered-dom',status:'completed',runId:'run',title:'測試前輩',chatId:'abc',sourceUrl:'https://chatgpt.com/c/abc',startedAt:'2026-11-25T00:00:00Z',finishedAt:'2026-11-25T00:01:00Z',count:1,rows:[{id:'m1',index:0,role:'user',text:'劇情原文不複製',identityBasis:'turn-key',structure:[],attachments:[]}],warnings:[],error:null,evidence:{bottomReached:true,topReached:true,bottomStableMs:3100,topStableMs:8500,continuity:true,firstId:'m1',lastId:'m1'}};
test('private Drive archive preserves exact bytes and writes only source references to categories',()=>{
 const bytes=Buffer.from(JSON.stringify(raw)),h=crypto.createHash('sha256').update(bytes).digest('hex'),cls=Buffer.from(JSON.stringify({format:'gal-predecessor-classification',version:1,chatId:'abc',sourceSha256:h,items:[{id:'i',title:'茶話會',category:'茶話會',messageIds:['m1']}]}));
 const r=plan(bytes,cls);assert.ok(r.files.get(r.info.rawPath).equals(bytes));const ref=[...r.files].find(([k])=>k.startsWith('05・前輩們の茶話會/'));assert.ok(ref);assert.match(ref[1].toString(),/m1/);assert.doesNotMatch(ref[1].toString(),/劇情原文不複製/);
 const dir=fs.mkdtempSync(p.join(os.tmpdir(),'pred-chat-')),root=p.join(dir,ROOT);
 try{fs.mkdirSync(root);for(const d of [...TOP,'07・前輩原始聊天'])fs.mkdirSync(p.join(root,d));assert.ok(sync(root,r).newFiles>0);sync(root,r,true);assert.equal(sync(root,r,true).newFiles,0);fs.writeFileSync(p.join(root,r.info.rawPath),'不同');assert.throws(()=>sync(root,r,true),/拒絕覆蓋/)}finally{fs.rmSync(dir,{recursive:true,force:true})}
 assert.throws(()=>plan(bytes,Buffer.from(JSON.stringify({...JSON.parse(cls),sourceSha256:'0'.repeat(64)}))));
});
