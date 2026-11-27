/* Independent ChatGPT reading archive. No Gal AI canonical import or network. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GalPredecessorChat=api})(globalThis,()=>{
'use strict';
const SAMPLE='gal-predecessor-chat-sample',SAMPLE_LIMIT=10,FORMAT='gal-predecessor-chat',CLASS='gal-predecessor-classification',COMPOSITE='gal-predecessor-composite-evidence',VERSION=1;
const categories=['交接稿','茶話會','評語與自評','稱號與事故','規則與設定','輪迴補充','其他','Gal AI正史引用（不另收錄正文）','待確認'];
const check=(v,m)=>{if(!v)throw Error(m)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Blob URLs identify a temporary browser object, not durable attachment identity.
// Only image reference URLs on this exact origin may vary; compare all other
// fields strictly. Never infer equal bytes from equal labels or positions.
const transientImage=a=>a?.kind==='image-reference'&&typeof a.url==='string'&&/^blob:https:\/\/chatgpt\.com\/[0-9a-f-]{36}$/i.test(a.url);
const isComposite=r=>r?.identityBasis==='unresolved-native-composite';
function compositeId(turn,ids){return 'assistant|composite:'+turn+':'+ids.join('+')}
function comparisonRow(r){
 const out={...r,attachments:r.attachments.map(a=>transientImage(a)?{...a,url:'blob:chatgpt-image-reference'}:a)};
 // HTML is a first observed forensic snapshot, not an invariant.
 // Text, structure, and the complete ID list still compare exactly.
 if(isComposite(r))delete out.compositeHtml;
 return out;
}
// Current predecessor scans project out image references. Legacy raw files
// remain unchanged and can still be validated with their original rules.
function withoutImages(row){
 const attachments=row.attachments.filter(a=>a.kind!=='image-reference');
 const out={...row,attachments};
 if(!row.text.trim()&&!attachments.length&&(row.nonTextOmitted===true||row.attachments.some(a=>a.kind==='image-reference')))out.nonTextOmitted=true;
 return out;
}
function fingerprint(rows){return JSON.stringify(rows.map(comparisonRow))}
function compareRow(previous,current){
 const before=comparisonRow(previous),after=comparisonRow(current);
 const fields=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!same(before[k],after[k]));
 const changes=[];
 if(!fields.length)for(let i=0;i<previous.attachments.length;i++){
  const a=previous.attachments[i],b=current.attachments[i];
  if(transientImage(a)&&transientImage(b)&&a.url!==b.url)changes.push({messageId:previous.id,attachmentIndex:i,kind:a.kind,label:a.label,previousUrl:a.url,currentUrl:b.url,bytesVerified:false});
 }
 return {equal:fields.length===0,fields,changes};
}
// A specific composite DOM code rendering transition: a single text node
// is replaced by a code-header div and split spans. No global text stripping.
// Require the unchanged semantic code structure and a unique code occurrence.
function codeRenderEquivalent(a,b,fields){
 const allowed=['text','sourceTextNodes','sourceTextCharacters','domTextSegments'];
 if(fields.length!==allowed.length||!fields.every(k=>allowed.includes(k))||a.role!=='assistant'||a.contentBasis!=='composite-after-user-dom'||b.contentBasis!==a.contentBasis)return false;
 const short=a.text.length<b.text.length?a:b,long=short===a?b:a,label='程式碼';
 if(long.text.length-short.text.length!==label.length+1)return false;
 const valid=r=>Array.isArray(r.domTextSegments)&&r.domTextSegments.every(x=>x&&typeof x.tag==='string'&&typeof x.text==='string')&&r.sourceTextNodes===r.domTextSegments.length&&r.sourceTextCharacters===r.domTextSegments.reduce((n,x)=>n+x.text.length,0);
 if(!valid(short)||!valid(long))return false;
 const x=short.domTextSegments,y=long.domTextSegments;
 for(let i=0;i<x.length;i++){
  if(!same(x.slice(0,i),y.slice(0,i)))break;
  const block=x[i].text;
  if(x[i].tag!=='span'||!block.includes('\n')||!same(y[i],{tag:'div',text:label}))continue;
  if(short.structure.filter(z=>z.tag==='code'&&z.text===block).length!==1)continue;
  const at=short.text.indexOf(block);
  if(at<0||short.text.indexOf(block,at+block.length)!==-1||long.text!==short.text.slice(0,at)+label+'\n'+short.text.slice(at))continue;
  const end=y.length-(x.length-i-1),parts=y.slice(i+1,end);
  if(parts.length>1&&parts.every(z=>z.tag==='span')&&parts.map(z=>z.text).join('')===block&&same(x.slice(i+1),y.slice(end)))return true;
 }
 return false;
}
// Only previously unobserved generic user image references may be enriched.
// The two DOM observations are not proof of the original attachment bytes.
// A previously observed collapsed user row may include the rendered trailing
// ellipsis. Preserve both observations; this proves a narrow overlap variant,
// not original text completeness or a server-side edit history.
function foldedTailEvidence(previous,current,fields,context){
 if(!context||context.currentOverflow||!context.current||
    previous.role!=='user'||current.role!=='user'||previous.id!==current.id||
    fields.length!==1||fields[0]!=='text'||!same(previous.attachments,current.attachments)||
    !current.text.trim()||previous.text!==current.text+'\n…')return null;
 const observed=[...context.current.values()].filter(x=>x.messageId===current.id);
 const matches=(x,row,collapsed)=>x.messageId===row.id&&x.collapsed===collapsed&&x.fullTextVerified===false&&
  (collapsed?/^(?:顯示較多|顯示更多|顯示全部|展開全文|Show more|Read more)$/i:/^(?:顯示較少|Show less)$/i).test(x.label||'')&&
  x.removedSuffix==='\n'+x.label&&x.rawLength===row.text.length+x.removedSuffix.length;
 const source=Array.isArray(context.source)&&/^[a-f0-9]{64}$/.test(context.sourceSha256||'')?
   context.source.find(x=>matches(x,previous,true)):null;
 const local=observed.find(x=>matches(x,previous,true));
 const expanded=observed.find(x=>matches(x,current,false));
 // Preserve the existing checkpoint-to-unfolded path with no fold control.
 // A live fold control must be corroborated by the exact expanded observation.
 // Within a run require both exact folded and expanded observations.
 if(!source&&!(local&&expanded))return null;
 if(observed.length&&!expanded)return null;
 return {type:'folded-user-tail-variant',messageId:previous.id,fields:['text'],previous,current,
  sourceFoldObservation:source||local,sourceSha256:source?context.sourceSha256:null,
  foldBasis:source?'checkpoint':'same-run',currentFoldObservation:expanded||null,fullTextVerified:false};
}
// Only accepted windows in this run can bridge a temporary image URL change.
const genericUserImages=a=>a.length>0&&a.every(x=>transientImage(x)&&x.label==='使用者附件')&&new Set(a.map(x=>x.url)).size===a.length;
function rememberAttachmentObservations(map,saved,live){
 const byId=new Map(saved.map(r=>[r.id,r]));
 for(const row of live){
  const prior=byId.get(row.id);
  if(!prior||row.role!=='user'||!row.text.trim()||!genericUserImages(row.attachments)||!genericUserImages(prior.attachments)||!compareRow(prior,row).equal||same(prior.attachments,row.attachments)){map.delete(row.id);continue}
  map.set(row.id,row);
 }
 return map;
}
function reconcileOverlap(previous,current,foldContext){
 const comparison=compareRow(previous,current);
 if(comparison.equal)return {...comparison,row:previous};
 const fold=foldedTailEvidence(previous,current,comparison.fields,foldContext);
 if(fold)return {equal:true,fields:[],row:previous,changes:[fold]};
 if(codeRenderEquivalent(previous,current,comparison.fields))return {equal:true,fields:[],row:previous,changes:[{type:'code-render-label-variant',messageId:previous.id,fields:comparison.fields,previous,current}]};
 if(comparison.fields.length!==1||comparison.fields[0]!=='attachments'||previous.role!=='user'||!previous.text.trim())return comparison;
 const images=genericUserImages;
 const appeared=previous.attachments.length===0&&images(current.attachments);
 const disappeared=current.attachments.length===0&&images(previous.attachments);
 // A strict ordered subsequence of exact references is evidence of a
 // partial observation, not proof of bytes or original attachment count.
 const orderedSubset=(small,big)=>{
  if(!images(small)||!images(big)||small.length>=big.length)return false;
  let i=0;for(const a of big)if(i<small.length&&same(small[i],a))i++;
  return i===small.length;
 };
 const enriched=orderedSubset(previous.attachments,current.attachments);
 const partial=orderedSubset(current.attachments,previous.attachments);
 if(!appeared&&!disappeared&&!enriched&&!partial){
  const bridge=foldContext?.attachmentBridges?.get(previous.id);
  if(!bridge||bridge.id!==previous.id||!images(previous.attachments)||!images(bridge.attachments)||
     same(previous.attachments,bridge.attachments)||!compareRow(previous,bridge).equal||
     !orderedSubset(bridge.attachments,current.attachments))return comparison;
  return {equal:true,fields:[],row:{...previous,attachments:current.attachments.slice()},changes:[{
   type:'image-reference-accepted-window-bridge-enriched',messageId:previous.id,
   previousAttachments:previous.attachments,bridgeAttachments:bridge.attachments,currentAttachments:current.attachments,
   bridgeBasis:'same-run-accepted-window',bytesVerified:false,attachmentCountVerified:false}]};
 }
 const type=appeared?'image-reference-appeared':disappeared?'image-reference-not-observed':enriched?'image-reference-subset-enriched':'image-reference-subset-not-observed';
 return {equal:true,fields:[],row:appeared||enriched?{...previous,attachments:current.attachments.slice()}:previous,changes:[{messageId:previous.id,type,previousAttachments:previous.attachments,currentAttachments:current.attachments,bytesVerified:false,attachmentCountVerified:false}]};
}
const sampleLimit=x=>x===true||x===10?10:x===20?20:0;
function chatTitle(value){const title=String(value||'').replace(/\s*[-–|]\s*ChatGPT\s*$/i,'').trim();return /^(?:ChatGPT|新對話|新聊天|New chat|New conversation)$/i.test(title)?'':title}
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=512;
function validateRows(rows){
 check(Array.isArray(rows),'訊息不是陣列');
 const ids=new Set(),nativeClaims=new Set(),compositeClaims=new Set(),assistantTurns=new Set(),compositeTurns=new Set();
 for(const r of rows){
  check(r&&validId(r.id)&&!ids.has(r.id)&&['user','assistant'].includes(r.role)&&typeof r.text==='string'&&Array.isArray(r.structure)&&Array.isArray(r.attachments)&&typeof r.identityBasis==='string'&&r.identityBasis&&r.identityBasis!=='position','訊息 ID、角色或內容格式不符');
  check(r.text.trim()||r.attachments.length||(r.nonTextOmitted===true&&/^(user|assistant)\|(turn|message):[a-zA-Z0-9_-]+$/.test(r.id)&&r.id.startsWith(r.role+'|')&&['turn-key','native-dom-id'].includes(r.identityBasis)),'空白訊息缺少可核對附件或非文字回合證據');
  check(r.structure.every(x=>x&&typeof x.tag==='string'&&typeof x.text==='string'),'格式記錄不符');
  check(r.attachments.every(x=>x&&typeof x.kind==='string'&&typeof x.label==='string'&&(x.url===null||typeof x.url==='string')),'附件參照格式不符');
  ids.add(r.id);
  const claim=id=>{check(!nativeClaims.has(id)&&!compositeClaims.has(id),'複合原生 ID 與另一列衝突');compositeClaims.add(id)};
  if(isComposite(r)){
   const p=r.compositeNative,token=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]+$/.test(x);
   check(r.role==='assistant'&&r.text.trim()&&p&&token(p.turnId)&&Array.isArray(p.ids)&&p.ids.length===2&&p.ids.every(token)&&new Set(p.ids).size===2&&p.bodyId===p.ids[0]&&same(p.declaredIds,[p.ids[0],p.ids[0],p.ids[1]])&&p.boundaryVerified===false&&r.id===compositeId(p.turnId,p.ids)&&typeof r.compositeHtml==='string'&&r.compositeHtml.length>0&&r.compositeHtml.length<=120000,'複合原生單元證據不符');
   check(!assistantTurns.has(p.turnId)&&!compositeTurns.has(p.turnId),'複合回合與另一 GPT 回合衝突');compositeTurns.add(p.turnId);
   p.ids.forEach(claim);
  }else{
   check(!r.id.startsWith('assistant|composite:')&&r.compositeNative===undefined&&r.compositeHtml===undefined,'複合單元不得偽裝原生訊息');
   const turn=/^assistant\|turn:(.+)$/.exec(r.id);if(turn){check(!compositeTurns.has(turn[1]),'複合回合與另一 GPT 回合衝突');assistantTurns.add(turn[1])}
   const m=/^(?:user|assistant)\|message:(.+)$/.exec(r.id);if(m){check(!compositeClaims.has(m[1]),'複合原生 ID 與另一列衝突');nativeClaims.add(m[1])}
  }
 }
 return ids;
}
// Every newly loaded window must overlap the exact current sequence.
// Only a contiguous prefix may be prepended in an upward scan.
function mergeUp(previous,live,onChange,foldContext){
 validateRows(previous);validateRows(live);check(live.length,'目前沒有可讀訊息');
 if(!previous.length)return live.slice();
 const pos=new Map(previous.map((r,i)=>[r.id,i]));
 const known=live.map((r,i)=>({r,i,at:pos.get(r.id)})).filter(x=>x.at!==undefined);
 check(known.length,'視窗沒有重疊訊息');
 const first=known[0],last=known.at(-1),merged=previous.slice(),changes=[];
 for(let j=0;j<known.length;j++){
  const x=known[j];check(x.i===first.i+j&&x.at===first.at+j,'重疊區域有缺口、重排或重複');
  const comparison=reconcileOverlap(previous[x.at],x.r,foldContext);
  if(!comparison.equal){const error=Error('同一訊息 ID 的內容或格式改變：'+x.r.id+' ['+comparison.fields.join(', ')+']');error.overlapEvidence={messageId:x.r.id,fields:comparison.fields,previous:previous[x.at],current:x.r};throw error}
  merged[x.at]=comparison.row;changes.push(...comparison.changes);
 }
 check(last.i===live.length-1,'向上掃描發現原尾端之外的新訊息或分支');
 check(first.i===0||first.at===0,'新增訊息沒有接在已保全的最前端');
 const result=[...live.slice(0,first.i),...merged];
 if(result.some(isComposite))validateRows(result);
 if(typeof onChange==='function')for(const change of changes)onChange(change);
 return result;
}
// Evidence-only alternative, never an accepted merge. Require a contiguous
// old prefix, a new earlier prefix, and at least two unaffected adjacent rows.
// The attachment conflict must be exactly the first old user's disjoint
// generic temporary image lists of different sizes.
function isolateFrontierWindow(saved,live){
 validateRows(saved);validateRows(live);
 const at=live.findIndex(r=>r.id===saved[0]?.id);
 if(at<1||live.length-at<3||live.length-at>saved.length)return null;
 const ids=new Set(saved.map(r=>r.id));
 if(live.slice(0,at).some(r=>ids.has(r.id)))return null;
 const old=saved[0],current=live[at],diff=compareRow(old,current);
 if(old.role!=='user'||!old.text.trim()||diff.fields.length!==1||diff.fields[0]!=='attachments'||
    !genericUserImages(old.attachments)||!genericUserImages(current.attachments)||
    old.attachments.length===current.attachments.length||
    old.attachments.some(x=>current.attachments.some(y=>x.url===y.url)))return null;
 for(let j=1;j<live.length-at;j++)if(saved[j].id!==live[at+j].id||!compareRow(saved[j],live[at+j]).equal)return null;
 return {kind:'unresolved-disjoint-image-frontier',old,current,matchedNeighbors:live.length-at-1,newPrefixCount:at,initialWindow:live.slice(),attachmentCountVerified:false,attachmentBytesVerified:false};
}
const scrollRange=(height,viewport)=>Number.isFinite(height)&&Number.isFinite(viewport)&&viewport>0?Math.max(0,height-viewport):0;
const minimumCount=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):0;
function fullCoverageGate(count,minimum,maxRange,observedMovement){
 return count>=minimumCount(minimum)&&maxRange>8&&observedMovement===true;
}
function edgeProof(rows,all,{atEdge,stableMs,edge,loading=false,position=null,total=null}={}){
 if(!atEdge||loading||!rows.length||!all.length||!Number.isFinite(stableMs))return false;
 if(edge==='top')return stableMs>=8000&&rows[0].id===all[0].id&&(!Number.isInteger(position)||position===1);
 if(edge==='bottom')return stableMs>=3000&&rows.at(-1).id===all.at(-1).id&&(!Number.isInteger(position)||!Number.isInteger(total)||position===total);
 return false;
}
function sourceId(url){
 const u=new URL(url);check(u.origin==='https://chatgpt.com'&&/^\/(?:c\/[A-Za-z0-9-]+|g\/[^/]+\/c\/[A-Za-z0-9-]+)\/?$/.test(u.pathname)&&!u.search&&!u.hash,'聊天來源網址不符');
 return u.pathname.replace(/\/$/,'').split('/').at(-1);
}
function validateRawInternal(data,composite=false){
 check(data?.format===(composite?COMPOSITE:FORMAT)&&!['sample-10','sample-20'].includes(data.scope)&&(composite?data.importable===false&&data.status!=='completed':data.importable!==false)&&data.version===VERSION&&data.canonical===false&&data.fidelity==='rendered-dom'&&['completed','failed','cancelled'].includes(data.status),'不是前輩聊天獨立保全 JSON');
 check(validId(data.runId)&&validId(data.title)&&data.chatId===sourceId(data.sourceUrl),'聊天標題或來源 ID 不符');
 const start=Date.parse(data.startedAt),end=Date.parse(data.finishedAt);
 check(Number.isFinite(start)&&Number.isFinite(end)&&end>=start,'掃描時間無效');
 const ids=validateRows(data.rows);check(data.rows.every((r,i)=>r.index===i)&&data.count===data.rows.length,'訊息索引／總數不符');
 const groups=data.rows.filter(isComposite),isolatedGroups=(data.evidence?.isolatedSegment?.rows||[]).filter(isComposite);
 check(composite?groups.length+isolatedGroups.length>0&&data.evidence?.continuity===false&&data.evidence?.unresolvedCompositeCount===groups.length+isolatedGroups.length:!groups.length&&!isolatedGroups.length,'複合原生單元僅供隔離取證，不得正式匯入');
 check(data.evidence&&Array.isArray(data.warnings)&&data.warnings.every(x=>typeof x==='string'),'缺少掃描證據');
 if(data.status==='completed')check(data.rows.length&&data.evidence.bottomStableMs>=3000&&data.evidence.topStableMs>=8000&&data.evidence.topReached===true&&data.evidence.bottomReached===true&&data.evidence.continuity===true&&data.evidence.firstId===data.rows[0].id&&data.evidence.lastId===data.rows.at(-1).id&&!data.error,'完成檔缺少首尾或連續性證據');
 if(data.status==='completed'){
  const ev=data.evidence,version=String(data.scannerVersion||'').split('.').map(Number);
  // Historical false completions with a documented zero-range host are invalid.
  if(Array.isArray(ev.scrollTrace)&&ev.scrollTrace.length&&ev.scrollTrace.every(t=>Number.isFinite(t.scrollHeight)&&Number.isFinite(t.clientHeight)&&scrollRange(t.scrollHeight,t.clientHeight)<=8)&&ev.breakthroughState?.frontier?.height===ev.scrollTrace[0].clientHeight)
   check(false,'完成檔捲動容器無有效捲動距離');
  if(version[0]===0&&version[1]===10&&version[2]>=20||version[0]>0||version[0]===0&&version[1]>10)
   check(fullCoverageGate(data.count,ev.knownMinimum,ev.hostProof?.maxRange,ev.hostProof?.observedMovement),'完成檔缺少可捲動容器、移動或已知最低數量證據');
 }
 if(data.evidence.isolatedSegment){
  const seg=data.evidence.isolatedSegment;
  check(data.status!=='completed'&&data.evidence.continuity!==true&&seg.importable===false&&seg.format==='gal-predecessor-frontier-evidence'&&seg.count===seg.rows?.length&&seg.rows.length>0&&seg.rows.every((r,i)=>r.index===i),'隔離取證不得當完整聊天');
  validateRows(seg.rows);
  const original=data.rows.map(({index,...r})=>r),proof=isolateFrontierWindow(original,seg.anchor?.initialWindow||[]);
  check(proof&&same(proof,seg.anchor)&&seg.rows.at(-1).id===proof.initialWindow.at(-1).id,'隔離取證缺少原始前沿證據');
 }
 if(data.status==='completed'&&data.evidence.resume){
  const q=data.evidence.resume;
  check(q.tailVerified===true&&q.frontierVerified===true&&q.baseCount>=2&&data.count>=q.baseCount&&/^[a-f0-9]{64}$/.test(q.sourceSha256),'續掃完成檔缺少原斷點及前沿核對證據');
 }
 return ids;
}
function validateRaw(data){return validateRawInternal(data,false)}
function validateCompositeEvidence(data){return validateRawInternal(data,true)}
// Checkpoints are user-selected, previously preserved partial scans. Never
// treat their rows as newly read or accept a different branch or tail.
// Deferred-tail checkpoints retain the prior verified tail as provenance,
 // not as a claim that it has been re-read in this run. They are never complete.
function pendingTailProof(data){
 const ev=data.evidence,q=ev?.resume,p=q?.inheritedBottom;
 return !!(q?.currentPosition===true&&q.tailVerified===false&&q.frontierVerified===true&&q.minIndex===0&&Number.isSafeInteger(q.checkedWindows)&&q.checkedWindows>=1&&
   Number.isSafeInteger(q.baseCount)&&q.baseCount>=2&&data.count>=q.baseCount&&
   /^[a-f0-9]{64}$/.test(q.sourceSha256||'')&&validId(q.sourceRunId)&&
   data.rows[data.count-q.baseCount]?.id===q.sourceFirstId&&data.rows.at(-1)?.id===q.sourceLastId&&
   Array.isArray(q.frontierPair)&&q.frontierPair.length===2&&q.frontierPair[0]===q.sourceFirstId&&q.frontierPair[1]===data.rows[data.count-q.baseCount+1]?.id&&
   p&&validId(p.runId)&&/^[a-f0-9]{64}$/.test(p.sha256||'')&&p.lastId===q.sourceLastId&&p.bottomStableMs>=3000&&p.maxRange>8&&p.observedMovement===true&&
   ev.bottomReached===false&&ev.bottomStableMs===0&&ev.continuity===false&&ev.firstId===data.rows[0]?.id&&ev.lastId===data.rows.at(-1)?.id&&ev.windows>0);
}
function validateCheckpoint(data,source,omitImages=false){
 (data?.format===COMPOSITE?validateCompositeEvidence:validateRaw)(data);
 check(['failed','cancelled'].includes(data.status)&&data.count>=2,'請選擇至少兩則的未完成完整掃描保全檔');
 check(data.chatId===sourceId(source)&&new URL(data.sourceUrl).pathname.replace(/\/$/,'')===new URL(source).pathname.replace(/\/$/,''),'續掃來源不是目前聊天');
 const ev=data.evidence;
 check(!ev.isolatedSegment,'隔離取證尚未核對附件，不能作為正式續掃斷點');
 const pending=pendingTailProof(data);
 check(pending||(ev.bottomReached===true&&ev.bottomStableMs>=3000&&ev.firstId===data.rows[0].id&&ev.lastId===data.rows.at(-1).id&&ev.windows>0),'斷點缺少底端或訊息邊界證據');
 check(ev.hostProof?ev.hostProof.maxRange>8&&ev.hostProof.observedMovement===true:Array.isArray(ev.scrollTrace)&&ev.scrollTrace.some(t=>scrollRange(t.scrollHeight,t.clientHeight)>8),'斷點缺少有效捲動證據');
 check(!String(data.error||'').startsWith('輸出核對失敗'),'斷點輸出驗證失敗');
 if(ev.resume)check(pending||(ev.resume.tailVerified&&ev.resume.frontierVerified),'前次續掃尚未核對前沿，請使用原始斷點');
 return data.rows.map(({index,...r})=>omitImages?withoutImages(r):r);
}
function resumeWindow(saved,live){
 const pos=new Map(saved.map((r,i)=>[r.id,i])),indices=live.map(r=>pos.get(r.id)).filter(i=>i!==undefined);
 check(indices.length,'視窗沒有重疊訊息');
 return {minIndex:indices[0],matched:indices.length,frontier:indices[0]===0&&indices[1]===1};
}
function resumeSeed(saved,live,onChange,foldContext){
 const progress=resumeWindow(saved,live);
 check(live.at(-1)?.id===saved.at(-1)?.id&&progress.matched>=2,'斷點尾端不同或少於兩則重疊，請改用新完整掃描');
 const merged=mergeUp(saved,live,onChange,foldContext);
 check(merged.length===saved.length||progress.frontier,'續掃前沿未核對，不能增加舊訊息');
 return {rows:merged,...progress};
}
function resumeFrontierSeed(saved,live,onChange,foldContext){
 const progress=resumeWindow(saved,live);
 check(progress.frontier&&progress.matched>=2,'目前位置未核對原保全前沿的兩則相鄰訊息');
 const rows=mergeUp(saved,live,onChange,foldContext);
 return {rows,...progress};
}
function resumeStep(viewport,minIndex){return minIndex>12?Math.max(scrollStep(viewport,8),Math.floor(viewport*5)):0}
// Larger steps still require exact overlap.
const scrollStep=(height,unchanged=0)=>Math.max(24,Math.floor(height*(unchanged>=8?2.5:unchanged>=3?1.5:.85)));
// A virtualized chat may change height while jumping to its bottom.
 // A height-only shift is not a reset. For changed heights require a large
 // unexplained displacement AND a bottom landing. The adjusted coordinate
 // is only a recovery attempt; strict message overlap is still required.
function scrollRecoveryTarget(target,actual,height,expectedHeight,viewport,tolerance=.75){
 if(![target,actual,height,expectedHeight,viewport].every(Number.isFinite)||viewport<=0)return null;
 const max=Math.max(0,height-viewport),delta=height-expectedHeight,threshold=Math.max(32,viewport*tolerance);
 // A genuine far return to the bottom remains a recovery event even when
 // ordinary local navigation is granted a wider coordinate envelope.
 const bottomThreshold=Math.max(32,viewport*.75);
 const farBottom=Math.abs(actual-max)<=6&&actual-Math.max(target,Math.min(max,Math.max(0,target+delta)))>bottomThreshold;
 if(Math.abs(delta)<=2)return actual-target>threshold||farBottom?Math.min(max,Math.max(0,target)):null;
 const adjusted=Math.min(max,Math.max(0,target+delta));
 const unexplained=actual-Math.max(target,adjusted);
 return farBottom&&unexplained>bottomThreshold?adjusted:null;
}
const scrollReset=(...args)=>scrollRecoveryTarget(...args)!==null;
// An accepted frontier is a coordinate hint, never a continuity proof.
function frontierPosition(frontier,height,viewport){
 if(!frontier||![frontier.top,frontier.height,height,viewport].every(Number.isFinite))return null;
 return Math.max(0,Math.min(height-viewport,frontier.top+height-frontier.height));
}
function verifiedViewportAnchor(verified,actual,height,viewport){
 if(!verified||![verified.top,verified.height,actual,height,viewport].every(Number.isFinite)||viewport<=0)return null;
 const predicted=frontierPosition(verified,height,viewport),max=scrollRange(height,viewport);
 if(max<=viewport*4||actual<max-6||predicted===null||actual-predicted<viewport*4)return null;
 return {top:verified.top,height:verified.height};
}
// Only significant positive height changes justify these extra probes.
 // Position estimates cannot establish message identity or continuity.
function heightGrowthRejoinAnchor(verified,height,viewport){
 if(!verified||![verified.top,verified.height,height,viewport].every(Number.isFinite)||viewport<=0||verified.top<0||verified.height<viewport||verified.top>scrollRange(verified.height,viewport)||height-verified.height<viewport)return null;
 return {top:verified.top,height:verified.height};
}
function breakthroughStep(state,viewport){
 if(!state||state.resets<5||state.attempts>=3)return 0;
 return scrollStep(viewport,8)*(2+state.attempts);
}
// Scroll coordinates are estimates, not identity evidence. Rebase every
// retry on the current height; probe the old coordinate as a fallback
// when the height change was caused by a resize rather than prepend.
function rejoinTarget(anchor,height,viewport,offset=0,rebase=true){
 if(!anchor||![anchor.top,anchor.height,height,viewport,offset].every(Number.isFinite))return null;
 return Math.max(0,Math.min(scrollRange(height,viewport),anchor.top+(rebase?height-anchor.height:0)+offset));
}
// A/B/A oscillation (or the same failed target repeatedly) means height
// compensation is chasing an unstable virtual layout. Hold one coordinate
// for a bounded number of attempts, then let the caller try another probe.
function recoveryCycle(policy,destination,viewport){
 const recent=policy.recent||(policy.recent=[]),tol=Math.max(8,Math.min(32,viewport*.05));
 recent.push(destination);if(recent.length>3)recent.shift();
 const calls=policy.recentCalls||(policy.recentCalls=[]);
 calls.push(policy.currentWindow||0);if(calls.length>3)calls.shift();
 let detected=false,crossWindow=false;
 if(policy.locked==null&&recent.length===3&&Math.abs(recent[0]-recent[2])<=tol){
  policy.locked=recent[2];policy.holds=0;detected=true;crossWindow=new Set(calls).size>1;
 }
 if(policy.locked!=null){
  policy.holds++;
  return {destination:policy.locked,delay:Math.min(2400,800*policy.holds),detected,crossWindow,exhausted:policy.holds>3};
 }
 return {destination,delay:recent.length>1?350:180,detected:false,exhausted:false};
}
// Only evidence of older history resets this policy. Stable reads of
// already saved windows do not constitute progress.
function recoveryPolicy(state){
 const p=state.recoveryPolicy||(state.recoveryPolicy={recent:[],recentCalls:[],locked:null,holds:0,currentWindow:0});
 p.currentWindow++;
 return p;
}
function clearRecoveryPolicy(state){delete state.recoveryPolicy;delete state.recoveryAvoidFrontier;delete state.bottomEscapeHits;delete state.bottomEscapeAttempts;delete state.stagedEscapeBackoff}
function alternateRecoveryPolicy(state){delete state.recoveryPolicy;state.recoveryAvoidFrontier=true}
// Only actual bottom landings after near-top targets count. The maneuver
// is bounded per accepted progress interval and never proves continuity.
function bottomEscape(state,target,actual,height,viewport){
 const max=scrollRange(height,viewport);
 const extended=state.recoveryAvoidFrontier===true&&max-target>viewport*100;
 if(max<=viewport*4||Math.abs(actual-max)>6||(target>viewport*2&&!extended)){state.bottomEscapeHits=0;return null}
 state.bottomEscapeHits=(state.bottomEscapeHits||0)+1;
 if(state.bottomEscapeHits<3||state.resets<5||(state.bottomEscapeAttempts||0)>=(extended?4:2))return null;
 state.bottomEscapeHits=0;state.bottomEscapeAttempts=(state.bottomEscapeAttempts||0)+1;
 return Math.max(0,max-Math.max(24,Math.floor(viewport*.5)));
}
// Very long instant returns may snap back to the bottom. Divide only
// the recovery journey into bounded positional stages; these do not
// prove message coverage and are never used to append rows.
function escapeStageCount(from,target,viewport){
 const gap=from-target;
 return gap>viewport*100?Math.min(24,Math.max(2,Math.ceil(gap/(viewport*100)))):1;
}
function escapeStageTarget(from,target,remaining){return Math.max(target,from-(from-target)/Math.max(1,remaining))}
// During an intermediate navigation leg, height may change on either side of the viewport.
// Accept only bounded upward movement in both coordinate frames, not a bottom snap.
// Final position still requires a direct or fully height-rebased landing.
function escapeLanding({start,waypoint,actual,height,nowHeight,viewport,final=false}){
 if(![start,waypoint,actual,height,nowHeight,viewport].every(Number.isFinite)||viewport<=0)return null;
 const max=scrollRange(nowHeight,viewport),oldMax=scrollRange(height,viewport),tol=Math.max(24,viewport*.5);
 if(actual<0||actual>=max-6)return null;
 const direct=Math.max(0,Math.min(max,waypoint)),expected=rejoinTarget({top:waypoint,height},nowHeight,viewport);
 if(Math.abs(actual-direct)<=tol)return 'direct';
 if(Math.abs(actual-expected)<=tol)return 'height-rebased';
 if(final)return null;
 const step=start-waypoint,forward=Math.min(start-actual,(max-actual)-(oldMax-start));
 if(step>viewport&&forward>=step*.5&&actual>=Math.min(direct,expected)-tol&&actual<=Math.max(direct,expected)+tol)return 'height-envelope';
 return null;
}
const noNewRows=(lastGrowth,now,limit=60000)=>now-lastGrowth>=limit;
function sampleReady(rows,bottomReached,topReached,limit=SAMPLE_LIMIT){
 return !!sampleLimit(limit)&&bottomReached===true&&rows.length>0&&(rows.length>=limit||topReached===true);
}
function sampleRows(rows,limit=SAMPLE_LIMIT){check(!!sampleLimit(limit),'無效測試數量');return rows.slice(-limit)}
function validateSample(data){
 check(data?.format===SAMPLE&&[10,20].includes(data.sampleLimit)&&data.scope==='sample-'+data.sampleLimit&&data.importable===false&&['completed','failed','cancelled'].includes(data.status),'不是獨立十則測試檔');
 const ids=validateRaw({...data,format:FORMAT,status:'failed',scope:undefined,importable:undefined});
 check(data.rows.length<=data.sampleLimit,'測試超過十則');
 if(data.status==='completed')check(sampleReady(data.rows,data.evidence.bottomReached,data.evidence.topReached,data.sampleLimit)&&data.evidence.bottomStableMs>=3000&&data.evidence.continuity===true&&data.evidence.firstId===data.rows[0].id&&data.evidence.lastId===data.rows.at(-1).id&&!data.error&&(data.rows.length===data.sampleLimit||data.evidence.topStableMs>=8000),'測試缺少尾端或數量證據');
 return ids;
}
function validateClassification(raw,data,hash){
 const ids=validateRaw(raw);check(raw.status==='completed','未完成掃描不得當完整分類');
 check(data?.format===CLASS&&data.version===1&&data.chatId===raw.chatId&&data.sourceSha256===hash&&/^[a-f0-9]{64}$/.test(hash)&&Array.isArray(data.items),'分類檔與原始聊天版本不符');
 const seen=new Set();
 for(const item of data.items){
  check(item&&validId(item.id)&&!seen.has(item.id)&&categories.includes(item.category)&&typeof item.title==='string'&&item.title.trim()&&item.title.length<=300&&Array.isArray(item.messageIds)&&item.messageIds.length&&new Set(item.messageIds).size===item.messageIds.length&&item.messageIds.every(x=>ids.has(x)),'分類項目缺少有效原文證據');
  check(item.note===undefined||typeof item.note==='string'&&item.note.length<=3000,'分類說明過長或不符');
  check(Object.keys(item).every(k=>['id','category','title','messageIds','note'].includes(k)),'分類只能引用，不得覆蓋原始正文或夾帶未核對的分類欄位');
  seen.add(item.id);
 }
 return {items:data.items.length,covered:new Set(data.items.flatMap(i=>i.messageIds)).size,total:raw.rows.length};
}
// Navigation hints only; never a coverage or continuity proof. Bounds
// belong to one scrollHeight and are invalidated on virtualization growth.
// Original text is the search key. ID is the independent identity proof.
function anchorBudget(captureOnly=false){return {idleMs:captureOnly?8000:600000,hardMs:captureOnly?8000:3600000,traceLimit:5000,pollMs:500,stepMs:350}}
function anchorTextMatch(expected,rows,uniqueText){
 const role=expected.role==='assistant'?'assistant':'user';
 const users=rows.filter(r=>r.role===role);
 const exact=typeof expected.text==='string'&&expected.text.length?users.filter(r=>r.text===expected.text):[];
 const ids=users.filter(r=>r.id===expected.id);
 if(ids.length>1)return null;
 const id=ids[0];
 if(id)return {row:id,kind:expected.text===null?'id-only':id.text===expected.text?'text-and-id':'id-text-difference',identityVerified:true,textExact:expected.text===null?null:id.text===expected.text};
 // An identical unique nonempty original is an observation, not proof
 // that a changed native ID refers to the same message.
 if(role==='user'&&uniqueText&&exact.length===1)return {row:exact[0],kind:'text-only',identityVerified:false,textExact:true};
 return null;
}
// Direction uses only live message identity/order, never historical geometry.
// All moves are bounded relative scrolls; crossing a target is not a match.
function anchorTextDirection(targetIndex,indices,prior=-1){
 const known=indices.filter(Number.isInteger);
 if(known.length&&Math.max(...known)<targetIndex)return 1;
 if(known.length&&Math.min(...known)>targetIndex)return -1;
 return prior===1?1:-1;
}
function anchorRelativeDelta(client,direction){
 if(!Number.isFinite(client)||client<=0||![-1,1].includes(direction))throw Error('局部捲動參數不符');
 return direction*Math.max(1,Math.floor(client*.8));
}
function anchorLiveNavigation(target,indices,geometry,previous={}){
 const {top,height,client}=geometry;
 if(!Number.isInteger(target)||target<0||!Number.isFinite(top)||!Number.isFinite(height)||!Number.isFinite(client)||client<=0||height<client)throw Error('錨點定位參數不符');
 const max=Math.max(0,height-client),known=[...new Set(indices)].filter(Number.isInteger).sort((a,b)=>a-b);
 if(known.includes(target))return {found:true,top,height};
 let low=previous.height===height?previous.low:null,high=previous.height===height?previous.high:null;
 const min=known[0],maxIndex=known.at(-1);
 if(known.length&&min>target)high=Math.min(high??max,top);
 else if(known.length&&maxIndex<target)low=Math.max(low??0,top);
 else if(known.length)return {stop:true,reason:'可見序列跨過目標但沒有指定ID',height};
 // A rankless window is not an identity or a proven bound. Retreat toward
 // the last known bound rather than guessing that it belongs to the prefix.
 let destination;
 if(!known.length){
  if(low!==null&&high!==null)destination=(low+high)/2;
  else if(high!==null)destination=(top+high)/2;
  else if(low!==null)destination=(top+low)/2;
  else destination=max;
 }else if(low!==null&&high!==null&&high>low)destination=(low+high)/2;
 else{
  const earlier=min>target,delta=earlier?min-target:target-maxIndex;
  const step=Math.min(64*client,Math.max(client*.6,delta*client*.65));
  destination=top+(earlier?-step:step);
 }
 destination=Math.max(0,Math.min(max,destination));
 return {top:destination,height,low,high,knownMin:min??null,knownMax:maxIndex??null};
}
// Best observed rank is a navigation hint, not coverage. Preserve it
// across inter-window bottom returns; coordinates are always estimates.
function anchorLiveRecoveryHint(target,indices,geo,previous={},alternate=false){
 const normal=anchorLiveNavigation(target,indices,geo,previous.bounds||{});
 const valid=indices.filter(Number.isInteger),distance=valid.length?Math.min(...valid.map(i=>Math.abs(i-target))):Infinity;
 const closest=valid.find(i=>Math.abs(i-target)===distance);
 const prior=previous.best||null;
 const improved=Number.isFinite(distance)&&(!prior||distance<prior.distance);
 const best=improved?{top:geo.top,height:geo.height,index:closest,distance}:prior;
 const saved=best&&distance>best.distance?verifiedViewportAnchor(best,geo.top,geo.height,geo.client):null;
 if(!normal.found&&!normal.stop&&saved){
  return {...normal,top:rejoinTarget(saved,geo.height,geo.client,0,!alternate),best,improved,restore:true,bounds:{}};
 }
 return {...normal,best,improved,restore:false,bounds:normal};
}


 // Diagnostic navigation only. The caller must still match a live native ID.
 // Old rows supply rank, never historical pixel positions or continuity.
function anchorDiagnosticHint(target,indices,geo,previous={},maxScreens=24,repeat=0){
 const {top,height,client}=geo;
 check(Number.isFinite(top)&&Number.isFinite(height)&&Number.isFinite(client)&&client>0&&height>=client,'錨點定位參數不符');
 check(Number.isInteger(maxScreens)&&maxScreens>=1&&maxScreens<=64,'粗定位視窗數須為1至64');
 const max=Math.max(0,height-client),clamp=x=>Math.max(0,Math.min(max,x)),ranked=Number.isInteger(target)&&target>=0;
 const known=ranked?[...new Set(indices)].filter(i=>Number.isInteger(i)&&i>=0).sort((a,b)=>a-b):[];
 let direction=previous.direction===1?1:-1,mode='coarse',destination=top;
 const min=known[0],maxIndex=known.at(-1);
 const closest=known.reduce((a,i)=>a===null||Math.abs(i-target)<Math.abs(a-target)?i:a,null);
 const distance=closest===null?Infinity:Math.abs(closest-target);
 const improved=Number.isFinite(distance)&&(!previous.best||distance<previous.best.distance);
 const best=improved?{top,height,index:closest,distance}:previous.best||null;
 let restored=improved?false:!!previous.restored;
 // The bounds are valid only for this layout height. They are hints, not
 // proof of a gap, and are discarded when live observations contradict them.
 let low=previous.height===height?previous.low??null:null,high=previous.height===height?previous.high??null:null;
 if(known.length&&maxIndex<target){low=Math.max(low??0,top);direction=1}
 else if(known.length&&min>target){high=Math.min(high??max,top);direction=-1}
 if(low!==null&&high!==null&&low>=high){low=null;high=null}
 const straddle=known.length&&min<target&&maxIndex>target;
 const near=distance<=4||straddle;
 if(known.includes(target))return {top:clamp(top),height,mode:'live-rank-hit',direction,best,improved,restored,low,high};
 // A lost best live anchor may be restored once, not on every worse window.
 if(best&&!restored&&distance>best.distance&&(top>=max-6||!known.length)){
   const estimate=clamp(rejoinTarget(best,height,client));
   if(Math.abs(estimate-top)>client){destination=estimate;restored=true;mode='restore-live-best'}
 }
 if(mode!=='restore-live-best'){
   if(low!==null&&high!==null&&high-low>client*1.5&&repeat<2){destination=(low+high)/2;mode='rank-bracket'}
   else if(near||repeat>=2){
     // Alternate local probes only after reaching a near/repeated window.
     const step=client*(repeat>=2?Math.min(4,1+Math.floor(repeat/2)):.6);
     if(straddle||repeat>=3&&repeat%2===1)direction=-direction;
     destination=top+direction*step;mode='local-probe';
   }else{
     const screens=Number.isFinite(distance)?Math.min(maxScreens,Math.max(2,distance*.65)):maxScreens;
     destination=top+direction*client*screens;
   }
   // At an apparent top, first keep requesting older history. If it remains
   // unchanged, probe the opposite way; scrollTop=0 does not certify absence.
   if(clamp(destination)===clamp(top)&&repeat>=3&&max>0){direction=-direction;destination=top+direction*client*Math.min(maxScreens,repeat>=5?4:1);mode='edge-probe'}
 }
 return {top:clamp(destination),height,mode,direction,best,improved,restored,restore:mode==='restore-live-best',low,high};
}

return {anchorDiagnosticHint,anchorLiveNavigation,anchorLiveRecoveryHint,anchorBudget,anchorTextMatch,anchorTextDirection,anchorRelativeDelta,FORMAT,CLASS,COMPOSITE,SAMPLE,SAMPLE_LIMIT,VERSION,categories,isComposite,compositeId,validateCompositeEvidence,validateRows,mergeUp,isolateFrontierWindow,edgeProof,sourceId,validateRaw,validateClassification,validateSample,sampleReady,sampleRows,sampleLimit,chatTitle,withoutImages,compareRow,reconcileOverlap,rememberAttachmentObservations,fingerprint,scrollStep,noNewRows,scrollReset,scrollRecoveryTarget,frontierPosition,verifiedViewportAnchor,heightGrowthRejoinAnchor,breakthroughStep,scrollRange,minimumCount,fullCoverageGate,rejoinTarget,validateCheckpoint,pendingTailProof,resumeWindow,resumeSeed,resumeFrontierSeed,resumeStep,recoveryCycle,recoveryPolicy,clearRecoveryPolicy,alternateRecoveryPolicy,codeRenderEquivalent,bottomEscape,escapeStageCount,escapeStageTarget,escapeLanding};
});
