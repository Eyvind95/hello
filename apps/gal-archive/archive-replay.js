/* Local-only recovery from complete, source-audited failed scans.
 * A replay is not a new live scan. Original failed files remain unchanged.
 */
(function(root,factory){
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.GalArchiveReplay=api;
 if(typeof document!=='undefined')api.mount(document,root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const assert=(ok,why)=>{if(!ok)throw Error(why)};
 const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const norm=s=>String(s??'').replace(/\s/gu,'');
 const empty=a=>Array.isArray(a)&&a.length===0;
 // Single-source rendered curly English quotes may become Chinese quotes.
 function playerQuoteProof(native,dom){
  const a=[...norm(native)],b=[...norm(dom)];
  if(a.length!==b.length)return false;
  let opened=-1,pairs=0;
  for(let i=0;i<a.length;i++){
   if(a[i]===b[i])continue;
   if(a[i]==='“'&&b[i]==='「'&&opened<0){opened=i;continue}
   if(a[i]==='”'&&b[i]==='」'&&opened>=0&&i>opened+1){opened=-1;pairs++;continue}
   return false;
  }
  return opened<0&&pairs>0;
 }
 const hash=str=>{let h1=2166136261,h2=0x811c9dc5;for(let i=0;i<str.length;i++){
  h1=Math.imul(h1^str.charCodeAt(i),16777619)>>>0;h2=Math.imul(h2^str.charCodeAt(i),2246822519)>>>0;
 }return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0')};
 // A private probe must prove the exact original event, not merely a scan index.
 function capturedEventProjection(cp,row,probe,core,options){
  const d=probe?.liveDetail,source=row.formatSource?.nativeReply,id=source?.messageId,t=cp.target;
  if(!core.isAdventureWorld(t.worldName)||!t.worldKey||!t.archiveKey||row.eventType!=='event'||source?.markerCount!==1||source.reason!=='available'||source.scannedText!==row.domText||source.text!==row.nativeText||source.eventEvidence?.sender!=='deg_event'||source.eventEvidence?.kind!=='event-message'||source.eventEvidence?.accepted!==true)return null;
  if(probe?.format!=='gal-ai-anchor-recovery-probe'||probe.version!==2||probe.forensicOnly!==true||probe.importable!==false||probe.reason||probe.source?.url!==cp.source.url||probe.input?.anchorId!==id||probe.scanRunId===cp.scanRunId||!probe.scanRunId||probe.scannerVersion!==probe.coreVersion||!/^0\.(?:9\.(?:1[2-9]|[2-9]\d|\d{3,})|[1-9]\d+\.\d+)$/.test(probe.scannerVersion))return null;
  if(!['cycleId','worldName','worldKey','cycleNumber','archiveKey'].every(k=>probe.target?.[k]===t[k])||d?.format!=='gal-ai-live-anchor-detail'||d.version!==1||d.forensicOnly!==true||d.importable!==false||d.complete!==true||!empty(d.missing)||d.scanRunId!==probe.scanRunId||d.scannerVersion!==probe.scannerVersion||d.coreVersion!==probe.coreVersion||d.sourceId!==id||row.sourceMessageId!==id||!['cycleId','worldName','worldKey','cycleNumber'].every(k=>d[k]===t[k]))return null;
  if(d.native?.reason!=='available'||d.native.text!==source.text||!eq(d.native.source,source.eventEvidence)||d.serialized?.text!==row.domText||d.serialized.length!==row.domText.length||d.serialized.hash!==hash(row.domText)||!eq(d.serialized.codeBlocks,row.formatSource.codeBlocks))return null;
  const stable=Array.isArray(probe.attempts)&&probe.attempts.some(a=>a.stable===true&&[a.before,a.after].every(s=>s?.state==='anchor-collected'&&s.anchorMarkerCount===1&&s.rawIds?.filter(x=>x===id).length===1&&s.rows?.filter(r=>r.sourceIds?.includes(id)).length===1&&s.rows.some(r=>eq(r.sourceIds,[id])&&r.role==='ai'&&r.eventType==='event'&&r.nativeReason==='available'&&r.textHash===d.serialized.hash&&r.textLength===d.serialized.length)));
  if(!stable)return null;
  const raw=source.text,lines=raw.split(/\r?\n/u),fence='\x60\x60\x60';
  const last=lines.findLastIndex(l=>l.trim());if(last<2)return null;
  const line=lines[last],tailMatch=line.match(/^[ \t]*\x60{3}([^\s`][^\r\n]*)$/u);
  if(!tailMatch)return null;
  const tail=tailMatch[1];if(d.tails?.length!==1)return null;
  const ta=d.tails[0];if(ta.line!==last+1||ta.text!==tail||ta.native!==true||!['markerText','markerInnerText','wrapperText','wrapperInnerText','boundaryText','serialized'].every(k=>ta[k]===false)||!empty(ta.matches))return null;
  const dom=d.dom;if(!dom?.marker||!dom.wrapper||!dom.boundary||typeof DOMParser!=='function')return null;
  const fields=[dom.marker.outerHTML,dom.marker.textContent,dom.marker.innerText,dom.wrapper.outerHTML,dom.wrapper.textContent,dom.wrapper.innerText,dom.boundary.html,dom.boundary.textContent,dom.boundary.rangeText,row.domText];
  if(fields.some(x=>typeof x!=='string'||!x.length||norm(x).includes(norm(tail))))return null;
  const parse=x=>new DOMParser().parseFromString(x,'text/html').body;
  const marker=parse(dom.marker.outerHTML),wrapper=parse(dom.wrapper.outerHTML),boundary=parse(dom.boundary.html);
  if(marker.children.length!==1||wrapper.children.length!==1||marker.firstElementChild.getAttribute('data-selection-copy-message-id')!==id||wrapper.firstElementChild.getAttribute('data-message-id')!==id||marker.textContent!==dom.marker.textContent||wrapper.textContent!==dom.wrapper.textContent||boundary.textContent!==dom.boundary.textContent||dom.boundary.rangeText!==dom.boundary.textContent)return null;
  const markerSelector='[data-selection-copy-message-id]';
  if(![marker,wrapper,boundary].every(b=>{const nodes=[...b.querySelectorAll(markerSelector)];return nodes.length===1&&nodes[0].getAttribute('data-selection-copy-message-id')===id&&nodes[0].textContent===dom.marker.textContent&&!norm(b.textContent).includes(norm(tail))}))return null;
  const selector='span.message-bubble-text.TemplatedText.font-mono';
  const boxes=[...marker.querySelectorAll(selector)],proof=row.formatSource.codeBlocks;
  if(!boxes.length||!Array.isArray(proof)||!eq(boxes.map(n=>n.textContent),proof)||![wrapper,boundary].every(b=>eq([...b.querySelectorAll(selector)].map(n=>n.textContent),proof)))return null;
  if(boxes.at(-1).nextSibling||boxes.at(-1).parentElement?.nextSibling)return null;
  // Only project the final, same-line suffix; all earlier fences must close.
  const projected=lines.map((l,i)=>i===last?l.slice(0,-tail.length):l).join('\n');
  const fences=projected.split('\n').filter(l=>l.trim().startsWith(fence));
  const blocks=[...projected.matchAll(/^[ \t]*\x60{3}[ \t]*\n([\s\S]*?)\n[ \t]*\x60{3}[ \t]*(?=\n|$)/gm)];
  if(fences.length!==2*boxes.length||blocks.length!==boxes.length||fences.some(l=>l.trim()!==fence))return null;
  if(!blocks.every((b,i)=>{const h=b[1].split('\n')[0],v=b[1].replace(/^\*\*([^*\n]+)\*\*/u,'$1');return norm(b[1])===norm(proof[i])||(/^\*\*[^*\n]+\*\*$/u.test(h)&&norm(v)===norm(proof[i]))}))return null;
  let result=core.compareNativeParagraphs(row.domText,projected,options);
  // Untimed event with one exact control template and a terminal system box.
  // Only remove the independently proven box delimiters, not any prose.
  if(result.text===null&&!core.parseGameTime(raw)&&!core.parseGameTime(row.domText)&&!core.adventureClockEvidence(raw)&&!core.adventureClockEvidence(row.domText)&&!core.isExplicitUnknownGameTime(raw)&&!core.isExplicitUnknownGameTime(row.domText)&&blocks.length===1&&blocks[0][1].startsWith('**系統對話框**\n')){
   const w=core.normalizedWorld(t.worldName),control='{{Below context is an event which has just occurred. '+w+' should not skip this moment — chime in naturally as '+w+' would react. This event is to make the story dynamic and fresh.}}';
   if(projected.startsWith(control+'\n')&&norm(projected.slice(control.length).replace(/^[ \t]*\x60{3}[ \t]*$/gm,''))===norm(row.domText))result={text:projected,comparison:{contentEqual:true,clockEqual:true,formatMarkers:[{kind:'exact-untimed-event-control-and-code-fences',tokens:3}]}};
  }
  if(result.text===null||result.comparison?.contentEqual!==true||result.comparison?.clockEqual!==true)return null;
  if((core.parseGameTime(raw)?.iso||null)!==(core.parseGameTime(row.domText)?.iso||null))return null;
  return {text:raw,comparison:{...result.comparison,contentEqual:true,clockEqual:true,renderProjection:{kind:'verified-whif-terminal-fence-tail-not-rendered',sourceId:id,probeRunId:probe.scanRunId,originalRun:cp.scanRunId,line:ta.line,tailLength:tail.length,nativeHash:hash(raw),domHash:hash(row.domText)},formatMarkers:[...(result.comparison.formatMarkers||[]),{kind:'verified-whif-terminal-fence-tail-not-rendered',tokens:1,nonWhitespaceChars:norm(tail).length}]}};
 }
 // Independent source-only traversal: replay the saved viewport overlap chain, not the checkpoint order.
 // Local evidence must prove the actual image node and every text fragment.
 function validNativeImageUrl(value){
  if(typeof value!=='string'||value.length>1000)return false;
  try{const u=new URL(value);return u.origin==='https://img.whif.io'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[A-Za-z0-9_-]+\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/(?:320|768)$/i.test(u.pathname)&&u.href===value}catch{return false}
 }
 function capturedPlayerImage(cp,row,a,proof,detail){
  const p=a.player,id=a.id;
  if(!detail||detail.sourceId!==id||detail.url!==cp.source.url||!Number.isFinite(Date.parse(detail.capturedAt))||!Number.isFinite(Date.parse(proof.generatedAt))||Date.parse(detail.capturedAt)<Date.parse(proof.generatedAt)||typeof DOMParser!=='function'||typeof detail.outerHTML!=='string'||detail.outerHTML.length>100000||typeof detail.textContent!=='string'||typeof detail.innerText!=='string'||!Array.isArray(detail.media)||detail.media.length!==1)return null;
  const doc=new DOMParser().parseFromString(detail.outerHTML,'text/html'),root=doc.body.firstElementChild;
  if(doc.body.children.length!==1||doc.body.textContent!==detail.textContent||root?.getAttribute('data-selection-copy-message-id')!==id||root.querySelector('[data-selection-copy-message-id]')||root.children.length!==1||root.querySelector('script,style,iframe,object,embed,svg,video,audio,[data-attachment-id]'))return null;
  const body=root.firstElementChild,parts=[...body.children],media=root.querySelectorAll('img');
  if(!body.matches('div.w-full.space-y-2')||media.length!==1||parts.length!==p.bodyParts+1||!parts[0].matches('div.flex.justify-end')||!parts[0].contains(media[0])||parts[0].textContent||!validNativeImageUrl(media[0].getAttribute('src'))||media[0].outerHTML!==detail.media[0])return null;
  const img=media[0],src=img.getAttribute('src'),srcset=img.getAttribute('srcset')||'';
  if(srcset.split(',').some(x=>{const m=x.trim().match(/^(\S+) (320|768)w$/);return !m||!validNativeImageUrl(m[1])||m[1].replace(/\/\d+$/,'')!==src.replace(/\/\d+$/,'')||!m[1].endsWith('/'+m[2])}))return null;
  const fragments=[];
  for(const part of parts.slice(1)){
   const spans=part.querySelectorAll('span.message-bubble-text.TemplatedText');
   if(!part.matches('div.flex.w-full.flex-col.justify-end')||spans.length!==1||part.querySelector('img')||part.textContent!==spans[0].textContent||!spans[0].textContent)return null;
   const span=spans[0],quoted=span.classList.contains('bg-bg-brand-primary-weak');
   if(span.children.length!==1||!span.firstElementChild.matches('span.z-10[dir="auto"]')||span.firstElementChild.children.length)return null;
   fragments.push({text:span.textContent,quoted});
  }
  const plain=fragments.map(x=>x.text).join(''),projected=fragments.map(x=>x.quoted?'「'+x.text+'」':x.text).join('');
  if(plain!==detail.textContent||fragments.map(x=>x.text).join('\n')!==detail.innerText||hash(norm(plain))!==p.bodyNormHash||p.markerNormHash!==p.bodyNormHash||norm(projected)!==norm(row.nativeText)||hash(row.nativeText)!==a.nativeHash)return null;
  return {kind:'verified-whif-player-image-reference',sourceId:id,scanIndex:row.scanIndex,url:src,capturedAt:detail.capturedAt,nativeHash:a.nativeHash,bodyNormHash:p.bodyNormHash,historySupplementRunId:proof.scanRunId,storage:'remote-reference-only'};
 }
 function verifyHistorySupplement(cp,proof,playerLabels,autoIndices,details=null,mediaDetails=[]){
  if(!proof||proof.format!=='gal-ai-history-source-proof'||proof.version!==1||proof.forensicOnly!==true||proof.importable!==false||proof.complete!==true||proof.reason||proof.scope!=='independent-live-source-inventory'||proof.scanRunId===cp.scanRunId||!proof.scanRunId||proof.scannerVersion!==proof.coreVersion||!/^0\.(?:9\.(?:1[4-9]|[2-9]\d|\d{3,})|[1-9]\d+\.\d+)$/.test(proof.scannerVersion)||proof.source?.url!==cp.source.url)return false;
  if(!['cycleId','cycleTitle','worldName','worldKey','cycleNumber','archiveKey'].every(k=>proof.target?.[k]===cp.target[k]&&cp.target[k]!==undefined))return false;
  const entries=proof.entries,windows=proof.windows;
  if(!Array.isArray(entries)||!entries.length||!Array.isArray(windows)||!windows.length||windows.length>12010||new Set(entries.map(r=>r.id)).size!==entries.length)return false;
  const map=new Map(entries.map(r=>[r.id,r])),order=[];
  for(const w of windows){
   if(w.stable!==true||!Array.isArray(w.ids)||!w.ids.length||new Set(w.ids).size!==w.ids.length||!eq(w.indices,w.ids.map(id=>map.get(id)?.index))||w.ids.some(id=>!map.has(id))||![w.top,w.height,w.clientHeight].every(Number.isFinite)||w.top<0||w.height<w.clientHeight||w.clientHeight<=0||w.top>w.height-w.clientHeight+3)return false;
   const start=order.length?order.indexOf(w.ids[0]):0;if(start<0)return false;
   const overlap=Math.min(order.length-start,w.ids.length);
   if(w.ids.slice(0,overlap).some((id,i)=>id!==order[start+i])||w.ids.slice(overlap).some(id=>order.includes(id)))return false;
   if(w.ids.length>overlap&&start+overlap!==order.length)return false;
   order.push(...w.ids.slice(overlap));
  }
  if(!eq(order,entries.map(r=>r.id))||entries.some((r,i)=>r.order!==i||!Number.isInteger(r.index)||(i>0&&r.index!==entries[i-1].index+1)||r.previousId!==(entries[i-1]?.id||null)||r.nextId!==(entries[i+1]?.id||null)))return false;
  const edge=(p,w,first)=>p?.stable===true&&p.waitedMs>=8000&&Array.isArray(p.checks)&&p.checks.length>=2&&p.checks[0].at===0&&p.checks.at(-1).at>=8000&&p.checks.every((s,i)=>Number.isFinite(s.at)&&(i===0||s.at>p.checks[i-1].at)&&s.top===w.top&&s.height===w.height&&s.clientHeight===w.clientHeight&&eq(s.ids,w.ids)&&(first?s.top<=2:s.height-s.clientHeight-s.top<=3));
  if(!edge(proof.firstProof,windows[0],true)||!edge(proof.lastProof,windows.at(-1),false)||!Array.isArray(proof.eventCards)||proof.eventCards.some(c=>c.kind!=='event-card'||!c.id||c.accepted===true))return false;
  const expected=[];
  for(const r of cp.rows){
   if(r.role==='ai'){
    const s=r.formatSource.nativeReply,e=s.eventEvidence;expected.push({id:s.messageId,kind:e.kind,sender:e.sender,accepted:e.accepted,raw:s.text,row:r});
   }else for(const s of r.formatSource.playerSources)expected.push({id:s.id,kind:s.kind,sender:s.sender,accepted:null,raw:s.nativeText,row:r});
  }
  if(expected.length!==entries.length)return false;
  const labels=new Map(playerLabels.map(l=>[l.i,l.label]));
  const playerIssues=[],labelProofIndices=[],imageProofs=[];
  for(let i=0;i<entries.length;i++){
   const a=entries[i],b=expected[i];
   if(a.id!==b.id||a.kind!==b.kind||a.sender!==b.sender||a.accepted!==b.accepted||a.nativeHash!==hash(b.raw)||a.nativeNormHash!==hash(norm(b.raw))||a.nativeLength!==b.raw.length)return false;
   if(a.sender==='user'){
    const p=a.player,idx=b.row.scanIndex;
    if(!p||p.ownerId!==a.id||!Number.isInteger(p.bodyParts)||p.bodyParts<1||typeof p.hasMedia!=='boolean'){playerIssues.push({scanIndex:idx,reason:'player-owner-or-body-unverified'});continue;}
    if(p.hasMedia){const matches=mediaDetails.filter(d=>d.sourceId===a.id);const image=matches.length===1?capturedPlayerImage(cp,b.row,a,proof,matches[0]):null;if(!image){playerIssues.push({scanIndex:idx,reason:'live-player-media-present'});continue;}imageProofs.push(image);}
    // Exact old prefix/body plus independently identical raw source. A live
    // label outside the player marker is a separate structural proof, not a
    // claim that Markdown rendering preserves literal native punctuation.
    if(labels.has(idx)){
     const label=labels.get(idx),prefix='**'+label+'**\n';
     const exactBody=p.bodyNormHash===a.nativeNormHash;
     const outsideLabel=eq(p.outsideLabelHashes,[hash(label)])&&/^[0-9a-f]{16}$/.test(p.bodyNormHash||'')&&p.bodyNormHash!==hash('')&&p.markerNormHash===p.bodyNormHash;
     if(!b.row.domText.startsWith(prefix)||norm(b.row.domText.slice(prefix.length))!==norm(b.raw)||(!exactBody&&!outsideLabel)){playerIssues.push({scanIndex:idx,reason:'player-label-projection-unverified'});continue;}
     labelProofIndices.push(idx);
    }
   }
  }
  const expectedAuto=autoIndices.map(i=>cp.rows[i].sourceMessageId);
  const derived=entries.filter((r,i)=>i>1&&['character','assistant'].includes(r.sender)&&['character','assistant'].includes(entries[i-1].sender)).map(r=>r.id);
  const autoOk=eq(derived,expectedAuto)&&eq(proof.autoContinueIds,derived);
  if(details)Object.assign(details,{orderedSourceProofOk:true,autoContinueOk:autoOk,playerIssues,labelProofIndices,imageProofs});
  return autoOk&&playerIssues.length===0&&imageProofs.length===mediaDetails.length;
 }

 function replay(cp,diag,state,core,evidence,probes=[],historyProof=null,mediaDetails=[]){
  assert(Array.isArray(mediaDetails)&&mediaDetails.length<=32&&new Set(mediaDetails.map(d=>d?.sourceId)).size===mediaDetails.length,'玩家圖片證據重複或超過限制');
  assert(core?.validate&&core?.compareNativeParagraphs&&evidence?.summarize&&core.version===evidence.version,'核心及格式模組未載入或版本不同，請強制更新');
  assert(cp?.format==='gal-ai-unverified-scan'&&cp.version===1&&cp.importable===false&&cp.validated===false&&cp.complete===false&&cp.forensicOnly===true&&cp.scope==='unverified-read-progress','只接受原始未驗證保全 JSON');
  const n=cp.rows?.length,run=cp.scanRunId,id=cp.target?.cycleId,version=cp.scannerVersion;
  assert(Number.isInteger(n)&&n>=3&&n<=20000&&cp.collectedCount===n&&cp.rawRows===n,'保全筆數不符');
  assert(typeof run==='string'&&run&&typeof id==='string'&&id&&cp.target.worldName&&cp.target.cycleTitle,'缺少批次或輪迴歸屬');
  const versionParts=x=>String(x||'').split('.').map(Number);
  const a=versionParts(version),b=versionParts(core.version);
  const noNewer=a.length===3&&b.length===3&&(a[0]<b[0]||a[0]===b[0]&&(a[1]<b[1]||a[1]===b[1]&&a[2]<=b[2]));
  assert(/^0\.(?:8\.(?:4[0-9]|[5-9]\d|\d{3,})|(?:9|[1-9]\d+)\.\d+)$/.test(version)&&version===cp.coreVersion&&noNewer,'不支援此舊版或更新版本保全');
  assert(diag?.scanRunId===run&&diag.cycleId===id&&diag.scope==='full'&&(diag.scannerVersion??diag.paragraphCheck?.scannerVersion)===version&&(diag.coreVersion??diag.paragraphCheck?.coreVersion)===version&&(!diag.version||diag.version===version)&&diag.trustedCount===n,'診斷與保全批次、版本或筆數不符');
  assert(state?.format==='gal-archive-scan-status'&&state.version===2&&state.scanRunId===run&&state.cycleId===id&&state.cycleTitle===cp.target.cycleTitle&&state.scannerVersion===version&&state.scope==='full'&&state.state==='failed'&&state.scanned===n&&state.unverifiedCount===n&&state.exportPending===false&&empty(state.pendingFiles)&&state.files?.unverified&&state.files?.diagnostic,'狀態檔不是同批次已完成保全的失敗終態');
  const url=new URL(cp.source?.url);
  assert(['https://www.whif.io','https://whif.io'].includes(url.origin)&&/^\/chat\/[^/]+\/?$/.test(url.pathname)&&url.href===url.origin+url.pathname&&state.source===url.href,'原始 WHIF 聊天來源不一致');
  const bottom=cp.bottomProof;
  assert(bottom?.stable===true&&bottom.reason==='stable'&&bottom.waitedMs>=8000&&bottom.collected===n&&Number.isFinite(bottom.initialScrollHeight)&&bottom.initialScrollHeight>0&&bottom.initialScrollHeight===bottom.finalScrollHeight&&eq(bottom,diag.bottomProof),'未到頁尾或缺少完整8秒穩定證明：禁止正式輸出');
  const early=cp.failedPhase==='integrity'&&diag.validationPhases?.integrity==='failed';
  const later=cp.failedPhase==='serialize'&&diag.validationPhases?.integrity==='passed'&&diag.validationPhases?.nativeFormatting==='failed';
  assert(cp.phase==='failure'&&diag.phase==='failure'&&cp.failedPhase===diag.failedPhase&&(early||later),'原批次未完成可重驗的掃描階段');
  assert(cp.phaseHistory?.some(x=>x.phase==='bottom-confirmed')&&eq(cp.phaseHistory,diag.phaseHistory)&&(early?cp.phaseHistory.some(x=>x.phase==='integrity'):cp.phaseHistory.some(x=>x.phase==='source-audit')&&cp.phaseHistory.some(x=>x.phase==='native-format')),'缺少一致的現場驗收階段紀錄');
  if(early)for(const k of ['worldName','worldKey','cycleNumber','archiveKey'])assert(cp.target[k]!==undefined&&cp.target[k]===diag[k]&&cp.target[k]===state[k],'世界觀或輪迴歸屬不一致：'+k);
  const ac=diag.autoContinueAudit,ps=ac?.playerSourceAudit,ev=diag.eventAudit;
  if(!early)assert(ac?.ok===true&&ac.notApplicable!==true&&ac.scannedRows===n&&empty(ac.problems)&&empty(ac.unknownMarkers)&&empty(ac.unaccountedAIOrEvents)&&eq(ps,diag.playerSourceAudit),'原批次缺少已通過的現場來源稽核');
  assert(ev&&eq(cp.eventAudit,ev)&&ev.unresolvedAccepted===0&&ev.unresolvedHeaders===0&&ev.unreadableHistoryMarkers===0&&empty(ev.unverifiedCards),'事件及歷史標記稽核未通過');
  assert(Array.isArray(probes)&&probes.length<=32&&new Set(probes.map(p=>p?.input?.anchorId)).size===probes.length,'局部證據重複或數量不符');
  const ids=new Set(),playerIds=new Set(),eventIndices=[],autoIndices=[],merged=[],playerQuoteRestored=[],playerLabels=[],sourceKinds=new Map();
  const addId=s=>{assert(typeof s==='string'&&s&&!ids.has(s),'原生來源 ID 重複或缺失');ids.add(s)};
  const rows=cp.rows.map((r,i)=>{
   assert(r.scanIndex===i&&['ai','me'].includes(r.role)&&typeof r.domText==='string'&&r.domText.trim()&&r.domText.length<=25000&&r.originalText===r.domText,'索引、身分或原始DOM文字異常：'+i);
   const fs=r.formatSource;
   if(r.role==='ai'){
    const native=fs?.nativeReply,e=native?.eventEvidence;
    assert(native?.reason==='available'&&native.markerCount===1&&r.nativeMarkerCount===1&&native.messageId===r.sourceMessageId&&native.scannedText===r.domText&&typeof native.text==='string'&&native.text.trim()&&native.text===r.nativeText&&native.text.length<=30000&&e?.messageId===native.messageId&&eq(e,r.sourceEvidence),'原生 AI／事件證據不完整：'+i);
    addId(native.messageId);sourceKinds.set(native.messageId,{kind:e.kind,sender:e.sender,scanIndex:i});
    if(r.eventType==='event'){
     assert(i>0&&e.kind==='event-message'&&e.accepted===true,'事件無已接取原生證明：'+i);eventIndices.push(i);
    }else assert(!r.eventType&&e.kind==='ordinary-message'&&(i===0?e.sender==='chapter'||e.sender==='character':e.sender==='character'||e.sender==='assistant'),'開場或普通AI來源身分不符：'+i);
    if(r.autoContinue===true)autoIndices.push(i);
   }else{
    const sources=fs?.playerSources;
    assert(!r.eventType&&!r.autoContinue&&!fs?.playerGapHasMedia&&Array.isArray(sources)&&sources.length>0&&eq(sources,r.playerSources),'玩家來源分界缺失：'+i);
    for(const s of sources){
     assert(s.sender==='user'&&s.kind==='ordinary-message'&&s.nativeReason==='available'&&s.nativeSender==='user'&&s.nativeMessageId===s.id&&s.hasText===true&&!s.hasMedia&&typeof s.nativeText==='string'&&s.nativeText.trim(),'玩家原文未驗證：'+i);
     addId(s.id);playerIds.add(s.id);sourceKinds.set(s.id,{kind:s.kind,sender:s.sender,scanIndex:i});
    }
    assert(r.nativeText===sources.map(s=>s.nativeText).join('\n\n'),'玩家原文來源不一致：'+i);
    if(norm(r.nativeText)!==norm(r.domText)){
     const label=early&&core.isAdventureWorld(cp.target.worldName)&&sources.length===1&&r.domText.match(/^\*\*([^*\n]{1,40})\*\*\n/u);
     if(label&&norm(r.domText.slice(label[0].length))===norm(r.nativeText))playerLabels.push({i,label:label[1]});
     else {assert(core.isAdventureWorld(cp.target.worldName)&&sources.length===1&&playerQuoteProof(r.nativeText,r.domText),'玩家原文與DOM不一致：'+i);playerQuoteRestored.push({i,native:r.nativeText});}
    }
    if(sources.length>1)merged.push({i,sources});
   }
   return {role:r.role,text:r.domText,eventType:r.eventType||null,worldName:r.worldName||null,autoContinue:r.autoContinue===true,formatSource:fs};
  });
  const playerRows=rows.filter(r=>r.role==='me').length,aiRows=n-playerRows-eventIndices.length-1;
  if(!early){
  assert(ac.observedNativeMarkers===ids.size&&ac.markerCountDifference===ids.size-n&&ac.observedUserMessages===playerIds.size&&ac.playerRows===playerRows&&ps?.originalUserMarkers===playerIds.size&&ps.renderedPlayerRows===playerRows&&ps.mappedNativeUserMarkers===playerIds.size&&ps.unmappedNativeUserMarkers===0&&ps.rowsWithoutProvenUserMarker===0&&ps.countDifference===playerIds.size-playerRows&&ps.rowsWithMultipleNativeUserSources===merged.length&&empty(ps.sourceInMultiplePlayerRows)&&empty(ps.linkedButNotObserved)&&empty(ps.unmappedNativeUserDetails)&&empty(ps.rowsWithoutProvenUserMarkerIndices),'玩家／歷史來源數量或唯一性不一致');
  assert(Array.isArray(ps.multipleNativeSourceDetails)&&ps.multipleNativeSourceDetails.length===merged.length&&(!merged.length||ps.safeSourceMerge===true),'玩家多來源未完整證明');
  for(const {i,sources} of merged){
   const d=ps.multipleNativeSourceDetails.find(x=>x.scanIndex===i);
   assert(d?.contentProof?.ok===true&&d.nativeUserSourceCount===sources.length&&eq(d.sourceHashes,sources.map(s=>hash(s.id)))&&d.previousAiSourceHash===hash(cp.rows[i-1]?.sourceMessageId||'')&&d.nextAiSourceHash===hash(cp.rows[i+1]?.sourceMessageId||''),'多來源玩家證據不一致：'+i);
  }
  }
  assert(eq(early?diag.autoContinueCandidates:ac.candidateIndices,autoIndices)&&(early||Array.isArray(ac.gaps)&&ac.gaps.length===autoIndices.length),'自動繼續來源清單不符');
  for(const i of autoIndices){
   const prev=rows[i-1],curr=rows[i],p=prev?.formatSource?.nativeReply,c=curr.formatSource.nativeReply,g=curr.formatSource.playerGap,a=ac?.gaps?.find(x=>x.scanIndex===i);
   assert(i>=2&&prev.role==='ai'&&!prev.eventType&&!curr.eventType&&p.messageId!==c.messageId&&g?.previousId===p.messageId&&g.currentId===c.messageId&&g.previous==='character'&&g.current==='character'&&empty(g.markers)&&g.loading===false&&(early||a?.ok===true&&empty(a.errors)&&a.previousSourceHash===hash(p.messageId)&&a.currentSourceHash===hash(c.messageId)&&a.bothOrdinary===true&&a.noGapMarkers===true&&a.notLoading===true),'自動繼續證據不完整：'+i);
  }
  assert(ev.historyMarkersObserved===ids.size&&ev.exportedEvents===eventIndices.length&&(early?Number.isInteger(ev.ordinaryAiTotal)&&ev.ordinaryAiTotal<=aiRows&&ev.ordinaryAiTotal>=0&&ev.ordinaryAiVerified===ev.ordinaryAiTotal:ev.ordinaryAiTotal===aiRows&&ev.ordinaryAiVerified===aiRows)&&ev.headerCandidates===eventIndices.length&&Array.isArray(ev.headers)&&eq(ev.headers.map(x=>x.scanIndex).sort((a,b)=>a-b),eventIndices)&&ev.headers.every(x=>x.classified===true)&&Array.isArray(ev.nativeCandidates),'事件數量或標頭不一致');
  const accepted=ev.nativeCandidates.filter(x=>x.accepted===true);
  assert(accepted.length===eventIndices.length&&ev.nativeCandidates.every(x=>x.accepted===true||x.accepted===false)&&eventIndices.every(i=>accepted.some(x=>x.scanIndex===i&&x.reason==='classified-event'&&x.sourceRef===hash(cp.rows[i].sourceMessageId))),'事件原生ID或接取證據不完整');
  const v=core.validate(rows,cp.target.worldName);
  assert(v.ok&&empty(v.errors)&&v.messages.length+v.events.length+1===n&&v.pairs===playerRows&&v.autoContinues===autoIndices.length&&eq(v.events.map(x=>x.scanIndex),eventIndices),'新版完整性重驗失敗：'+v.errors?.slice(0,5).join('；'));
  assert(!playerLabels.length||playerLabels.length===playerRows&&new Set(playerLabels.map(x=>x.label)).size===1,'玩家標題投影不一致：需要獨立正文證據');
  const manifest=diag.historySourceManifest;
  // Independent live identity inventory is required for promotion. Counts alone cannot prove identity.
  const manifestOk=early&&eq(cp.historySourceManifest,manifest)&&Array.isArray(manifest)&&manifest.length===ids.size&&new Set(manifest.map(x=>x.id)).size===ids.size&&manifest.every(m=>{const r=sourceKinds.get(m.id);return r&&m.kind===r.kind&&m.sender===r.sender&&eq(m.playerRows,r.sender==='user'?[r.scanIndex]:[])})&&!merged.length&&!playerLabels.length;
  const supplementDetails={orderedSourceProofOk:false,autoContinueOk:false,playerIssues:[],labelProofIndices:[]};
  const supplementOk=early&&!merged.length&&verifyHistorySupplement(cp,historyProof,playerLabels,autoIndices,supplementDetails,mediaDetails);
  const sourceAuditOk=(!early||manifestOk||supplementOk)&&(!mediaDetails.length||supplementOk);
  const checks=[],restored=[],opening={role:'ai',scanIndex:0,text:v.opening,gameTime:core.parseGameTime(v.opening)?.iso||null};
  for(const entry of [opening,...v.messages.filter(x=>x.role==='ai'),...v.events]){
   const r=rows[entry.scanIndex],fs=r.formatSource,source=fs.nativeReply,event=r.eventType==='event';
   const opts={worldName:cp.target.worldName,source:event?'whif-event-content':'whif-message-content',event,opening:entry.scanIndex===0,eventTitle:event?entry.title:undefined,chapterTitle:source.chapterTitle,statusText:fs.statusText,codeBlocks:fs.codeBlocks,verifiedUntimedNative:entry.verifiedUntimedNative===true,allowInvalidNativeDate:!!entry.nativeInvalidDateEvidence};
   let result=core.compareNativeParagraphs(entry.text,source.text,opts);
   if(result.text===null&&event){
    const probe=probes.find(p=>p?.input?.anchorId===source.messageId);
    const fixed=probe?capturedEventProjection(cp,cp.rows[entry.scanIndex],probe,core,opts):null;
    if(fixed){result=fixed;restored.push({scanIndex:entry.scanIndex,gameTime:entry.gameTime||null,...fixed.comparison.renderProjection});}
   }
   const ok=entry.text===source.scannedText&&result.text!==null&&result.comparison?.contentEqual===true&&result.comparison?.clockEqual===true;
   checks.push({check:{scanIndex:entry.scanIndex,reason:ok?(entry.text===result.text?'source-matched-no-change':'applied'):'content-or-clock-not-proven',source:ok?'whif-message-content':'rendered-dom',comparison:result.comparison}});
   if(ok)entry.text=result.text;
  }
  const audit=evidence.summarize(rows,checks,core,v.ok);
  const report={format:'gal-archive-offline-revalidation',version:1,scanRunId:run,cycleId:id,originalScannerVersion:version,coreVersion:core.version,rawRows:n,integrityOk:v.ok,bottomProof:bottom,sourceAuditOk,sourceAuditMethod:early?(supplementOk?'independent-live-source-supplement':manifestOk?'independent-saved-history-id-inventory':'saved-row-local-proof-only'):'original-live-audit',pairs:v.pairs,events:v.events.length,autoContinues:v.autoContinues,playerRows,uniqueNativeIds:ids.size,playerLabelIndices:playerLabels.map(x=>x.i),restoredRenderTails:restored,sourceAuditBlockers:sourceAuditOk?[]:['原批次未保存完整獨立歷史ID／玩家對應清單，或缺少玩家標題投影證據；禁止正式重建'],nativeFormatAudit:{checked:audit.checkedNativeRows,verified:audit.verifiedNativeRows,failed:audit.failedNativeRows,complete:audit.nativeFormatComplete},failedIndices:audit.failures.map(x=>x.scanIndex),warnings:v.warnings,importable:false,method:early?'saved-complete-early-failure-revalidation':'saved-complete-source-audited-batch'};
  report.historySupplementDetails=supplementDetails;
  if(!sourceAuditOk&&supplementDetails.orderedSourceProofOk&&supplementDetails.playerIssues.length)report.sourceAuditBlockers=supplementDetails.playerIssues.map(x=>'原生索引 '+x.scanIndex+'：'+(x.reason==='live-player-media-present'?'即時玩家節點含媒體，須局部核對':'玩家來源或外部標籤證據不符'));
  if(!audit.nativeFormatComplete||!sourceAuditOk)return {report,canonical:null};
  for(const {i,sources} of merged){
   const entry=v.messages.find(x=>x.scanIndex===i&&x.role==='me');
   assert(entry,'多來源玩家未出現在正式回合');
   entry.text=sources.map(s=>s.nativeText).join('\n\n');
   entry.nativeUserSegments=sources.map((s,position)=>({position,sourceIdHash:hash(s.id),text:s.nativeText}));
  }
  if(supplementOk)for(const {i} of playerLabels){const entry=v.messages.find(m=>m.scanIndex===i&&m.role==='me');assert(entry,'玩家標題對應不存在');entry.text=cp.rows[i].nativeText;}
  for(const {i,native} of playerQuoteRestored){
   const entry=v.messages.find(x=>x.scanIndex===i&&x.role==='me');
   assert(entry,'玩家引號來源未出現在正式回合');
   entry.text=native;
  }
  report.playerQuoteRestoredIndices=playerQuoteRestored.map(x=>x.i);
  const path=url.origin+url.pathname,chatKey=(hash(path)+hash(path+'|Gal AI')).slice(0,32);
  const build=(entry,i,kind)=>{
   const sourceEventId='galnative-'+hash(path+'|'+i+'|'+kind);
   return {id:sourceEventId,role:entry.role,text:entry.text,gameTime:entry.gameTime||null,sourceEventId,sourcePartIndex:0,chatKey,messageOrder:entry.scanIndex,scanIndex:entry.scanIndex,sourceKind:'gal-ai-native',sourceSite:url.origin};
  };
  const messages=v.messages.map((m,i)=>{const row=build(m,i,'message');
   if(m.verifiedUntimedNative)row.nativeClockEvidence='verified-original-without-game-time';
   if(m.nativeInvalidDateEvidence){row.nativeClockEvidence='verified-original-invalid-calendar-date';row.nativeInvalidDateEvidence=m.nativeInvalidDateEvidence;row.nativeSourceMessageId=m.nativeInvalidDateEvidence.sourceMessageId;}
   if(m.nativePairedInvalidDate)row.nativePairedInvalidDate=m.nativePairedInvalidDate;
   if(m.nativeUserSegments){row.nativeUserSegments=m.nativeUserSegments;row.nativeUserMergeVerified=true}
   const image=supplementOk?supplementDetails.imageProofs?.find(x=>x.scanIndex===m.scanIndex):null;
   if(image)row.nativeImageReferences=[image];
   return row;
  });
  v.messages.forEach((m,i)=>{if(m.autoContinue)messages[i].autoContinue={kind:'whif-adjacent-character-replies',previousSourceEventId:messages[i-1].sourceEventId}});
  const events=v.events.map(e=>({...build(e,e.scanIndex,'event'),role:'ai',status:'accepted',title:e.title,worldName:e.worldName||null}));
  assert(new Set([...messages,...events].map(x=>x.id)).size===n-1,'正式 ID 重複');
  const canonical={format:'gal-ai-authoritative-scan',version:1,generatedAt:new Date().toISOString(),scope:'entire-opening-to-bottom',source:{url:path,origin:url.origin,path:url.pathname,gameClockOnly:true,...(core.isRoadWorld(cp.target.worldName)?{gameClockProfile:'road',gameClockEncoding:core.ROAD_CLOCK_ENCODING}:{})},target:{...cp.target,uid:'',manager:'',managerNames:[]},opening:opening.text,messages,events,rawRows:n,scanRunId:run,scannerVersion:version,coreVersion:core.version,readOnlyUntilImported:true,
   validation:{ok:true,integrityOk:true,nativeFormatComplete:true,pairs:v.pairs,events:events.length,autoContinues:v.autoContinues,openingChars:opening.text.length,gameTimeCount:messages.filter(m=>!!m.gameTime).length,unknownGameTimeCount:v.unknownGameTimeCount||0,verifiedUntimedCount:v.verifiedUntimedCount||0,invalidDateReplyCount:v.invalidDateReplyCount||0,invalidDateRowCount:v.invalidDateRowCount||0,warnings:v.warnings,errors:[]},
   nativeFormatAudit:report.nativeFormatAudit,eventAudit:{...ev,...(early&&sourceAuditOk?{ordinaryAiTotal:aiRows,ordinaryAiVerified:aiRows,historyMarkersObserved:ids.size}:{}),complete:true,zeroEventAssessment:events.length?'not-zero':'no-accepted-event-in-observed-history'},offlineRecovery:{method:report.method,originalScannerVersion:version,originalFailure:cp.failedPhase,coreVersion:core.version,originalRun:run,liveRescan:false,sourceAuditReused:!early,sourceAuditMethod:report.sourceAuditMethod,restoredRenderTails:restored,bottomProof:bottom},note:'由完整保全及同批次現場來源稽核離線重驗產出；並非重新實機掃描。匯入前仍須核對目標輪迴、預覽與備份。'};
  if(supplementOk)canonical.offlineRecovery.historySupplementRunId=historyProof.scanRunId;
  if(early)canonical.offlineRecovery.originalEventAuditCounts={ordinaryAiTotal:ev.ordinaryAiTotal,ordinaryAiVerified:ev.ordinaryAiVerified};
  report.canonicalAvailable=true;
  return {report,canonical};
 }
 function mount(doc,host){
  const $=id=>doc.getElementById(id),modal=$('archiveReplayModal');
  if(!modal)return;
  let result=null,ticket=0;
  const fields=['archiveReplayRaw','archiveReplayDiag','archiveReplayState'];
  const status=t=>$('archiveReplayStatus').textContent=t;
  const clear=()=>{ticket++;result=null;$('archiveReplayDownload').disabled=true;$('archiveReplayReport').disabled=true;$('archiveReplayRun').disabled=false};
  const reset=()=>{clear();fields.forEach(id=>$(id).value='');if($('archiveReplayProbes'))$('archiveReplayProbes').value='';if($('archiveReplayHistory'))$('archiveReplayHistory').value='';status('選擇同一次掃描的三份 JSON；只在此瀏覽器處理，不匯入、不上傳。')};
  $('archiveReplayOpen').onclick=()=>{reset();modal.classList.remove('hidden')};
  $('archiveReplayClose').onclick=()=>{reset();modal.classList.add('hidden')};
  fields.forEach(id=>$(id).onchange=()=>{clear();status('檔案已變更，請重新驗收。')});
  if($('archiveReplayProbes'))$('archiveReplayProbes').onchange=()=>{clear();status('局部證據已變更，請重新驗收。')};
  if($('archiveReplayHistory'))$('archiveReplayHistory').onchange=()=>{clear();status('歷史來源補證已變更，請重新驗收。')};
  $('archiveReplayRun').onclick=async()=>{
   clear();const t=ticket;$('archiveReplayRun').disabled=true;
   status('正在讀取並核對保全、診斷及狀態…');
   let inputHashes=[],replayRunId=null;
   try{
    const files=fields.map(id=>$(id).files?.[0]);
    const probeFiles=[...($('archiveReplayProbes')?.files||[])];
    const historyFile=$('archiveReplayHistory')?.files?.[0];if(historyFile)assert(historyFile.size<=20*1024*1024,'歷史來源補證超過限制');
    assert(probeFiles.length<=32&&probeFiles.every(f=>f.size<=20*1024*1024),'局部證據超過限制');
    assert(files.every(Boolean),'請選齊三份 JSON');
    assert(files.every((f,i)=>f.size<=(i===0?100:20)*1024*1024),'檔案超過安全大小限制');
    const [cp,diag,state]=await Promise.all(files.map(async f=>JSON.parse(await f.text())));
    if(t!==ticket)return;
    const localDetails=await Promise.all(probeFiles.map(async f=>JSON.parse(await f.text())));
    const mediaDetails=localDetails.filter(p=>p&&typeof p.sourceId==='string'&&Array.isArray(p.media)&&typeof p.outerHTML==='string');
    const probes=localDetails.filter(p=>!mediaDetails.includes(p));
    const historyProof=historyFile?JSON.parse(await historyFile.text()):null;
    inputHashes=await Promise.all([...files,...probeFiles,...(historyFile?[historyFile]:[])].map(async f=>({name:f.name,bytes:f.size,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')})));
    if(t!==ticket)return;
    replayRunId=crypto.randomUUID();
    result=replay(cp,diag,state,host.GalArchiveCore,host.GalArchiveFormatEvidence,probes,historyProof,mediaDetails);Object.assign(result.report,{replayRunId,inputHashes});
    if(result.canonical)Object.assign(result.canonical.offlineRecovery,{replayRunId,inputHashes});
    const r=result.report;
    // Run the ordinary site's own import gate before enabling download.
    // Do not mutate current cycle or start an import here.
    if(result.canonical&&typeof host.galNativeVerify==='function'&&typeof host.current==='function'){
     const current=host.current();
     if(current?.id===cp.target.cycleId){
      const gate=host.galNativeVerify(result.canonical,current);
      assert(!gate.fail.length,'網站正式匯入檢查未通過：'+gate.fail.slice(0,4).join('；'));
     }
    }
    $('archiveReplayDownload').disabled=!result.canonical;
    $('archiveReplayReport').disabled=false;
    status((result.canonical?'✅ 離線驗收通過，可下載正式正史':'⛔ 驗收或來源證據仍不足，不可匯入')+'\n輪迴：'+cp.target.cycleTitle+'\n原始版本：'+r.originalScannerVersion+' → 重驗核心：'+r.coreVersion+'\n完整資料：'+r.rawRows+' 筆\n原生格式：'+r.nativeFormatAudit.verified+'/'+r.nativeFormatAudit.checked+'\n警告：'+r.warnings.length+' 項\n'+(r.failedIndices.length?'異常索引：'+r.failedIndices.join('、')+'\n':'')+(r.sourceAuditBlockers||[]).join('；')+'\n不會修改本機正史或 Firebase。');
   }catch(e){if(t===ticket){result={canonical:null,report:{format:'gal-archive-offline-revalidation',importable:false,replayRunId,inputHashes,error:String(e.message||e)}};$('archiveReplayReport').disabled=false;status('⛔ '+String(e.message||e)+'\n原檔不變，禁止正式輸出。')}}
   finally{if(t===ticket)$('archiveReplayRun').disabled=false}
  };
  const download=(obj,name)=>{const a=doc.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  $('archiveReplayDownload').onclick=()=>{if(result?.canonical)download(result.canonical,'Gal_AI_離線重驗正史_'+result.canonical.target.cycleTitle+'.json')};
  $('archiveReplayReport').onclick=()=>{if(result?.report)download(result.report,'保全資料重驗診斷_'+(result.report.replayRunId||'failed')+'.json')};
 }
 // Read-only compatibility for old inline contexts and new indexed contexts.
 function expandErrorContexts(data){
  const contexts=data?.errorContexts??data?.errors??[];
  if(!Array.isArray(contexts))throw Error('錯誤診斷不是陣列');
  const table=data?.errorContextEvidence;
  if(!table)return contexts;
  if(table.format!=='gal-error-context-refs'||table.version!==1||!Array.isArray(table.rows))throw Error('錯誤診斷引用格式無效');
  const rows=new Map();
  for(const row of table.rows){
   if(!Number.isInteger(row?.scanIndex)||row.scanIndex<0||rows.has(row.scanIndex))throw Error('錯誤診斷來源索引無效或重複');
   rows.set(row.scanIndex,row);
  }
  const resolve=ref=>{
   if(ref===null)return null;
   const row=rows.get(ref?.scanIndex);
   if(!row||row.sourceMessageId!==ref.sourceMessageId)throw Error('錯誤診斷來源引用缺漏或不一致');
   return row;
  };
  return contexts.map(issue=>({...issue,message:resolve(issue.message),context:issue.context.map(resolve)}));
 }
 return {replay,mount,hash,capturedEventProjection,verifyHistorySupplement,capturedPlayerImage,validNativeImageUrl,expandErrorContexts};
});
