'use strict';
/* Discover immutable WHIF Chrome download batches after V0.8.38.
 * No guess from file timestamps or "(1)" suffixes; status v2 is authoritative.
 * Also recognises pre-0.8.38 legacy status filenames for migration listings.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const DEFAULT=path.join(os.homedir(),'Downloads','GalArchive');
const {galBatchIdentity}=require('../chrome-extension/gal-scan-status.js');
const scopeFolders={full:'完整掃描',preview:'三則測試','event-three':'事件三則測試','position-seven':'指定位置測試',missing:'缺漏診斷'};
const sourceUrl=v=>{try{const u=new URL(typeof v==='string'?v:v?.url);return /^https:\/\/(?:www\.)?whif\.io\/chat\/[A-Za-z0-9_-]+\/?$/.test(u.href)?u.pathname.replace(/\/$/,''):null}catch{return null}};
function classifyBatch(batch,status){
 const candidates=[],errors=[];
 const check=(obj,label)=>{
  if(!obj?.worldName)return;
  if(obj.cycleId!==batch.cycleId){errors.push(label+'：輪迴 ID 不符');return}
  try{
   const id=galBatchIdentity({...obj,cycleTitle:obj.cycleTitle||batch.cycleTitle});
   if(!id.worldKey||id.cycleNumber===null){errors.push(label+'：世界觀或編號待確認');return}
   if(obj.worldKey&&obj.worldKey!==id.worldKey||obj.archiveKey&&obj.archiveKey!==id.archiveKey){errors.push(label+'：識別碼不符');return}
   if(galBatchIdentity({worldName:id.worldName,cycleId:batch.cycleId,cycleTitle:batch.cycleTitle}).cycleNumber!==id.cycleNumber){errors.push(label+'：輪迴名稱與狀態不一致');return}
   candidates.push({...id,evidence:label});
  }catch(e){errors.push(label+'：'+e.message)}
 };
 check(status,'status');
 for(const [kind,file] of Object.entries(batch.files)){
  if(!['result','unverified','eventResult','positionResult','missingResult','diagnostic'].includes(kind))continue;
  // A legacy absolute path is not evidence that a different folder belongs
  // to this batch. Only actual sibling files and matching run/document IDs.
  if(path.resolve(path.dirname(file))!==path.resolve(batch.batchFolder))continue;
  try{
   const d=JSON.parse(fs.readFileSync(file,'utf8'));
   if(d.scanRunId!==batch.scanRunId){if(d.target?.worldName||d.worldName)errors.push(kind+'：批次 ID 不符');continue}
   if(kind!=='diagnostic'&&sourceUrl(batch.source)!==sourceUrl(d.source)){errors.push(kind+'：來源網址不符');continue}
   if(d.target?.worldName)check(d.target,kind+' target');
   if(d.worldName)check(d,kind);
  }catch{errors.push(kind+'：JSON 無法核對')}
 }
 const keys=new Set(candidates.map(v=>v.archiveKey+'::'+v.cycleNumber));
 if(keys.size>1)errors.push('同批次世界觀或輪迴編號衝突');
 const id=errors.length?null:candidates[0]||null;
 return {...batch,worldName:id?.worldName||null,worldKey:id?.worldKey||null,worldFolder:id?.worldFolder||null,
  cycleNumber:id?.cycleNumber??null,archiveKey:id?.archiveKey||null,
  classification:id?'verified':'pending-review',classificationEvidence:id?candidates.map(v=>v.evidence):[],classificationErrors:errors,
  expectedRelativeFolder:id&&scopeFolders[batch.scope]&&/^[0-9a-f-]{36}$/i.test(batch.scanRunId)?
   path.join(id.worldFolder,'第'+String(id.cycleNumber).padStart(2,'0')+'輪迴',scopeFolders[batch.scope],path.basename(batch.batchFolder)):null};
}
function latestWorldIndex(batches){
 const latest=new Map(),ordinals=new Map(),pending=[];
 for(const b of batches){
  if(!b.archiveKey||b.classification!=='verified'){pending.push(b);continue}
  const key=b.archiveKey+'::'+b.scope;
  const old=latest.get(key);
  if(!old||String(b.endedAt||b.startedAt)>String(old.endedAt||old.startedAt))latest.set(key,b);
  const ordinal=b.worldKey+'::'+b.cycleNumber,ids=ordinals.get(ordinal)||new Set();ids.add(b.archiveKey);ordinals.set(ordinal,ids);
 }
 return {schemaVersion:3,generatedAt:new Date().toISOString(),identityRule:'worldKey::cycleId; latest additionally scoped by tool',
  latestByWorldCycleScope:[...latest.values()],pendingReview:pending,
  ordinalConflicts:[...ordinals].filter(([,ids])=>ids.size>1).map(([key,ids])=>({key,archiveKeys:[...ids]}))};
}
function findScanBatches(root=DEFAULT,{cycle='',world='',scope='',limit=30}={}){
 if(!fs.existsSync(root))return [];
 const out=[];
 const visit=(dir,depth)=>{
  if(depth>5)return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const p=path.join(dir,entry.name);
   if(entry.isDirectory()){visit(p,depth+1);continue}
   if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
   const modern=entry.name==='掃描狀態.json';
   const legacy=/^輪迴檔案館_掃描狀態_.*_(?:running|completed|failed|paused|cancelled)_\d{4}-\d{2}-\d{2}(?: \(\d+\))?\.json$/.test(entry.name);
   if(!modern&&!legacy)continue;
   try{
    const d=JSON.parse(fs.readFileSync(p,'utf8'));
    if(d.format!=='gal-archive-scan-status'||!d.scanRunId)continue;
    const batch={
     scanRunId:d.scanRunId,cycleId:d.cycleId,cycleTitle:d.cycleTitle,
     scope:d.scope||null,state:d.state,scanned:d.scanned,
     scannerVersion:d.scannerVersion||null,startedAt:d.startedAt,endedAt:d.endedAt||null,
     statusPath:p,batchFolder:path.dirname(p),
     source:d.source,reason:d.reason||null,
     legacy,
     // Use real present files; never infer or invent a completed result.
     files:{}
    };
    if(modern){
     for(const [name,file] of Object.entries(d.files||{})){
      const local=path.join(path.dirname(p),path.basename(file));
      if(fs.existsSync(local)&&fs.statSync(local).isFile())batch.files[name]=local;
      else if(fs.existsSync(file)&&fs.statSync(file).isFile())batch.files[name]=file;
     }
    }else{
     for(const [name,file] of Object.entries(d.files||{}))
      if(fs.existsSync(file)&&fs.statSync(file).isFile())batch.files[name]=file;
    }
    const classified=classifyBatch(batch,d);
    if(world&&world!==classified.worldKey&&world!==classified.worldName)continue;
    if(cycle&&cycle!==batch.cycleId&&!String(batch.cycleTitle).includes(cycle))continue;
    if(scope&&scope!==batch.scope)continue;
    out.push(classified);
   }catch{/* Invalid scan status files are not usable for automation. */}
  }
 };
 visit(root,0);
 // Ignore repeated legacy running/failed status names within the same run:
 // keep newest terminal status over an older still-running snapshot.
 const latest=new Map();
 for(const b of out){
  const key=(b.archiveKey||'pending::'+b.cycleId)+'::'+b.scanRunId;
  const previous=latest.get(key);
  if(!previous||String(b.endedAt||b.startedAt)>String(previous.endedAt||previous.startedAt))
   latest.set(key,b);
 }
 return [...latest.values()].sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,limit);
}
if(require.main===module){
 const args=process.argv.slice(2);let root=DEFAULT,cycle='',world='',scope='',limit=30,index=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--root')root=args[++i];
  else if(args[i]==='--cycle')cycle=args[++i];
  else if(args[i]==='--world')world=args[++i];
  else if(args[i]==='--index')index=true;
  else if(args[i]==='--scope')scope=args[++i];
  else if(args[i]==='--limit')limit=Number(args[++i])||30;
  else {console.error('Usage: node tools/find-scan-batches.js [--root "C:\\Users\\...\\Downloads\\GalArchive"] [--cycle 第9周目] [--scope full]');process.exit(2)}
 }
 const batches=findScanBatches(root,{cycle,world,scope,limit:index?Infinity:limit});
 console.log(JSON.stringify(index?latestWorldIndex(batches):batches,null,2));
}
module.exports={findScanBatches,latestWorldIndex,classifyBatch};
