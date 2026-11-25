/* Independent ChatGPT reading archive. No Gal AI canonical import or network. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GalPredecessorChat=api})(globalThis,()=>{
'use strict';
const SAMPLE='gal-predecessor-chat-sample',SAMPLE_LIMIT=10,FORMAT='gal-predecessor-chat',CLASS='gal-predecessor-classification',VERSION=1;
const categories=['交接稿','茶話會','評語與自評','稱號與事故','規則與設定','輪迴補充','其他','Gal AI正史引用（不另收錄正文）','待確認'];
const check=(v,m)=>{if(!v)throw Error(m)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Blob URLs identify a temporary browser object, not durable attachment identity.
// Only image reference URLs on this exact origin may vary; compare all other
// fields strictly. Never infer equal bytes from equal labels or positions.
const transientImage=a=>a?.kind==='image-reference'&&typeof a.url==='string'&&/^blob:https:\/\/chatgpt\.com\/[0-9a-f-]{36}$/i.test(a.url);
function comparisonRow(r){return {...r,attachments:r.attachments.map(a=>transientImage(a)?{...a,url:'blob:chatgpt-image-reference'}:a)}}
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
 if(!context||context.currentOverflow||!Array.isArray(context.source)||!context.current||
    !/^[a-f0-9]{64}$/.test(context.sourceSha256||'')||
    previous.role!=='user'||current.role!=='user'||previous.id!==current.id||
    fields.length!==1||fields[0]!=='text'||!same(previous.attachments,current.attachments)||
    !current.text.trim()||previous.text!==current.text+'\n…')return null;
 if([...context.current.values()].some(x=>x.messageId===current.id))return null;
 const observation=context.source.find(x=>x.messageId===previous.id&&x.collapsed===true&&x.fullTextVerified===false&&
  /^(?:顯示較多|顯示更多|顯示全部|展開全文|Show more|Read more)$/i.test(x.label||'')&&
  x.removedSuffix==='\n'+x.label&&x.rawLength===previous.text.length+x.removedSuffix.length);
 if(!observation)return null;
 return {type:'folded-user-tail-variant',messageId:previous.id,fields:['text'],previous,current,sourceFoldObservation:observation,sourceSha256:context.sourceSha256,fullTextVerified:false};
}
function reconcileOverlap(previous,current,foldContext){
 const comparison=compareRow(previous,current);
 if(comparison.equal)return {...comparison,row:previous};
 const fold=foldedTailEvidence(previous,current,comparison.fields,foldContext);
 if(fold)return {equal:true,fields:[],row:previous,changes:[fold]};
 if(codeRenderEquivalent(previous,current,comparison.fields))return {equal:true,fields:[],row:previous,changes:[{type:'code-render-label-variant',messageId:previous.id,fields:comparison.fields,previous,current}]};
 if(comparison.fields.length!==1||comparison.fields[0]!=='attachments'||previous.role!=='user'||!previous.text.trim())return comparison;
 const images=a=>a.length>0&&a.every(x=>transientImage(x)&&x.label==='使用者附件')&&new Set(a.map(x=>x.url)).size===a.length;
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
 if(!appeared&&!disappeared&&!enriched&&!partial)return comparison;
 const type=appeared?'image-reference-appeared':disappeared?'image-reference-not-observed':enriched?'image-reference-subset-enriched':'image-reference-subset-not-observed';
 return {equal:true,fields:[],row:appeared||enriched?{...previous,attachments:current.attachments.slice()}:previous,changes:[{messageId:previous.id,type,previousAttachments:previous.attachments,currentAttachments:current.attachments,bytesVerified:false,attachmentCountVerified:false}]};
}
const sampleLimit=x=>x===true||x===10?10:x===20?20:0;
function chatTitle(value){const title=String(value||'').replace(/\s*[-–|]\s*ChatGPT\s*$/i,'').trim();return /^(?:ChatGPT|新對話|新聊天|New chat|New conversation)$/i.test(title)?'':title}
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=512;
function validateRows(rows){
 check(Array.isArray(rows),'訊息不是陣列');
 const ids=new Set();
 for(const r of rows){
  check(r&&validId(r.id)&&!ids.has(r.id)&&['user','assistant'].includes(r.role)&&typeof r.text==='string'&&Array.isArray(r.structure)&&Array.isArray(r.attachments)&&typeof r.identityBasis==='string'&&r.identityBasis&&r.identityBasis!=='position','訊息 ID、角色或內容格式不符');
  check(r.text.trim()||r.attachments.length,'空白訊息缺少可核對附件');
  check(r.structure.every(x=>x&&typeof x.tag==='string'&&typeof x.text==='string'),'格式記錄不符');
  check(r.attachments.every(x=>x&&typeof x.kind==='string'&&typeof x.label==='string'&&(x.url===null||typeof x.url==='string')),'附件參照格式不符');
  ids.add(r.id);
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
 if(typeof onChange==='function')for(const change of changes)onChange(change);
 return [...live.slice(0,first.i),...merged];
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
function validateRaw(data){
 check(data?.format===FORMAT&&!['sample-10','sample-20'].includes(data.scope)&&data.importable!==false&&data.version===VERSION&&data.canonical===false&&data.fidelity==='rendered-dom'&&['completed','failed','cancelled'].includes(data.status),'不是前輩聊天獨立保全 JSON');
 check(validId(data.runId)&&validId(data.title)&&data.chatId===sourceId(data.sourceUrl),'聊天標題或來源 ID 不符');
 const start=Date.parse(data.startedAt),end=Date.parse(data.finishedAt);
 check(Number.isFinite(start)&&Number.isFinite(end)&&end>=start,'掃描時間無效');
 const ids=validateRows(data.rows);check(data.rows.every((r,i)=>r.index===i)&&data.count===data.rows.length,'訊息索引／總數不符');
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
 if(data.status==='completed'&&data.evidence.resume){
  const q=data.evidence.resume;
  check(q.tailVerified===true&&q.frontierVerified===true&&q.baseCount>=2&&data.count>=q.baseCount&&/^[a-f0-9]{64}$/.test(q.sourceSha256),'續掃完成檔缺少原斷點及前沿核對證據');
 }
 return ids;
}
// Checkpoints are user-selected, previously preserved partial scans. Never
// treat their rows as newly read or accept a different branch or tail.
function validateCheckpoint(data,source){
 validateRaw(data);
 check(['failed','cancelled'].includes(data.status)&&data.count>=2,'請選擇至少兩則的未完成完整掃描保全檔');
 check(data.chatId===sourceId(source)&&new URL(data.sourceUrl).pathname.replace(/\/$/,'')===new URL(source).pathname.replace(/\/$/,''),'續掃來源不是目前聊天');
 const ev=data.evidence;
 check(ev.bottomReached===true&&ev.bottomStableMs>=3000&&ev.firstId===data.rows[0].id&&ev.lastId===data.rows.at(-1).id&&ev.windows>0,'斷點缺少底端或訊息邊界證據');
 check(ev.hostProof?ev.hostProof.maxRange>8&&ev.hostProof.observedMovement===true:Array.isArray(ev.scrollTrace)&&ev.scrollTrace.some(t=>scrollRange(t.scrollHeight,t.clientHeight)>8),'斷點缺少有效捲動證據');
 check(!String(data.error||'').startsWith('輸出核對失敗'),'斷點輸出驗證失敗');
 if(ev.resume)check(ev.resume.tailVerified&&ev.resume.frontierVerified,'前次續掃尚未核對前沿，請使用原始斷點');
 return data.rows.map(({index,...r})=>r);
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
function resumeStep(viewport,minIndex){return minIndex>12?Math.max(scrollStep(viewport,8),Math.floor(viewport*5)):0}
// Larger steps still require exact overlap.
const scrollStep=(height,unchanged=0)=>Math.max(24,Math.floor(height*(unchanged>=8?2.5:unchanged>=3?1.5:.85)));
// A virtualized chat may change height while jumping to its bottom.
 // A height-only shift is not a reset. For changed heights require a large
 // unexplained displacement AND a bottom landing. The adjusted coordinate
 // is only a recovery attempt; strict message overlap is still required.
function scrollRecoveryTarget(target,actual,height,expectedHeight,viewport){
 if(![target,actual,height,expectedHeight,viewport].every(Number.isFinite)||viewport<=0)return null;
 const max=Math.max(0,height-viewport),delta=height-expectedHeight,threshold=Math.max(32,viewport*.75);
 if(Math.abs(delta)<=2)return actual-target>threshold?Math.min(max,Math.max(0,target)):null;
 const adjusted=Math.min(max,Math.max(0,target+delta));
 const unexplained=actual-Math.max(target,adjusted);
 return Math.abs(actual-max)<=6&&unexplained>threshold?adjusted:null;
}
const scrollReset=(...args)=>scrollRecoveryTarget(...args)!==null;
// An accepted frontier is a coordinate hint, never a continuity proof.
function frontierPosition(frontier,height,viewport){
 if(!frontier||![frontier.top,frontier.height,height,viewport].every(Number.isFinite))return null;
 return Math.max(0,Math.min(height-viewport,frontier.top+height-frontier.height));
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
return {FORMAT,CLASS,SAMPLE,SAMPLE_LIMIT,VERSION,categories,validateRows,mergeUp,edgeProof,sourceId,validateRaw,validateClassification,validateSample,sampleReady,sampleRows,sampleLimit,chatTitle,compareRow,reconcileOverlap,fingerprint,scrollStep,noNewRows,scrollReset,scrollRecoveryTarget,frontierPosition,breakthroughStep,scrollRange,minimumCount,fullCoverageGate,rejoinTarget,validateCheckpoint,resumeWindow,resumeSeed,resumeStep,recoveryCycle,recoveryPolicy,clearRecoveryPolicy,alternateRecoveryPolicy,codeRenderEquivalent,bottomEscape,escapeStageCount,escapeStageTarget,escapeLanding};
});
