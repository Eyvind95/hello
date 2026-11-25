#!/usr/bin/env node
'use strict';
// Read-only source files -> append-only predecessor chat repository on private Drive.
const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto');
const {TextDecoder}=require('node:util'),c=require('../chrome-extension/predecessor-chat-core.js');
const {ROOT}=require('./predecessor-library.js');
const TOP='07・前輩原始聊天',INDEX='00・全館索引與共用守則';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const assert=(v,m)=>{if(!v)throw Error(m)};
const safe=x=>String(x).replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').replace(/[. ]+$/u,'').slice(0,80)||'未命名';
function plan(rawBytes,classBytes=null){
 const raw=JSON.parse(decode(rawBytes)),rawHash=sha(rawBytes);c.validateRaw(raw);
 const root=TOP+'/聊天-'+raw.chatId,revision=root+'/原始-'+rawHash,files=new Map(),name=safe(raw.title);
 files.set(revision+'/原始聊天.json',rawBytes);
 const info={chatId:raw.chatId,title:raw.title,status:raw.status,count:raw.count,sourceUrl:raw.sourceUrl,sourceSha256:rawHash,finishedAt:raw.finishedAt,rawPath:revision+'/原始聊天.json',canonical:false};
 files.set(revision+'/閱讀索引.json',Buffer.from(JSON.stringify(info,null,2)+'\n'));
 files.set(INDEX+'/聊天索引/'+raw.chatId+'_'+rawHash+'.md',Buffer.from('# '+name+'\n\n'+JSON.stringify(info,null,2)+'\n'));
 if(classBytes){
  const cls=JSON.parse(decode(classBytes)),result=c.validateClassification(raw,cls,rawHash),hash=sha(classBytes),dir=revision+'/分類-'+hash;
  files.set(dir+'/分類.json',classBytes);
  const groups=new Map();for(const item of cls.items){const a=groups.get(item.category)||[];a.push({id:item.id,title:item.title,messageIds:item.messageIds,note:item.note||''});groups.set(item.category,a)}
  for(const [cat,items] of groups){
   const ref={category:cat,chatId:raw.chatId,title:raw.title,sourceSha256:rawHash,rawPath:info.rawPath,classificationPath:dir+'/分類.json',items};
   // Place only references into category indexes, never duplicated Gal AI text.
   files.set(dir+'/'+safe(cat)+'.json',Buffer.from(JSON.stringify(ref,null,2)+'\n'));
   const target={'交接稿':'04・歷代前輩交接稿','茶話會':'05・前輩們の茶話會','評語與自評':'04・歷代前輩交接稿','稱號與事故':'06・前輩個人檔案','規則與設定':INDEX,'輪迴補充':INDEX}[cat];
   if(target)files.set(target+'/聊天分類索引/'+raw.chatId+'_'+hash+'_'+safe(cat)+'.json',Buffer.from(JSON.stringify(ref,null,2)+'\n'));
  }
  info.classification={hash,items:result.items,covered:result.covered,total:result.total,path:dir};
 }
 return {info,files};
}
function inside(root,rel){let q=root;for(const x of rel.split('/')){assert(x&&x!=='.'&&x!=='..'&&!x.includes('\\'),'不安全路徑');q=p.join(q,x);if(fs.existsSync(q))assert(!fs.lstatSync(q).isSymbolicLink(),'禁止連結路徑：'+rel)}return q}
function sync(root,planned,apply=false){
 root=p.resolve(root);assert(p.basename(root)===ROOT&&fs.existsSync(root)&&fs.statSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink(),'目的地不是私人前輩記憶館');
 for(const t of [TOP,INDEX,'04・歷代前輩交接稿','05・前輩們の茶話會','06・前輩個人檔案'])assert(fs.statSync(inside(root,t)).isDirectory(),'缺少雲端分類目錄：'+t);
 let changed=0;
 const missing=[];
 for(const [rel,bytes] of planned.files){const target=inside(root,rel);if(fs.existsSync(target)){assert(fs.statSync(target).isFile()&&sha(fs.readFileSync(target))===sha(bytes),'既有檔案內容衝突，拒絕覆蓋：'+rel)}else{missing.push([rel,bytes]);changed++}}
 if(apply)for(const [rel,bytes] of missing){
  const target=inside(root,rel);fs.mkdirSync(p.dirname(target),{recursive:true});
  // Exclusive creation never overwrites another revision or manual content.
  try{fs.writeFileSync(target,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST'||!fs.readFileSync(target).equals(bytes))throw e}
  assert(fs.readFileSync(target).equals(bytes),'寫後驗證不符：'+rel);
 }
 return {...planned.info,newFiles:changed,unchangedFiles:planned.files.size-changed,mode:apply?'apply':'dry-run'};
}
module.exports={plan,sync};
if(require.main===module)try{
 const [raw,root,...rest]=process.argv.slice(2),flags=rest.filter(s=>s.startsWith('--')),extra=rest.filter(s=>!s.startsWith('--'));
 assert(raw&&root&&extra.length<=1&&flags.length<=1&&flags.every(s=>['--apply','--dry-run'].includes(s)),'用法：node predecessor-chat-library.js <原始聊天.json> <私人記憶館目錄> [分類.json] [--apply|--dry-run]');
 console.log(JSON.stringify(sync(root,plan(fs.readFileSync(raw),extra.length?fs.readFileSync(extra[0]):null),flags.includes('--apply')),null,2));
}catch(e){console.error('⛔ '+e.message);process.exitCode=1}
