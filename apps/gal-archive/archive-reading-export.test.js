'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),p=require('node:path'),c=require('./archive-reading-export');
const fixture=()=>({id:'cycle-1',world:'road',title:'第1輪迴',hero:'燃冰',messages:[{id:'1',role:'me',text:'玩家'},{id:'2',role:'ai',text:'長'.repeat(34000)}],events:[{id:'e',status:'accepted',text:'已接事件',storyPlacement:{beforeId:'2'}},{id:'e2',status:'accepted',text:'未定位'}],pilotMessages:[]});
test('reading ZIP names and boundaries match library conventions',()=>{
 const f=fixture(),before=JSON.stringify(f),files=c.plan([f],[{id:'road',name:'公路求生'}]);const names=[...files.keys()];
 a.ok(names.some(k=>k.endsWith('公路求生｜第01輪迴・燃冰｜完整劇情｜001_00001-00001.txt')));
 a.ok(names.some(k=>k.endsWith('公路求生｜第01輪迴・燃冰｜完整劇情｜002_00002-00002.txt')));
 const joined=names.filter(k=>k.includes('含事件閱讀版｜')).map(k=>Buffer.from(files.get(k)).toString()).join('');
 const player=joined.indexOf('\n玩家\n'),event=joined.indexOf('\n已接事件\n');a.ok(player>=0&&event>player);a.doesNotMatch(joined,/\n未定位\n/);
 const index=JSON.parse(Buffer.from(files.get('00・閱讀索引.json')));a.deepEqual(index.cycles[0].unplacedAcceptedEventIndexes,[2]);a.equal(JSON.stringify(f),before);a.equal(index.canonical,false);
 a.throws(()=>c.plan([f,f],[]),/重複/);
});
test('ZIP UTF-8 filenames, CRC32, central directory and exact content',async()=>{
 const files=c.plan([fixture()],[]),b=Buffer.from(await c.zip(files).arrayBuffer());let at=0;
 for(const [name,bytes] of files){
  a.equal(b.readUInt32LE(at),0x04034b50);a.equal(b.readUInt16LE(at+6),0x800);
  const len=b.readUInt16LE(at+26),size=b.readUInt32LE(at+18);a.equal(b.subarray(at+30,at+30+len).toString(),name);
  a.equal(b.readUInt32LE(at+14),c.crc32(bytes));a.deepEqual(b.subarray(at+30+len,at+30+len+size),Buffer.from(bytes));at+=30+len+size;
 }
 a.equal(b.readUInt32LE(at),0x02014b50);a.equal(b.readUInt32LE(b.length-22),0x06054b50);a.equal(b.readUInt16LE(b.length-12),files.size);a.equal(b.readUInt32LE(b.length-6),at);
 a.equal(c.crc32(Buffer.from('123456789')),0xcbf43926);
});
test('website entry, standalone HTML and PWA include reading exporter',()=>{
 const html=fs.readFileSync(p.join(__dirname,'index.html'),'utf8'),sw=fs.readFileSync(p.join(__dirname,'sw.js'),'utf8');
 a.match(html,/id="readingZipBtn"/);a.match(html,/ArchiveReadingExport\.plan\(cycles,WORLDS\)/);a.match(html,/downloadReadingZip\(records,/);a.match(html,/downloadReadingZip\(\[r\],b\)/);a.match(html,/ArchiveReadingExport\.cycleReadingName/);a.ok(html.includes("'archive-reading-export.js?v=1'"));a.ok(sw.includes('archive-reading-export.js?v=1'));const version=html.match(/<title>輪迴檔案館 (V\d+\.\d+)/)?.[1],manifest=JSON.parse(fs.readFileSync(p.join(__dirname,'chrome-extension/manifest.json'),'utf8'));a.ok(version);a.ok(html.includes('<h1>輪迴檔案館 '+version+'</h1>'));a.ok(html.includes('gal-archive-chrome-v'+manifest.version+'.zip'));
});

test('three known world names and identical cycle titles remain separated',()=>{
 const worlds=['sentinel','adventure','road'].map((id,i)=>({id,name:['全員精神穩定，感情除外','身為冒險者就可以這樣那樣','公路求生'][i]}));
 const cycles=worlds.map((w,i)=>({...fixture(),id:'cycle-'+i,world:w.id}));
 const names=[...c.plan(cycles,worlds).keys()];
 for(const w of ['哨嚮','冒險者','公路求生'])a.ok(names.some(k=>k.startsWith(w+'/')&&k.includes(w+'｜第01輪迴・燃冰｜完整劇情｜')));
});
