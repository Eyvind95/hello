(function(root){'use strict';const crypto=typeof module==='object'&&module.exports?require('node:crypto').webcrypto:root.crypto;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const fail=m=>{throw Error(m)};
function canonical(x){
 if(x===null||typeof x==='string'||typeof x==='boolean'||(typeof x==='number'&&Number.isFinite(x)))return JSON.stringify(x);
 if(Array.isArray(x)){if(Object.keys(x).length!==x.length)fail('非完整 JSON 陣列');return '['+x.map(canonical).join(',')+']'}
 if(!object(x))fail('非 JSON 資料，不可無損備份');
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
const same=(a,b)=>canonical(a)===canonical(b);
async function sha(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
const digest=x=>sha(canonical(x));

const api={canonical,digest,sha};if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchiveReadOnlyHash=api})(globalThis);
