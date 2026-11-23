'use strict';
const scanFileUrls=new Set();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.tab||(sender.url&&sender.url!==chrome.runtime.getURL('background.js')))return;
 if(message.type==='gal-run-blob-create'){
  const url=URL.createObjectURL(new Blob([message.text],{type:'application/json;charset=utf-8'}));
  scanFileUrls.add(url);
  reply(url);
 }else if(message.type==='gal-run-blob-release'&&scanFileUrls.delete(message.url)){
  URL.revokeObjectURL(message.url);
  reply(true);
 }
});