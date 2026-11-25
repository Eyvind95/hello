/* Extension-local checkpoint memory. No cloud upload. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GalCheckpointMemory=api})(globalThis,()=>{
'use strict';
const MAX=100*1024*1024, CHUNK_MAX=1024*1024, PARTS_MAX=4096;
const key=(source,slot='pinned')=>'ga-predecessor-checkpoint:'+new URL(source).pathname.replace(/\/$/,'')+':'+slot;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
async function decode(bytes,source,core,expected){
 if(bytes.byteLength>MAX)throw Error('斷點超過100MiB');
 const hash=await digest(bytes);
 if(expected!==undefined&&(!/^[a-f0-9]{64}$/.test(expected)||hash!==expected))throw Error('斷點 SHA-256 不符');
 const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 const data=JSON.parse(raw.replace(/^\uFEFF/,''));
 core.validateCheckpoint(data,source);
 return {data,hash,raw};
}
async function read(storage,source,core,slot='pinned'){
 const k=key(source,slot),record=(await storage.get(k))[k];
 if(!record)return null;
 if(typeof record.raw!=='string'||typeof record.hash!=='string')throw Error('本機保全記憶損毀');
 return decode(new TextEncoder().encode(record.raw),source,core,record.hash);
}
async function save(storage,bytes,source,core,expected,automatic=false){
 const checkpoint=await decode(bytes,source,core,expected);
 const pinned=await read(storage,source,core);
 let slot='pinned';
 if(automatic){
  if(pinned&&checkpoint.data.count<=pinned.data.count)return {slot:'pinned',count:pinned.data.count,hash:pinned.hash,unchanged:true};
  // A larger candidate never replaces the explicitly chosen baseline.
  slot='candidate';
  const candidate=await read(storage,source,core,slot);
  if(candidate&&checkpoint.data.count<=candidate.data.count)return {slot,count:candidate.data.count,hash:candidate.hash,unchanged:true};
 }
 const k=key(source,slot);
 await storage.set({[k]:{raw:checkpoint.raw,hash:checkpoint.hash,count:checkpoint.data.count,runId:checkpoint.data.runId}});
 return {slot,count:checkpoint.data.count,hash:checkpoint.hash,runId:checkpoint.data.runId};
}
// GA1 parts are decoded separately so the Windows clipboard never needs the
// whole file. Nothing is saved before all parts and the original hash agree.
function createReceiver(){
 let parts=[],length=0,total=0;
 const status=()=>({received:parts.length,total,bytes:length,ready:total>0&&parts.length===total});
 function append(text){
  if(typeof text!=='string'||text.length>Math.ceil(CHUNK_MAX/3)*4+80)throw Error('單段過大');
  const m=/^GA1 ([1-9][0-9]{0,3})\/([1-9][0-9]{0,3})\r?\n([A-Za-z0-9+/]+={0,2})$/.exec(text.trim());
  if(!m)throw Error('不是 GA1 本機保全分段');
  const index=Number(m[1]),n=Number(m[2]),encoded=m[3];
  if(n>PARTS_MAX||index>n||index!==parts.length+1||(total&&total!==n))throw Error('分段順序或總段數不符');
  if(encoded.length%4)throw Error('Base64 格式不符');
  const bin=atob(encoded);
  if(btoa(bin)!==encoded)throw Error('Base64 非標準編碼');
  if(!bin.length||bin.length>CHUNK_MAX||length+bin.length>MAX)throw Error('保全資料超過容量限制');
  const bytes=Uint8Array.from(bin,x=>x.charCodeAt(0));
  parts.push(bytes);length+=bytes.length;total=n;
  return status();
 }
 function bytes(){
  if(!status().ready)throw Error('分段尚未齊全');
  const out=new Uint8Array(length);let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length}
  return out;
 }
 function reset(){parts=[];length=0;total=0;return status()}
 return {append,bytes,reset,status};
}
// Only an unpacked extension's own private directory; no host permission,
// no web-accessible resources and no caller-provided URL or file path.
async function importInstalled(storage,runtime,source,core,expected,fetcher=fetch){
 if(!/^[a-f0-9]{64}$/.test(expected))throw Error('請輸入原始檔 SHA-256');
 const chatId=core.sourceId(source);
 const relative='local-checkpoints/'+chatId+'.json';
 const url=runtime.getURL(relative);
 const parsed=new URL(url);
 if(parsed.protocol!=='chrome-extension:'||parsed.hostname!==runtime.id||!(/^[a-p]{32}$/.test(runtime.id))||parsed.pathname!=='/'+relative||parsed.search||parsed.hash)throw Error('本機保全路徑不符');
 const existing=await read(storage,source,core);
 if(existing&&existing.hash===expected)return {slot:'pinned',count:existing.data.count,hash:existing.hash,runId:existing.data.runId,unchanged:true,readback:true};
 let response;
 try{response=await fetcher(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)})}
 catch(_){throw Error('無法讀取安裝目錄保全檔，請確認 local-checkpoints/'+chatId+'.json 存在')}
 if(!response.ok||!response.body)throw Error('安裝目錄保全檔無法讀取：HTTP '+response.status);
 if(Number(response.headers.get('content-length'))>MAX)throw Error('斷點超過100MiB');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX)throw Error('斷點超過100MiB');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 if(await digest(bytes)!==expected)throw Error('安裝目錄保全 SHA-256 不符');
 let checked;try{checked=await decode(bytes,source,core,expected)}catch(_){throw Error('安裝目錄保全未通過原斷點格式或來源驗收')}
 const saved=await save(storage,bytes,source,core,expected);
 const verified=await read(storage,source,core);
 if(!verified||verified.hash!==expected||verified.data.runId!==checked.data.runId||verified.data.count!==checked.data.count)throw Error('本機保全回讀核對失敗');
 return {...saved,readback:true};
}
return {MAX,CHUNK_MAX,PARTS_MAX,key,digest,decode,read,save,createReceiver,importInstalled};
});