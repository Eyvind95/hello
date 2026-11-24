'use strict';
/* Discover immutable WHIF Chrome download batches after V0.8.38.
 * No guess from file timestamps or "(1)" suffixes; status v2 is authoritative.
 * Also recognises pre-0.8.38 legacy status filenames for migration listings.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const DEFAULT=path.join(os.homedir(),'Downloads','GalArchive');
function findScanBatches(root=DEFAULT,{cycle='',scope='',limit=30}={}){
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
      if(fs.existsSync(file)&&fs.statSync(file).isFile())batch.files[name]=file;
      else if(fs.existsSync(local)&&fs.statSync(local).isFile())batch.files[name]=local;
     }
    }else{
     for(const [name,file] of Object.entries(d.files||{}))
      if(fs.existsSync(file)&&fs.statSync(file).isFile())batch.files[name]=file;
    }
    if(cycle&&cycle!==batch.cycleId&&!String(batch.cycleTitle).includes(cycle))continue;
    if(scope&&scope!==batch.scope)continue;
    out.push(batch);
   }catch{/* Invalid scan status files are not usable for automation. */}
  }
 };
 visit(root,0);
 // Ignore repeated legacy running/failed status names within the same run:
 // keep newest terminal status over an older still-running snapshot.
 const latest=new Map();
 for(const b of out){
  const previous=latest.get(b.scanRunId);
  if(!previous||String(b.endedAt||b.startedAt)>String(previous.endedAt||previous.startedAt))
   latest.set(b.scanRunId,b);
 }
 return [...latest.values()].sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,limit);
}
if(require.main===module){
 const args=process.argv.slice(2);let root=DEFAULT,cycle='',scope='',limit=30;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--root')root=args[++i];
  else if(args[i]==='--cycle')cycle=args[++i];
  else if(args[i]==='--scope')scope=args[++i];
  else if(args[i]==='--limit')limit=Number(args[++i])||30;
  else {console.error('Usage: node tools/find-scan-batches.js [--root "C:\\Users\\...\\Downloads\\GalArchive"] [--cycle 第9周目] [--scope full]');process.exit(2)}
 }
 console.log(JSON.stringify(findScanBatches(root,{cycle,scope,limit}),null,2));
}
module.exports={findScanBatches};
