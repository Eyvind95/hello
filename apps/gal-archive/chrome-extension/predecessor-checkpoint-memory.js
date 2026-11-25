/* Extension-local checkpoint memory. No cloud upload. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GalCheckpointMemory=api})(globalThis,()=>{
'use strict';
const MAX=100*1024*1024, ENDPOINT='http://127.0.0.1:18765/checkpoint.json';
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
 if(automatic&&pinned){
  if(checkpoint.data.count<=pinned.data.count)return {slot:'pinned',count:pinned.data.count,hash:pinned.hash,unchanged:true};
  // A larger candidate never replaces the explicitly chosen baseline.
  slot='candidate';
  const candidate=await read(storage,source,core,slot);
  if(candidate&&checkpoint.data.count<=candidate.data.count)return {slot,count:candidate.data.count,hash:candidate.hash,unchanged:true};
 }
 const k=key(source,slot);
 await storage.set({[k]:{raw:checkpoint.raw,hash:checkpoint.hash,count:checkpoint.data.count,runId:checkpoint.data.runId}});
 return {slot,count:checkpoint.data.count,hash:checkpoint.hash,runId:checkpoint.data.runId};
}
async function fetchLocal(expected,fetcher=fetch){
 if(!/^[a-f0-9]{64}$/.test(expected))throw Error('請輸入原始檔 SHA-256');
 const response=await fetcher(ENDPOINT,{credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
 if(!response.ok||!response.body)throw Error('本機保全橋接未就緒：HTTP '+response.status);
 if(Number(response.headers.get('content-length'))>MAX)throw Error('斷點超過100MiB');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX)throw Error('斷點超過100MiB');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 if(await digest(bytes)!==expected)throw Error('本機來源 SHA-256 不符');
 return bytes;
}
return {MAX,ENDPOINT,key,digest,decode,read,save,fetchLocal};
});