'use strict';
(()=>{
 const $=id=>document.getElementById(id),pc=globalThis.GalPredecessorChat,mem=globalThis.GalCheckpointMemory;
 const params=new URLSearchParams(location.search),source=params.get('source')||'',expected=params.get('sha256')||'';
 const area=$('chunk'),save=$('save'),reset=$('reset'),result=$('result'),progress=$('progress'),receiver=mem.createReceiver();
 let busy=false,done=false;
 $('source').textContent=source;$('hash').textContent=expected;
 function draw(){
  const s=receiver.status();progress.textContent='已接收 '+s.received+' / '+(s.total||'？')+' 段｜'+s.bytes+' bytes';
  save.disabled=busy||done||!s.ready;reset.disabled=busy||done;area.disabled=busy||done||s.ready;
 }
 try{pc.sourceId(source);if(!/^[a-f0-9]{64}$/.test(expected))throw Error('預期 SHA-256 不符')}
 catch(e){result.textContent='⛔ '+String(e.message||e);area.disabled=true;save.disabled=true;reset.disabled=true;return}
 area.addEventListener('paste',e=>{
  e.preventDefault();if(busy||done)return;
  try{receiver.append(e.clipboardData.getData('text/plain'));result.textContent='分段已接收'}
  catch(err){result.textContent='⛔ '+String(err.message||err)}
  finally{area.value='';draw()}
 });
 // Also support browser automation inserting text rather than a native paste.
 area.addEventListener('input',()=>{
  if(busy||done){area.value='';return}
  try{receiver.append(area.value);result.textContent='分段已接收'}
  catch(err){result.textContent='⛔ '+String(err.message||err)}
  finally{area.value='';draw()}
 });
 reset.onclick=()=>{if(busy||done)return;receiver.reset();area.value='';result.textContent='未保存資料已清空';draw();area.focus()};
 save.onclick=async()=>{
  if(busy||done||!receiver.status().ready)return;
  busy=true;draw();result.textContent='正在核對完整原檔及聊天來源…';
  try{
   const saved=await mem.save(chrome.storage.local,receiver.bytes(),source,pc,expected);
   const verified=await mem.read(chrome.storage.local,source,pc);
   if(!verified||verified.hash!==expected||verified.data.runId!==saved.runId||verified.data.count!==saved.count)throw Error('本機保存回讀不符');
   done=true;receiver.reset();area.value='';
   result.textContent='已記住 '+saved.count+' 則\n批次：'+saved.runId+'\nSHA-256：'+saved.hash+'\n已回讀核對；未啟動掃描。';
  }catch(e){result.textContent='⛔ '+String(e.message||e)}
  finally{busy=false;draw()}
 };
 draw();
})();