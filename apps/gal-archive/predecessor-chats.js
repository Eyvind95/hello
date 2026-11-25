(()=>{
'use strict';
const c=globalThis.GalPredecessorChat,$=id=>document.getElementById(id),DB='gal-predecessor-chat-library-v1';
let db,all=[],selected=null,classification=null,page=0,busy=false,renderTicket=0;
const status=t=>$('status').textContent=t;
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const open=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('raw',{keyPath:'hash'});r.result.createObjectStore('classes',{keyPath:'hash'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const read=(store,key)=>new Promise((resolve,reject)=>{const t=db.transaction(store,'readonly'),r=key===undefined?t.objectStore(store).getAll():t.objectStore(store).get(key);t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error)});
const add=(store,row)=>new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite'),s=t.objectStore(store),r=s.get(row.hash);let exists=false;r.onsuccess=()=>{exists=!!r.result;if(!exists)s.add(row)};t.oncomplete=()=>resolve(!exists);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});
function option(value,label){const el=document.createElement('option');el.value=value;el.textContent=label;return el}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function fileData(id){const file=$(id).files[0];if(!file)throw Error('請選擇 JSON');if(file.size>256*1024*1024)throw Error('單檔超過256 MiB，請保留原檔');const bytes=await file.arrayBuffer(),text=decode(bytes);return {file,bytes,text,data:JSON.parse(text),hash:await hash(bytes)}}
async function run(fn){if(busy)return;busy=true;try{await fn()}catch(e){status('⛔ '+String(e.message||e))}finally{busy=false}}
function clear(){selected=null;classification=null;$('detail').textContent='尚未選擇聊天';$('messages').replaceChildren();$('classes').replaceChildren();$('page').textContent='';for(const k of ['downloadRaw','task','downloadClass','importClass','prev','next'])$(k).disabled=true}
async function refresh(preferred){
 all=await read('raw');const groups=new Map();
 for(const r of all){const list=groups.get(r.chatId)||[];list.push(r);groups.set(r.chatId,list)}
 const choice=preferred||$('chats').value;$('chats').replaceChildren();
 for(const [id,list] of groups){list.sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt));$('chats').append(option(id,list[0].title+'｜'+id))}
 if(groups.has(choice))$('chats').value=choice;
 await versions();
}
async function versions(){
 const list=all.filter(x=>x.chatId===$('chats').value).sort((a,b)=>(b.status==='completed')-(a.status==='completed')||Date.parse(b.finishedAt)-Date.parse(a.finishedAt));
 $('versions').replaceChildren(...list.map(x=>option(x.hash,x.status+'｜'+x.finishedAt+'｜'+x.count+' 則')));
 await select();
}
async function select(){
 const ticket=++renderTicket;clear();const r=all.find(x=>x.hash===$('versions').value);if(!r)return;
 const data=JSON.parse(decode(await r.blob.arrayBuffer()));c.validateRaw(data);const classes=(await read('classes')).filter(x=>x.sourceSha256===r.hash).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));if(ticket!==renderTicket)return;
 selected={...r,data};classification=classes[0]||null;page=0;
 $('detail').textContent=data.title+'｜'+data.status+'｜'+data.count+' 則｜'+data.sourceUrl+'｜SHA-256 '+r.hash+(data.error?'｜'+data.error:'');
 $('downloadRaw').disabled=false;$('task').disabled=$('importClass').disabled=data.status!=='completed';$('downloadClass').disabled=!classification;
 $('classes').textContent=classification?'分類 '+classification.data.items.length+' 項（共 '+classes.length+' 版；原文未修改）':'尚無分類結果';
 if(classification){for(const item of classification.data.items){const line=document.createElement('p');line.textContent=item.category+'｜'+item.title+'｜'+item.messageIds.length+' 則'+(item.note?'｜'+item.note:'');$('classes').append(line)}}
 renderPage();
}
function renderPage(){
 if(!selected)return;const rows=selected.data.rows,total=Math.max(1,Math.ceil(rows.length/20));page=Math.max(0,Math.min(page,total-1));
 $('messages').replaceChildren();for(const row of rows.slice(page*20,(page+1)*20)){const h=document.createElement('strong'),pre=document.createElement('pre');h.textContent='#'+row.index+'｜'+row.role+'｜'+row.id;pre.textContent=row.text+(row.attachments.length?'\n\n附件參照：'+JSON.stringify(row.attachments,null,2):'');$('messages').append(h,pre)}
 $('page').textContent=(page+1)+' / '+total;$('prev').disabled=page===0;$('next').disabled=page>=total-1;
}
$('importRaw').onclick=()=>run(async()=>{
 const f=await fileData('raw'),d=f.data;c.validateRaw(d);
 const changed=await add('raw',{hash:f.hash,chatId:d.chatId,title:d.title,status:d.status,finishedAt:d.finishedAt,count:d.count,blob:new Blob([f.bytes],{type:'application/json'})});
 await refresh(d.chatId);$('raw').value='';status(changed?'已保存新版本，舊版保留':'相同原始檔已收錄，未重複寫入');
});
$('importClass').onclick=()=>run(async()=>{
 if(!selected)throw Error('請先選擇完成的原始聊天');
 const raw=selected,f=await fileData('classification'),report=c.validateClassification(raw.data,f.data,raw.hash);
 await add('classes',{hash:f.hash,sourceSha256:raw.hash,data:f.data,blob:new Blob([f.bytes],{type:'application/json'}),savedAt:new Date().toISOString()});$('classification').value='';await select();status('分類已保存：'+report.items+' 項，涵蓋 '+report.covered+'/'+report.total+' 則；未涵蓋者不能視為已分類');
});
$('downloadRaw').onclick=()=>{if(selected)download(selected.blob,'前輩聊天_'+selected.title+'_'+selected.chatId+'_'+selected.hash.slice(0,12)+'.json')};
$('downloadClass').onclick=()=>{if(classification)download(classification.blob,'前輩分類_'+selected.chatId+'_'+classification.hash.slice(0,12)+'.json')};
$('task').onclick=()=>{if(!selected||selected.status!=='completed')return;const s=selected;
 const data={format:'gal-predecessor-classification-task',version:1,title:s.title,chatId:s.chatId,sourceSha256:s.hash,categories:c.categories,instructions:['請同時讀取此任務與原始聊天JSON，根據原文分類，禁止猜測前輩身分、世界觀或輪迴。','分類結果只列訊息ID、標題、分類及必要簡短說明；Gal AI正史引用只標記，不再複製原文。','輸出下列結果格式；不能確定者標待確認，不刪除原始訊息。'],resultTemplate:{format:c.CLASS,version:1,chatId:s.chatId,sourceSha256:s.hash,items:[{id:'item-1',category:'待確認',title:'標題',messageIds:[],note:''}]},messageIndex:s.data.rows.map(r=>({id:r.id,index:r.index,role:r.role}))};
 download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'前輩分類任務_'+s.chatId+'.json')};
$('chats').onchange=()=>run(versions);$('versions').onchange=()=>run(select);$('prev').onclick=()=>{page--;renderPage()};$('next').onclick=()=>{page++;renderPage()};
clear();open().then(async x=>{db=x;await refresh()}).catch(e=>status('資料庫開啟失敗：'+e.message));
})();
