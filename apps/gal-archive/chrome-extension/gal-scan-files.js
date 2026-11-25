'use strict';
const scanFileUrls=new Set(), transfers=new Map();
const WIRE_CHARS=256*1024,MAX=256*1024*1024;
async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('')}
async function transfer(message){
 const {type,token}=message;
 if(typeof token!=='string'||!/^[a-f0-9-]{36}$/i.test(token))throw Error('分段識別碼無效');
 if(type==='gal-run-blob-begin'){
  const {length,count,sha256}=message;
  if(!Number.isInteger(length)||length<=0||length>MAX||count!==Math.ceil(length/WIRE_CHARS)||!/^[a-f0-9]{64}$/.test(sha256))throw Error('分段描述不合法');
  const existing=transfers.get(token);
  if(existing){
   if(existing.length!==length||existing.count!==count||existing.sha256!==sha256)throw Error('分段描述衝突');
   return {ok:true};
  }
  const entry={length,count,sha256,pieces:new Map(),url:null};
  transfers.set(token,entry);
  setTimeout(()=>{if(transfers.get(token)===entry)transfers.delete(token)},15*60*1000);
  return {ok:true};
 }
 const entry=transfers.get(token);
 if(type==='gal-run-blob-abort'){transfers.delete(token);return {ok:true}}
 if(!entry)throw Error('分段工作不存在，需重新提交');
 if(type==='gal-run-blob-chunk'){
  const {index,text}=message;
  if(!Number.isInteger(index)||index<0||index>=entry.count||typeof text!=='string'||
     text.length!==Math.min(WIRE_CHARS,entry.length-index*WIRE_CHARS))throw Error('分段大小或序號不符');
  if(entry.pieces.has(index)&&entry.pieces.get(index)!==text)throw Error('重複分段內容不一致');
  entry.pieces.set(index,text);return {ok:true};
 }
 if(type==='gal-run-blob-end'){
  if(entry.url)return {ok:true,url:entry.url};
  if(entry.pieces.size!==entry.count)throw Error('分段未收齊');
  const text=Array.from({length:entry.count},(_,i)=>entry.pieces.get(i)).join('');
  if(await hash(text)!==entry.sha256)throw Error('分段SHA-256不符');
  entry.url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
  scanFileUrls.add(entry.url);return {ok:true,url:entry.url};
 }
 throw Error('未知分段指令');
}

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.tab||(sender.url&&sender.url!==chrome.runtime.getURL('background.js')))return;
 if(['gal-run-blob-begin','gal-run-blob-chunk','gal-run-blob-end','gal-run-blob-abort'].includes(message.type)){
  transfer(message).then(reply,error=>reply({ok:false,error:String(error.message||error)}));
  return true;
 }
 if(message.type==='gal-run-blob-create'){
  const url=URL.createObjectURL(new Blob([message.text],{type:'application/json;charset=utf-8'}));
  scanFileUrls.add(url);
  reply(url);
 }else if(message.type==='gal-run-blob-release'&&scanFileUrls.delete(message.url)){
  URL.revokeObjectURL(message.url);
  reply(true);
 }
});