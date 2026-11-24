/* Gal Archive observatory: shared, read-only health and timeline index. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.ArchiveObservatoryCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const str=x=>typeof x==='string'?x:'';
 const arrays=x=>Array.isArray(x)?x:[];
 const kinds=new Set(['me','ai']);
 const validDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
 const storyDay=ms=>new Date(ms+8*3600*1000).toISOString().slice(0,10);
 const displayTime=ms=>new Date(ms).toLocaleString('zh-TW',{
   timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',minute:'2-digit',hour12:false});
 function fallbackStory(record){
   return [
    ...arrays(record.messages).map((entry,index)=>({entry,index,type:'message'})),
    ...arrays(record.events).map((entry,index)=>({entry,index,type:'event'}))
      .filter(row=>row.entry?.status==='accepted')
   ];
 }
 function issue(code,level,cycle,rowIndex,description,section='chat'){
   return {id:cycle.id+':'+code+':'+(rowIndex??'cycle'),code,level,cycleId:cycle.id,
    world:cycle.world,cycleTitle:cycle.title||'未命名輪迴',
    rowIndex:Number.isInteger(rowIndex)?rowIndex:null,section,description};
 }
 function ord(cycle){
   const match=str(cycle.title).match(/第\s*(\d+)\s*(?:周目|週目|輪迴|周|週)/);
   const n=match?Number(match[1]):Number(cycle.number);
   return Number.isInteger(n)&&n>=0?n:null;
 }
 function compareCycles(a,b){
   if(a.world!==b.world)return str(a.world).localeCompare(str(b.world),'zh-Hant');
   const nA=ord(a),nB=ord(b);
   if(nA!==null&&nB!==null&&nA!==nB)return nA-nB;
   if(nA!==null)return -1;
   if(nB!==null)return 1;
   return str(a.title).localeCompare(str(b.title),'zh-Hant');
 }
 function build(records,config={}){
   const cycles=[],issues=[],entries=[];
   const worlds=arrays(config.worlds).map(w=>({id:w.id,name:w.name||w.id}));
   const worldLabels=new Map(worlds.map(w=>[w.id,w.name]));
   const worldOrder=new Map(worlds.map((w,i)=>[w.id,i]));
   for(const raw of arrays(records).filter(r=>r&&typeof r==='object')){
     const c={id:str(raw.id),world:str(raw.world),title:str(raw.title)||'未命名輪迴',
       hero:str(raw.hero),partner:str(raw.partner),count:0,accepted:0,pending:0,
       rejected:0,untimed:0,storyTimed:0,realTimed:0,issues:[],entries:[],number:ord(raw),
       openingPresent:Boolean(str(raw.opening).trim()),raw};
     cycles.push(c);
     const msgs=arrays(raw.messages),evs=arrays(raw.events);
     const add=(code,level,idx,description,section='chat')=>{
       const x=issue(code,level,c,idx,description,section);c.issues.push(x);issues.push(x);return x;
     };
     if(!c.id)add('missing-cycle-id','error',null,'輪迴缺少唯一 ID','cycle');
     if(!raw.title||!str(raw.title).trim())add('missing-title','warning',null,'輪迴沒有名稱','cycle');
     if((msgs.length||evs.length)&&!c.openingPresent)
       add('missing-opening','warning',null,'已有對話或事件，輪迴開場仍是空白','opening');

     // Source message ID is unique per stored message. Split import sources
     // may share a sourceEventId but must NOT share a sourcePartIndex.
     const ids=new Set(),sourceParts=new Set();
     for(const [idx,m] of msgs.entries()){
       if(!m||!kinds.has(m.role))add('invalid-role','error',idx,
         '第 '+(idx+1)+' 則角色無效，無法判定我／Gal AI');
       if(!m||typeof m.text!=='string'||!m.text.trim())
         add('empty-message','error',idx,'第 '+(idx+1)+' 則正文為空');
       if(m?.id){
         if(ids.has(m.id))add('duplicate-message-id','error',idx,
           '第 '+(idx+1)+' 則訊息 ID 重複，可能覆蓋或重複歸檔');
         ids.add(m.id);
       }
       if(m?.sourceEventId&&Number.isInteger(m.sourcePartIndex)){
         const key=m.sourceEventId+'|'+m.sourcePartIndex;
         if(sourceParts.has(key))add('duplicate-source-part','warning',idx,
           '第 '+(idx+1)+' 則與其他訊息使用相同的來源 ID／分段編號');
         sourceParts.add(key);
       }
       if(m?.nativeClockEvidence==='verified-original-without-game-time'&&
          m?.gameTime)add('conflicting-native-clock','error',idx,
           '原生來源標為無劇情時間，但此訊息卻有 gameTime');
     }

     const msgIds=new Set(msgs.map(m=>m?.id).filter(Boolean)),eventIds=new Set();
     for(const [idx,e] of evs.entries()){
       if(!e||!['pending','accepted','declined'].includes(e.status))
         add('invalid-event-status','warning',idx,'事件 #'+(idx+1)+' 接取狀態未知','events');
       if(!e||typeof e.text!=='string'||!e.text.trim())
         add('empty-event','warning',idx,'事件 #'+(idx+1)+' 沒有正文','events');
       if(e?.id){if(eventIds.has(e.id)||ids.has(e.id))add('duplicate-event-id','error',idx,
         '事件 #'+(idx+1)+' 的 ID 與其他項目重複','events');eventIds.add(e.id)}
       if(e?.status==='accepted')c.accepted++;
       else if(e?.status==='declined')c.rejected++;
       else c.pending++;
       if(e?.status==='accepted'&&e.storyPlacement&&typeof e.storyPlacement==='object'&&
          e.storyPlacement.beforeId!=null&&!msgIds.has(e.storyPlacement.beforeId))
         add('dangling-event-anchor','warning',idx,
          '已接事件 #'+(idx+1)+' 的手動位置指向不存在的對話 ID','events');
     }
     let rows;
     try{rows=typeof config.storyTimeline==='function'?config.storyTimeline(raw):fallbackStory(raw)}
     catch(error){rows=fallbackStory(raw);add('story-timeline-error','warning',null,
       '現有完整對話合併規則無法讀取此輪，暫使用備援順序：'+String(error.message||error),'cycle')}
     if(!Array.isArray(rows)){rows=fallbackStory(raw);add('story-timeline-invalid','error',null,
      '現有完整對話合併規則未回傳有效資料','cycle')}
     c.count=rows.length;
     let galContext=null;
     try{if(typeof config.galTimeContext==='function')galContext=config.galTimeContext(msgs)}
     catch(error){add('clock-index-error','warning',null,'劇情時間索引暫時無法建立：'+String(error.message||error),'cycle')}
     let audit=null;
     if(msgs.length&&typeof config.dialogueAudit==='function'){
       try{audit=config.dialogueAudit(rows)}
       catch(error){add('audit-unavailable','warning',null,
        '既有紅橘線檢查無法完成：'+String(error.message||error),'cycle')}
     }
     if(audit){
       for(const item of arrays(audit.issues))add('pair','error',item.index,'🔴 '+str(item.text));
       for(const item of arrays(audit.timeIssues))add('time','warning',item.index,'🟠 '+str(item.text));
       for(const item of arrays(audit.skipIssues))add('intentional-skip','info',item.index,
        '深紅提示：'+str(item.cue||item.text||'可能是主動略過的劇情'));
     }
     c.auditCounts={pairs:audit?.pairs??null,red:arrays(audit?.issues).length,
       orange:arrays(audit?.timeIssues).length,skip:arrays(audit?.skipIssues).length,
       autoContinues:arrays(audit?.autoContinues).length};
     const getStoryMs=(m)=>{
       const context=galContext?.get(m);
       if(context?.domain==='story'&&Number.isFinite(context.ms))return context.ms;
       if(m?.gameTime){return validDate(m.gameTime)}
       if(typeof config.parseStoryClock==='function'){
         const parsed=config.parseStoryClock(m);
         return parsed?.domain==='story'&&Number.isFinite(parsed.ms)?parsed.ms:null;
       }
       return null;
     };
     for(const [rowIndex,row] of rows.entries()){
       const entry=row?.entry;
       if(!entry)continue;
       const accepted=row.type==='event';
       const storyMs=accepted
         ?validDate(entry.gameTime)??(typeof config.parseEventClock==='function'
           ?config.parseEventClock(entry)?.ms??null:null)
         :getStoryMs(entry);
       const realMs=validDate(entry.sourceCreatedAt);
       const mark={id:c.id+':'+row.type+':'+row.index+':'+rowIndex,
         cycleId:c.id,world:c.world,cycleTitle:c.title,cycleNumber:c.number,
         rowIndex,index:row.index,entryId:str(entry.id),kind:row.type==='event'?'event':
         entry.role==='me'?'me':'ai',role:entry.role||'',
         title:row.type==='event'?(entry.title||'已接事件'):entry.role==='me'?'我':'Gal AI',
         preview:str(entry.text).replace(/\s+/gu,' ').trim().slice(0,180),
         fullText:str(entry.text),storyMs,realMs,
         storyDay:storyMs==null?null:storyDay(storyMs),
         realDay:realMs==null?null:storyDay(realMs),
         storyTime:storyMs==null?null:displayTime(storyMs),
         realTime:realMs==null?null:displayTime(realMs)};
       entries.push(mark);c.entries.push(mark);
       if(storyMs==null)c.untimed++;else c.storyTimed++;
       if(realMs!=null)c.realTimed++;
     }
   }
   // Same sequence as the archive sidebar: preserve world-tab order and
   // delegate the selected cycle sort mode to the existing sidebar comparator.
   // The timeline and health center must not invent another ranking.
   cycles.sort((a,b)=>{
     if(a.world!==b.world){
       const aa=worldOrder.has(a.world)?worldOrder.get(a.world):Number.MAX_SAFE_INTEGER;
       const bb=worldOrder.has(b.world)?worldOrder.get(b.world):Number.MAX_SAFE_INTEGER;
       return aa-bb||a.world.localeCompare(b.world,'zh-Hant');
     }
     return typeof config.cycleComparator==='function'
       ?config.cycleComparator(a.raw,b.raw)
       :compareCycles(a,b);
   });
   return {cycles,entries,issues,worlds,worldLabels:Object.fromEntries(worldLabels),
    counts:{cycles:cycles.length,messages:cycles.reduce((n,c)=>n+arrays(c.raw.messages).length,0),
      acceptedEvents:cycles.reduce((n,c)=>n+c.accepted,0),
      errors:issues.filter(x=>x.level==='error').length,
      warnings:issues.filter(x=>x.level==='warning').length,
      info:issues.filter(x=>x.level==='info').length,
      untimed:cycles.reduce((n,c)=>n+c.untimed,0)}};
 }
 function filteredEntries(index,opts={}){
   const world=str(opts.world),cycle=str(opts.cycle),kind=str(opts.kind),
    clock=opts.clock==='real'?'real':'story',query=str(opts.query).trim().toLowerCase();
   return index.entries.filter(item=>
    (!world||item.world===world)&&(!cycle||item.cycleId===cycle)&&
    (!kind||kind==='all'||item.kind===kind)&&
    (!query||[item.cycleTitle,item.title,item.fullText].some(s=>str(s).toLowerCase().includes(query)))&&
    (!opts.datedOnly||(clock==='story'?item.storyMs:item.realMs)!=null));
 }
 function timelineGroups(index,opts={}){
   const clock=opts.clock==='real'?'real':'story',rows=filteredEntries(index,opts);
   const keys=new Map();
   for(const cycle of index.cycles){
     const subset=rows.filter(row=>row.cycleId===cycle.id);
     if(!subset.length)continue;
     const days=new Map();
     for(const row of subset){
       const day=clock==='story'?row.storyDay:row.realDay;
       const key=day||'unknown';
       if(!days.has(key))days.set(key,[]);
       days.get(key).push(row);
     }
     const ordered=[...days].sort((a,b)=>a[0]==='unknown'?1:b[0]==='unknown'?-1:a[0].localeCompare(b[0]));
     keys.set(cycle.id,{cycle,days:ordered.map(([day,items])=>({day,items,
       eventCount:items.filter(x=>x.kind==='event').length}))});
   }
   return {groups:[...keys.values()],total:rows.length,clock};
 }
 return {build,filteredEntries,timelineGroups,storyDay,compareCycles};
});
