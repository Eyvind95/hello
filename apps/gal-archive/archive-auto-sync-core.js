/* Safe additive sync planner; pure, testable, no browser or Firebase dependency. */
(function(scope,factory){
 'use strict';
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 scope.ArchiveAutoSyncCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function stamp(x){
  if(typeof x!=='string'||!x.trim())return null;
  const n=Date.parse(x);
  return Number.isFinite(n)?n:null;
 }
 function index(rows){
  const map=new Map(),problems=[];
  for(const row of rows||[]){
   if(!row||typeof row.id!=='string'||!row.id||row.id.includes('/')){
    problems.push('invalid-id');continue;
   }
   if(map.has(row.id))problems.push('duplicate-id:'+row.id);
   map.set(row.id,row);
  }
  return {map,problems};
 }
 function compare(local,remote){
  if(!local&&!remote)return 'equal';
  if(!local)return 'remote-only';
  if(!remote)return 'local-only';
  // A missing/invalid timestamp makes automatic conflict resolution unsafe.
  const a=stamp(local.updatedAt),b=stamp(remote.updatedAt);
  if(a===null||b===null)return 'unknown-revision';
  if(a===b)return 'equal-revision';
  return a>b?'local-newer':'remote-newer';
 }
 function plan(localCycles,remoteCycles,localWorlds=[],remoteWorlds=[]){
  const a=index(localCycles),b=index(remoteCycles),c=index(localWorlds),d=index(remoteWorlds);
  const problems=[...a.problems,...b.problems,...c.problems,...d.problems];
  const changes=[],snapshots=[];
  let needsPull=false,needsPush=false;
  function collect(kind,left,right){
   for(const id of new Set([...left.keys(),...right.keys()])){
    const local=left.get(id),remote=right.get(id),choice=compare(local,remote);
    if(choice==='unknown-revision'){
     problems.push(kind+'-revision-conflict:'+id);continue;
    }
    if(kind==='cycle'&&choice==='remote-newer'&&local){
     const localMessages=Array.isArray(local.messages)?local.messages.length:0;
     const localAccepted=Array.isArray(local.events)?local.events.filter(e=>e?.status==='accepted').length:0;
     const remoteMessages=remote.messageCount,remoteAccepted=remote.acceptedEventCount;
     // Older manifests lack source-count evidence. Require manual review
     // before overwriting an already populated local archive.
     if((localMessages>0||localAccepted>0)&&
       (!Number.isSafeInteger(remoteMessages)||!Number.isSafeInteger(remoteAccepted))){
       problems.push('cycle-missing-remote-count-proof:'+id);continue;
     }
     if(Number.isSafeInteger(remoteMessages)&&remoteMessages<localMessages){
       problems.push('cycle-remote-has-fewer-messages:'+id);continue;
     }
     if(Number.isSafeInteger(remoteAccepted)&&remoteAccepted<localAccepted){
       problems.push('cycle-remote-has-fewer-accepted-events:'+id);continue;
     }
    }
    if(choice==='local-only'||choice==='local-newer')needsPush=true;
    if(choice==='remote-only'||choice==='remote-newer')needsPull=true;
    if(kind==='cycle'&&choice==='remote-newer'&&local)snapshots.push(local);
    changes.push({kind,id,choice,localAt:local?.updatedAt||null,remoteAt:remote?.updatedAt||null});
   }
  }
  collect('world',c.map,d.map);collect('cycle',a.map,b.map);
  // An empty local device must NEVER push emptiness to an existing cloud.
  if(!a.map.size&&!c.map.size&&((b.map.size||d.map.size)))needsPush=false;
  return {ok:problems.length===0,problems,changes,snapshots,needsPull,needsPush,
   count:{localCycles:a.map.size,remoteCycles:b.map.size,
    pull:changes.filter(x=>x.choice==='remote-only'||x.choice==='remote-newer').length,
    push:changes.filter(x=>x.choice==='local-only'||x.choice==='local-newer').length}};
 }
 return {stamp,compare,plan};
});
