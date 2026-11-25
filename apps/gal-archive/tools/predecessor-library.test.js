'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),p=require('node:path');
const {plan,parseGab,sync,ROOT,TOP}=require('./predecessor-library.js');
function pack(magic,meta,bodies){const j=Buffer.from(JSON.stringify(meta));return Buffer.concat([Buffer.from(magic+String(j.length).padStart(12,'0')),j,...bodies])}
function fixture(at='2026-11-25T00:00:00.000Z',extra=''){
 const worlds=['sentinel','adventure','road'].map(id=>({id,text:'設定 '+id}));
 const cycles=worlds.map((w,i)=>({id:'cycle-'+i,world:w.id,title:'第01輪迴',hero:'測試',managerNames:['測試前輩'],opening:'開場',messages:[{id:'m1',role:'me',text:'{{玩家指令}}'+extra},{id:'m2',role:'ai',text:'原文\n'+ '長'.repeat(34000)}],events:[{id:'e1',status:'accepted',text:'已接',storyPlacement:{beforeId:'m2'}},{id:'e2',status:'pending',text:'未接'},{id:'e3',status:'accepted',text:'未定位'}],pilotMessages:[{id:'p1',role:'ai',manager:'測試前輩',text:'副駕駛'}]}));
 const archive=Buffer.from(JSON.stringify({format:'gal-ai-archive',version:8,exportedAt:at,worlds,cycles}));
 const bin=Buffer.from([0,1,255,7]);
 const thread={id:'t1',worldId:'adventure',title:'測試交接',author:'測試前輩'};
 const h=pack('GAL-ARCHIVE-HANDOVER-V3\n',{format:'gal-ai-handover-backup',version:4,worldId:'adventure',conversations:[{thread,entries:[{id:'a',kind:'file',name:'../../CON.pdf',size:4,byteOffset:0,byteLength:4},{id:'b',kind:'self-review',text:'自評'}]}],worldReviews:[{id:'r1',kind:'review',text:'共用評語'}]},[bin]);
 return pack('GAL-ARCHIVE-COMPLETE-V1\n',{format:'gal-ai-archive-complete',version:1,createdAt:at,segments:[{kind:'archive',offset:0,bytes:archive.length},{kind:'handover',worldId:'adventure',offset:archive.length,bytes:h.length,threads:1,files:1}]},[archive,h]);
}
test('extracts worlds, exact originals, binary files, distinct reading sections and explicit event placement',()=>{
 const b=fixture(),r=plan(b);assert.equal(r.meta.cycles.length,3);assert.equal(new Set(r.meta.cycles.map(x=>x.path)).size,3);
 assert.ok(r.files.get(r.meta.rawPath).equals(b));const c=r.meta.cycles[0],raw=JSON.parse(r.files.get(c.path+'/01・輪迴原始資料.json'));assert.equal(raw.messages[0].text,'{{玩家指令}}');
 const all=(label)=>[...r.files].filter(([k])=>k.startsWith(c.path+'/'+label+'/')).map(([,v])=>v.toString()).join('');
 assert.ok(all('02・完整劇情原始對話').includes('長'.repeat(34000)));assert.match(all('03・副駕駛聊天'),/副駕駛/);
 assert.ok(all('02b・已證明定位的劇情閱讀順序').indexOf('已接')<all('02b・已證明定位的劇情閱讀順序').indexOf('原文'));
 assert.doesNotMatch(all('02b・已證明定位的劇情閱讀順序'),/\n未接\n|\n未定位\n/);
 assert.match(all('06・事件簿'),/未定位/);
 const attachment=[...r.files].find(([k])=>k.includes('/附件/'));assert.ok(attachment[1].equals(Buffer.from([0,1,255,7])));assert.ok(!attachment[0].includes('../'));assert.ok(attachment[0].endsWith('.pdf'));
 assert.ok(r.meta.people.includes('測試前輩'));assert.equal(r.meta.threads.length,1);
});
test('dry run is read only, repeat apply is idempotent, changed data is append-only, old backup cannot replace latest',()=>{
 const tmp=fs.mkdtempSync(p.join(os.tmpdir(),'gal-library-')),root=p.join(tmp,ROOT);
 try{
  fs.mkdirSync(root);for(const d of TOP)fs.mkdirSync(p.join(root,d));
  const first=plan(fixture()),old=sync(root,first);assert.ok(old.newFiles>0);assert.equal(fs.readdirSync(p.join(root,TOP[0])).length,0);
  sync(root,first,true);assert.equal(sync(root,first,true).newFiles,0);
  const next=plan(fixture('2026-11-26T00:00:00.000Z','變更'));sync(root,next,true);
  const latest=p.join(root,TOP[0],'最新匯出索引.md'),before=fs.readFileSync(latest);assert.equal(sync(root,first,true).latest,'older-history-only');assert.ok(fs.readFileSync(latest).equals(before));assert.ok(fs.existsSync(p.join(root,first.meta.rawPath)));
  fs.writeFileSync(p.join(root,first.meta.cycles[0].path,'05・彩蛋.txt'),'人工修改');
  assert.throws(()=>sync(root,first,true),/禁止覆蓋/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
test('truncated data and incorrect manifest cannot be classified as complete',()=>{
 const b=fixture();assert.throws(()=>parseGab(b.subarray(0,b.length-1)));assert.throws(()=>parseGab(Buffer.from('not gab')));
});

test('reading volume names carry world cycle hero kind and exact ordinal range',()=>{
 const r=plan(fixture()),expected=['哨嚮','冒險者','公路求生'];
 for(const [i,c] of r.meta.cycles.entries()){
  const prefix=expected[i]+'｜第01輪迴・測試｜';
  const names=[...r.files.keys()].filter(k=>k.startsWith(c.path+'/')&&/\/\d+[^/]*\.txt$/.test(k));
  assert.ok(names.some(k=>k.endsWith(prefix+'完整劇情｜001_00001-00001.txt')));
  assert.ok(names.some(k=>k.endsWith(prefix+'含事件閱讀版｜001_00001-00002.txt')));
  assert.ok(names.some(k=>k.includes(prefix+'副駕駛聊天｜')));
  assert.ok(names.some(k=>k.includes(prefix+'事件簿｜')));
 }
 assert.equal(r.meta.namingVersion,2);assert.ok(r.idx.endsWith('-命名v2'));
});
test('existing renamed volume reused byte-exact without changing names or creating duplicate',()=>{
 const tmp=fs.mkdtempSync(p.join(os.tmpdir(),'gal-library-')),root=p.join(tmp,ROOT);
 try{
  fs.mkdirSync(root);for(const d of TOP)fs.mkdirSync(p.join(root,d));
  const r=plan(fixture()),rel=[...r.volumePaths].find(k=>k.includes('完整劇情｜001_'));
  const legacy=rel.slice(0,rel.lastIndexOf('/')+1)+'人工已改名.txt';
  const f=p.join(root,legacy);fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,r.files.get(rel));
  sync(root,r,true);assert.ok(fs.existsSync(f));assert.ok(!fs.existsSync(p.join(root,rel)));
  const index=JSON.parse(fs.readFileSync(p.join(root,r.idx+'.json'),'utf8'));assert.ok(index.inventory.some(x=>x.path===legacy));assert.ok(!index.inventory.some(x=>x.path===rel));
  assert.equal(sync(root,r,true).newFiles,0);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
