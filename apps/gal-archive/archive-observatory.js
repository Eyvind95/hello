/* Read-only health center and cross-cycle timeline. No database writes. */
(()=>{
'use strict';
const core=globalThis.ArchiveObservatoryCore,bridge=globalThis.ArchiveObservatoryBridge;
if(!core||!bridge)return;
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const num=value=>Number(value||0).toLocaleString('zh-TW');
const settings={mode:'health',world:'',cycle:'',level:'action',kind:'all',clock:'story',
 query:'',datedOnly:false,issueLimit:90,index:null};
let modal=null,buckets=new Map();
function labelWorld(id){return settings.index.worldLabels[id]||id||'未知世界觀'}
function getIndex(){
 settings.index=core.build(bridge.records(),{
  worlds:bridge.worlds(),storyTimeline:bridge.storyTimeline,
  dialogueAudit:bridge.dialogueAudit,galTimeContext:bridge.galTimeContext,
  parseStoryClock:bridge.parseStoryClock,parseEventClock:bridge.parseEventClock
 });
}
function options(value,title,current){
 return '<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(title)+'</option>';
}
function statCards(stats){
 return '<div class="ob-metrics">'+[
   ['輪迴',num(stats.cycles)],
   ['完整對話',num(stats.messages)+' 則'],
   ['已接事件',num(stats.acceptedEvents)+' 件'],
   ['待查異常',num(stats.errors+stats.warnings)+' 處']
  ].map(x=>'<div class="ob-metric"><strong class="ob-value">'+x[1]+'</strong><span class="ob-sub">'+x[0]+'</span></div>').join('')+'</div>';
}
function matchingCycles(){
 return settings.index.cycles.filter(c=>
  (!settings.world||settings.world===c.world)&&
  (!settings.cycle||settings.cycle===c.id));
}
function matchingIssues(){
 const allowed=new Set(matchingCycles().map(c=>c.id));
 return settings.index.issues.filter(issue=>allowed.has(issue.cycleId)&&
   (settings.level==='all'||settings.level==='action'&&issue.level!=='info'||issue.level===settings.level));
}
function setStatus(msg){const host=$('obStatus');if(host)host.textContent=msg}
function setup(){
 if(modal)return;
 modal=document.createElement('div');
 modal.id='archiveObservatoryModal';
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.setAttribute('aria-labelledby','obTitle');
 modal.hidden=true;
 modal.innerHTML='<div class="ob-shell">'+
  '<div class="ob-head"><div><div id="obTitle" class="ob-title"></div>'+
  '<div class="ob-sub">共用索引 · 唯讀檢查 · 不改寫正史或 Firebase</div></div>'+
  '<button class="btn small" type="button" id="obClose">✕ 關閉</button></div>'+
  '<div class="ob-scroll"><div class="ob-mode">'+
  '<button type="button" class="btn" data-ob-mode="health">🩺 正史健康檢查中心</button>'+
  '<button type="button" class="btn" data-ob-mode="timeline">🗓 全輪迴時間軸</button></div>'+
  '<div id="obFilters"></div><div class="ob-actions">'+
  '<button type="button" class="btn small" id="obRefresh">↻ 重新讀取本機正史</button>'+
  '<button type="button" class="btn small" id="obDownload">↓ 下載唯讀報告</button></div>'+
  '<p class="ob-note" role="status" id="obStatus">準備中…</p>'+
  '<div id="obResults"></div></div></div>';
 document.body.append(modal);
 $('obClose').onclick=close;
 modal.addEventListener('click',event=>{
   if(event.target===modal)close();
   else handleClick(event);
 });
 modal.addEventListener('change',handleChange);
 modal.addEventListener('input',event=>{
  if(event.target.id==='obQuery'){settings.query=event.target.value;renderResults()}
 });
 modal.addEventListener('toggle',event=>{
  const details=event.target;
  if(details.tagName!=='DETAILS'||!details.open)return;
  const id=details.dataset.obBucket;
  if(id&&details.querySelector('[data-ob-list="'+id+'"]')?.childElementCount===0)
   renderBucket(id);
 },true);
}
function open(mode){
 setup();settings.mode=mode==='timeline'?'timeline':'health';
 settings.cycle='';settings.query='';settings.issueLimit=90;
 getIndex();
 modal.hidden=false;
 render();
 $('obClose').focus({preventScroll:true});
}
function close(){if(modal)modal.hidden=true;buckets.clear()}
function filters(){
 const worlds=settings.index.worlds.length?settings.index.worlds:
   [...new Set(settings.index.cycles.map(x=>x.world))].map(id=>({id,name:id}));
 const choices=settings.index.cycles.filter(c=>!settings.world||c.world===settings.world);
 if(settings.cycle&&!choices.some(x=>x.id===settings.cycle))settings.cycle='';
 const shared='<div class="ob-filters">'+
  '<label>世界觀<select id="obWorld">'+options('','全部世界觀',settings.world)+
   worlds.map(x=>options(x.id,x.name,settings.world)).join('')+'</select></label>'+
  '<label>輪迴<select id="obCycle">'+options('','全部輪迴',settings.cycle)+
   choices.map(x=>options(x.id,x.title,settings.cycle)).join('')+'</select></label>';
 const health='<label>問題等級<select id="obLevel">'+
  options('action','錯誤＋提醒',settings.level)+
  options('error','只看錯誤',settings.level)+
  options('warning','只看提醒',settings.level)+
  options('info','僅資訊／疑似省略',settings.level)+
  options('all','所有種類',settings.level)+'</select></label>';
 const timeline='<label>時間種類<select id="obClock">'+
  options('story','Gal AI 劇情時間',settings.clock)+
  options('real','ChatGPT 現實發言時間',settings.clock)+'</select></label>'+
  '<label>內容種類<select id="obKind">'+
  options('all','全部對話＋已接事件',settings.kind)+
  options('event','只看已接事件',settings.kind)+
  options('me','只看玩家',settings.kind)+
  options('ai','只看 Gal AI',settings.kind)+'</select></label>'+
  '<label>搜尋全文<input id="obQuery" type="search" maxlength="200" value="'+esc(settings.query)+
   '" placeholder="角色、事件、片段…"></label>'+
  '<label style="display:flex;align-items:center;gap:7px">'+
  '<input id="obDatedOnly" type="checkbox" style="width:auto"'+(settings.datedOnly?' checked':'')+
   '>只看有此類時間的訊息</label>';
 $('obFilters').innerHTML=shared+(settings.mode==='health'?health:timeline)+'</div>';
}
function render(){
 $('obTitle').textContent=settings.mode==='health'?'正史健康檢查中心':'全輪迴時間軸';
 for(const b of modal.querySelectorAll('[data-ob-mode]'))
  b.setAttribute('aria-pressed',String(b.dataset.obMode===settings.mode));
 $('obDownload').textContent=settings.mode==='health'?'↓ 下載唯讀健康報告 JSON':
  '↓ 下載時間軸索引 JSON';
 filters();renderResults();
}
function renderResults(){
 if(!settings.index)return;
 if(settings.mode==='health')renderHealth();else renderTimeline();
}
function renderHealth(){
 const cycles=matchingCycles(),visible=new Set(cycles.map(x=>x.id));
 const issues=matchingIssues();
 const count={cycles:cycles.length,
  messages:cycles.reduce((sum,c)=>sum+(c.raw.messages||[]).length,0),
  acceptedEvents:cycles.reduce((sum,c)=>sum+c.accepted,0),
  errors:settings.index.issues.filter(x=>visible.has(x.cycleId)&&x.level==='error').length,
  warnings:settings.index.issues.filter(x=>visible.has(x.cycleId)&&x.level==='warning').length
 };
 const overview=cycles.map(c=>{
  const errors=c.issues.filter(x=>x.level==='error').length,
   warnings=c.issues.filter(x=>x.level==='warning').length;
  return '<div class="ob-cycle"><div><strong>'+esc(c.title)+'</strong>'+
   '<div class="ob-small">'+esc(labelWorld(c.world))+
   ' · 對話 '+num((c.raw.messages||[]).length)+' 則 · 已接事件 '+num(c.accept)+
   ' 件 · 有／無劇情時間 '+num(c.storyTimed)+'／'+num(c.untimed)+'</div></div>'+
   '<div class="ob-actions"><span class="ob-chip">'+num(errors)+' 錯誤 · '+num(warnings)+' 提醒</span>'+
   '<button class="btn small" type="button" data-ob-cycle="'+esc(c.id)+'">查看這一輪</button></div></div>';
 }).join('');
 const issueItems=issues.slice(0,settings.issueLimit).map(x=>{
  const sign=x.level==='error'?'🔴':x.level==='warning'?'🟠':'🔹';
  const jumpable=x.section==='opening'||x.section==='cycle'||Number.isInteger(x.rowIndex);
  return '<div class="ob-item ob-issue" data-level="'+esc(x.level)+'">'+
   '<div class="ob-row"><strong>'+sign+' '+esc(x.cycleTitle)+'</strong>'+
   '<span class="ob-small">'+esc(x.code)+'</span></div>'+
   '<div class="ob-snippet">'+esc(x.description)+'</div>'+
   (jumpable?'<div class="ob-actions"><button type="button" class="btn small"'+
    ' data-ob-jump="'+esc(x.cycleId)+'" data-ob-section="'+esc(x.section)+
    '" data-ob-index="'+(Number.isInteger(x.rowIndex)?x.rowIndex:-1)+'">'+
    (x.section==='opening'?'查看輪迴開場':x.section==='cycle'?'查看輪迴':'查看原文位置')+'</button></div>':'')+'</div>';
 }).join('');
 $('obResults').innerHTML=statCards(count)+
  '<p class="ob-note">沿用現有回合紅線、時間橘線與疑似省略檢查，增加重複 ID、空白內容、事件定位及時間標記摘要。所有異常都只是待核對線索，不會自動修改資料。</p>'+
  '<h3>輪迴檢查摘要</h3>'+
  (overview||'<div class="ob-placeholder">目前沒有這個範圍內的本機輪迴資料；請先在檔案館核對雲端合併狀態。</div>')+
  '<h3 style="margin-top:18px">待核對項目（'+num(issues.length)+'）</h3>'+
  '<div class="ob-list">'+(issueItems||'<div class="ob-placeholder">沒有符合目前篩選條件的異常，但不表示原生掃描已通過驗收。</div>')+'</div>'+
  (issues.length>settings.issueLimit?'<div class="ob-actions"><button type="button" class="btn" id="obMoreIssues">再顯示 90 項（尚有 '+
   num(issues.length-settings.issueLimit)+'）</button></div>':'')+
  '<p class="ob-note">資料來源只包含此瀏覽器已保存的輪迴。網站健康檢查不等於 WHIF 的 validation.ok 或 eventAudit.complete。</p>';
 setStatus('本次檢查 '+num(cycles.length)+' 個輪迴；待查錯誤 '+num(count.errors)+
  '、提醒 '+num(count.warnings)+'。未匯入的輪迴不會被當作通過。');
}
function renderTimeline(){
 const results=core.timelineGroups(settings.index,{
  world:settings.world,cycle:settings.cycle,kind:settings.kind,
  clock:settings.clock,query:settings.query,datedOnly:settings.datedOnly
 });
 buckets.clear();
 let html='',n=0;
 for(const group of results.groups){
  const total=group.days.reduce((sum,day)=>sum+day.items.length,0);
  html+='<section class="ob-cycle" style="display:block"><div class="ob-row">'+
   '<strong>'+esc(group.cycle.title)+'</strong>'+
   '<span class="ob-chip">'+num(total)+' 則</span></div>'+
   '<div class="ob-small">'+esc(labelWorld(group.cycle.world))+
   ' · 只在同一輪迴內依日期排序，不強行混合世界觀</div>';
  for(const day of group.days){
   const key='ob-bucket-'+(n++);
   buckets.set(key,day.items);
   html+='<details class="ob-day" data-ob-bucket="'+key+'"><summary>'+
    esc(day.day==='unknown'?'未標記這種時間（不推測）':day.day+'（台灣 UTC+8）')+
    ' · '+num(day.items.length)+' 則'+
    (day.eventCount?' · 已接事件 '+num(day.eventCount):'')+
    '</summary><div class="ob-day-list" data-ob-list="'+key+'"></div></details>';
  }
  html+='</section>';
 }
 const count={cycles:results.groups.length,messages:results.total,
  acceptedEvents:results.groups.reduce((sum,g)=>sum+g.days.reduce((n,d)=>n+d.eventCount,0),0),
  errors:0,warnings:0};
 $('obResults').innerHTML=statCards(count)+
  '<p class="ob-note">'+(settings.clock==='story'?
   '按各輪迴自己的 Gal AI 劇情日期分組；玩家與 Gal AI 只有存在可靠同回合時間時才會共用日期。':
   '只使用來源發言時間 sourceCreatedAt，不拿劇情時間、首次擷取或雲端接收時間來補。')+
   ' 不同世界觀的年份不代表同一條共同故事時間。點開日期查看逐則內容；每次最多載入 60 則。</p>'+
  (html||'<div class="ob-placeholder">沒有符合條件的已匯入正史。可以取消「只看有時間」或清除搜尋。</div>');
 setStatus('已索引 '+num(results.total)+' 則，分為 '+
  num(results.groups.reduce((sum,g)=>sum+g.days.length,0))+' 個日期群組。');
}
function renderBucket(key,offset=0){
 const host=modal.querySelector('[data-ob-list="'+key+'"]'),
  items=buckets.get(key);
 if(!host||!items)return;
 const end=Math.min(items.length,offset+60);
 const rows=items.slice(offset,end).map(item=>
  '<div class="ob-entry" data-kind="'+esc(item.kind)+'">'+
  '<div class="ob-row"><strong>'+
   esc(item.kind==='event'?'📨 '+item.title:item.title)+' · #'+(item.rowIndex+1)+
   '</strong><span class="ob-small">'+
    esc((settings.clock==='story'?item.storyTime:item.realTime)||'時間不詳')+
   '</span></div><div class="ob-snippet">'+esc(item.preview||'（空白）')+'</div>'+
   '<div class="ob-actions"><button class="btn small" type="button"'+
    ' data-ob-jump="'+esc(item.cycleId)+'" data-ob-section="chat"'+
    ' data-ob-index="'+item.rowIndex+'">跳至完整對話</button></div></div>').join('');
 host.querySelector('[data-ob-more]')?.remove();
 if(offset===0)host.innerHTML=rows;
 else host.insertAdjacentHTML('beforeend',rows);
 if(end<items.length)host.insertAdjacentHTML('beforeend',
  '<button type="button" class="btn" data-ob-more="'+key+'" data-ob-offset="'+end+'">再顯示 60 則（尚有 '+num(items.length-end)+'）</button>');
}
function handleChange(event){
 const target=event.target;
 if(target.id==='obWorld'){settings.world=target.value;settings.cycle='';render();return}
 if(target.id==='obCycle'){settings.cycle=target.value;renderResults();return}
 if(target.id==='obLevel'){settings.level=target.value;settings.issueLimit=90;renderResults();return}
 if(target.id==='obClock'){settings.clock=target.value;renderResults();return}
 if(target.id==='obKind'){settings.kind=target.value;renderResults();return}
 if(target.id==='obDatedOnly'){settings.datedOnly=target.checked;renderResults();return}
}
function handleClick(event){
 const b=event.target.closest('button');
 if(!b)return;
 if(b.dataset.obMode){settings.mode=b.dataset.obMode;render();return}
 if(b.id==='obRefresh'){getIndex();render();return}
 if(b.id==='obDownload'){download();return}
 if(b.id==='obMoreIssues'){settings.issueLimit+=90;renderResults();return}
 if(b.dataset.obCycle){settings.cycle=b.dataset.obCycle;render();return}
 if(b.dataset.obJump){
  const section=b.dataset.obSection==='events'?'events':
   b.dataset.obSection==='opening'?'opening':'chat';
  const index=Number(b.dataset.obIndex);
  close();
  bridge.jump(b.dataset.obJump,section,index);
  return;
 }
 if(b.dataset.obMore){renderBucket(b.dataset.obMore,Number(b.dataset.obOffset)||0)}
}
function download(){
 if(!settings.index)return;
 const allowed=new Set(matchingCycles().map(x=>x.id));
 const output=settings.mode==='health'?{
  format:'gal-archive-health-readonly',version:1,generatedAt:new Date().toISOString(),
  selection:{world:settings.world||null,cycle:settings.cycle||null,level:settings.level},
  cycles:settings.index.cycles.filter(x=>allowed.has(x.id)).map(c=>({
   id:c.id,title:c.title,world:c.world,messages:(c.raw.messages||[]).length,
   acceptedEvents:c.accepted,pendingEvents:c.pending,declinedEvents:c.rejected,
   issues:c.issues.length,red:c.auditCounts.red,orange:c.auditCounts.orange,
   storyTimed:c.storyTimed,untimed:c.untimed
  })),
  issues:matchingIssues(),
  note:'純讀取本機已儲存正史；不是 WHIF 原生掃描完整性驗收。'
 }:{
  format:'gal-archive-cross-cycle-timeline-readonly',version:1,generatedAt:new Date().toISOString(),
  selection:{world:settings.world||null,cycle:settings.cycle||null,
   timeDomain:settings.clock,kind:settings.kind,query:settings.query,
   datedOnly:settings.datedOnly},
  entries:core.filteredEntries(settings.index,{
   world:settings.world,cycle:settings.cycle,clock:settings.clock,kind:settings.kind,
   query:settings.query,datedOnly:settings.datedOnly
  }).map(x=>({cycleId:x.cycleId,cycleTitle:x.cycleTitle,world:x.world,
   rowIndex:x.rowIndex,entryId:x.entryId,type:x.kind,storyTime:x.storyTime,
   realTime:x.realTime,preview:x.preview})),
  note:'輪迴劇情時間互不混用，未知時間不捏造。'
 };
 const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download=settings.mode==='health'?'輪迴檔案館_健康檢查報告.json':'輪迴檔案館_全輪迴時間軸.json';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
 setStatus('已下載唯讀報告；沒有修改或同步任何正史。');
}
function install(){
 const health=$('archiveHealthOpen'),timeline=$('archiveTimelineOpen');
 if(!health||!timeline)return;
 health.addEventListener('click',()=>open('health'));
 timeline.addEventListener('click',()=>open('timeline'));
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&modal&&!modal.hidden)close();
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();
