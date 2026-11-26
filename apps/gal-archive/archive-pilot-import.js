(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchivePilotImport=api})(globalThis,function(){
'use strict';
const FORMAT='gal-predecessor-cycle-overwrite',FIELDS=['pilotMessages','quizLogs','easterEggs'];
const fail=m=>{throw Error(m)};
const str=(x)=>typeof x==='string'&&x.trim().length>0;
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function binding(r){return {worldKey:r.world,cycleId:r.id,cycleTitle:r.title}}
const JOINED='gal-predecessor-prefix-supplement-evidence';
function validateRows(rows,strict=false){
 const map=new Map();
 rows.forEach((row,i)=>{
  if(!obj(row)||!str(row.id)||map.has(row.id)||row.index!==i||!['user','assistant'].includes(row.role)||typeof row.text!=='string'||!Array.isArray(row.attachments)||(strict&&!Array.isArray(row.structure)))fail('原始來源索引、ID 或欄位異常：'+i);
  map.set(row.id,row);
 });
 return map;
}
function sourceView(source){
 if(!obj(source)||source.version!==1||!str(source.chatId)||!Array.isArray(source.rows)||!Number.isSafeInteger(source.count)||source.rows.length!==source.count||!source.count)fail('原始聊天資料結構錯誤');
 if(source.format!==JOINED){
  if(source.format!=='gal-predecessor-offline-reconciliation-candidate'&&!(source.format==='gal-predecessor-chat'&&source.status==='completed'))fail('請使用離線整合候選、成功頂端補掃證據或正式完成聊天');
  return {rows:source.rows,joined:false,localCount:source.count};
 }
 const e=source.evidence,b=source.base,c=source.candidateRows;
 // A joined display snapshot is evidence, never a canonical native transcript.
 if(source.status!=='joined-evidence'||source.canonical!==false||source.importable!==false||source.continuity!==false||source.fidelity!=='rendered-dom'||source.error!==null||!str(source.runId)||!obj(e)||!obj(b)||!Array.isArray(c))fail('頂端補掃尚未成功或證據格式不符');
 if(e.openingVerified!==true||e.originalCheckpointUnchanged!==true||e.lastConflict!==null||!str(e.expectedId)||!str(b.firstId)||!str(b.runId)||!/^[0-9a-f]{64}$/.test(b.sha256)||!Number.isSafeInteger(b.count)||!Number.isSafeInteger(e.added)||!Number.isSafeInteger(e.matched)||e.added<1||e.matched<2||b.count<e.matched||source.count!==e.added+e.matched||c.length!==b.count+e.added||e.joinedCandidateCount!==c.length)fail('頂端補掃拼接證據不一致');
 validateRows(source.rows,true);validateRows(c,true);
 if(c[0].id!==e.expectedId||c[0].role!=='user'||c[e.added].id!==b.firstId||!source.rows.every((row,i)=>equal(row,c[i])))fail('頂端補掃開頭、重疊或前綴內容不符');
 return {rows:c,joined:true,localCount:source.count};
}
const unresolved=row=>row.identityBasis==='unresolved-native-composite'||row.id.startsWith('assistant|composite:')||row.compositeNative!==undefined||row.compositeHtml!==undefined;
function plan(r,source,pack,sha){
 if(!obj(r)||!str(r.world)||!str(r.id)||!str(r.title))fail('缺少目前輪迴');
 if(!obj(pack)||pack.format!==FORMAT||pack.version!==1)fail('不是副駕駛三分頁覆蓋 JSON V1');
 if(!obj(pack.target)||!Object.entries(binding(r)).every(([k,v])=>pack.target[k]===v))fail('世界觀／輪迴 ID／輪迴名稱不符');
 const view=sourceView(source);
 if(!/^[0-9a-f]{64}$/.test(sha)||pack.sourceSha256!==sha||pack.chatId!==source.chatId)fail('來源聊天 ID 或 SHA-256 不符');
 if(!str(pack.manager)||pack.manager.length>180)fail('缺少副駕駛名稱');
 const map=validateRows(view.rows,view.joined);
 const isolated=view.rows.filter(unresolved).length;
 for(const row of view.rows)if(unresolved(row))map.delete(row.id);
 const existingIds=new Set(),oldOther=['messages','events','changeLogs'].flatMap(k=>r[k]||[]);for(const m of oldOther)if(m?.id)existingIds.add(m.id);
 function logs(key){
  if(!Array.isArray(pack[key])||(key==='pilotMessages'&&!pack[key].length))fail(key+' 空白或格式錯誤');
  let last=-1;const seen=new Set();
  return pack[key].map((entry,i)=>{
   const row=map.get(entry?.sourceId);if(!row||seen.has(row.id)||row.index<=last||!str(entry.text))fail(key+' 第 '+(i+1)+' 筆來源、順序或正文不符');
   const marker=/(?:^|\n)[ \t]*(?:[（(][ \t]*)?(?:我|他)[ \t]*[：:][ \t]*(?:[）)])?/u;
   let allowed=row.text;
   if(key==='pilotMessages'&&row.role==='user'){const match=marker.exec(allowed);if(match)allowed=allowed.slice(0,match.index)}
   if(!allowed.includes(entry.text)|| (key==='pilotMessages'&&row.role==='user'&&marker.test(entry.text)))fail(key+' 第 '+(i+1)+' 筆不是可保留的原文（劇情區塊不可混入）');
   seen.add(row.id);last=row.index;
   const id='predecessor:'+key+':'+source.chatId+':'+row.id;
   if(existingIds.has(id))fail('訊息 ID 與其他分頁衝突');
   const time=typeof row.sourceCreatedAt==='string'&&Number.isFinite(Date.parse(row.sourceCreatedAt))?row.sourceCreatedAt:null;
   return {id,role:row.role==='user'?'me':'ai',manager:row.role==='assistant'?pack.manager:'',text:entry.text,images:[],sourceCreatedAt:time,predecessorSource:{chatId:source.chatId,sha256:sha,id:row.id,index:row.index,attachments:structuredClone(row.attachments),...(view.joined?{sourceFormat:JOINED,sourceStatus:source.status,canonical:false,structure:structuredClone(row.structure)}:{})}};
  });
 }
 const incomingPilot=logs('pilotMessages'),incomingQuiz=logs('quizLogs');
 // Only a record already bound to this source, with the exact stable ID and
 // source row, can be updated. Never infer ownership from a player's text,
 // manager label, position, or a shared cycle.
 function merge(key,incoming){
  const old=r[key]||[];if(!Array.isArray(old))fail('舊資料格式異常');
  const next=structuredClone(old),positions=new Map();old.forEach((m,i)=>{if(m?.id){if(positions.has(m.id))fail('舊資料ID重複，請先核對');positions.set(m.id,i)}});
  let added=0,replaced=0;
  for(const m of incoming){
   const i=positions.get(m.id);
   if(i===undefined){next.push(m);added++;continue}
   const prior=old[i],ref=prior.predecessorSource;
   if(ref?.chatId!==source.chatId||ref?.id!==m.predecessorSource.id||ref?.sha256!==sha||prior.role!==m.role||prior.manager!==m.manager)fail('既有ID來源不符，拒絕覆蓋');
   // Retain previously attached real images and extra metadata. A user edit
   // or a differing extraction is a conflict, never silently overwritten.
   if(prior.text!==m.text)fail('既有同來源文字不同，請人工核對');
   next[i]={...structuredClone(prior),...m,images:structuredClone(prior.images||[])};replaced++;
  }
  return {rows:next,added,replaced,preserved:old.length-replaced};
 }
 const pilot=merge('pilotMessages',incomingPilot),quiz=merge('quizLogs',incomingQuiz),pilotMessages=pilot.rows,quizLogs=quiz.rows;
 if(!Array.isArray(pack.easterEggs))fail('彩蛋清單格式錯誤');
 const eggText=pack.easterEggs.map((e,i)=>{
  if(!obj(e)||!str(e.title)||!str(e.text)||!['confirmed','uncertain'].includes(e.status)||!Array.isArray(e.sourceIds)||!e.sourceIds.length||new Set(e.sourceIds).size!==e.sourceIds.length||!e.sourceIds.every(id=>map.has(id)))fail('彩蛋 '+(i+1)+' 缺少來源或確認狀態');
  return (i+1)+'. '+e.title+'（'+(e.status==='confirmed'?'已確認':'待確認')+'）\n'+e.text+'\n來源：'+e.sourceIds.join('、');
 }).join('\n\n');
 // Keep the existing unstructured easter-egg text in full. Exact repeated
 // import is idempotent; differing candidate text is appended, not destructive.
 const oldEggs=r.easterEggs||'';if(typeof oldEggs!=='string')fail('舊彩蛋格式錯誤');
 const block='【'+pack.manager+'・考古候選｜'+source.chatId+'｜'+sha+'】\n'+eggText;
 const easterEggs=!eggText||oldEggs.includes(block)?oldEggs:oldEggs+(oldEggs?'\n\n':'')+block;
 const updated={...structuredClone(r),pilotMessages,quizLogs,easterEggs};
 const counts={pilotBefore:(r.pilotMessages||[]).length,pilotAfter:pilotMessages.length,quizBefore:(r.quizLogs||[]).length,quizAfter:quizLogs.length,eggsBefore:(r.easterEggs||'').length,eggsAfter:easterEggs.length,eggCount:pack.easterEggs.length};
 return {updated,counts,sourceCount:view.rows.length,sourceStatus:source.status,sourceEvidence:{joined:view.joined,localCount:view.localCount,isolated,canonical:source.canonical===true},merge:{pilot:{added:pilot.added,replaced:pilot.replaced,preserved:pilot.preserved},quiz:{added:quiz.added,replaced:quiz.replaced,preserved:quiz.preserved},quizMissing:incomingQuiz.length===0,quizPartial:incomingQuiz.length>0&&(!incomingQuiz.some(m=>m.role==='me')||!incomingQuiz.some(m=>m.role==='ai'))},attachments:incomingPilot.concat(incomingQuiz).reduce((n,m)=>n+m.predecessorSource.attachments.length,0)};
}
function sameUnchanged(before,after){return equal(Object.fromEntries(Object.entries(before).filter(([k])=>!FIELDS.includes(k)&&k!=='updatedAt')),Object.fromEntries(Object.entries(after).filter(([k])=>!FIELDS.includes(k)&&k!=='updatedAt')))}
return {FORMAT,binding,plan,sameUnchanged};
});
