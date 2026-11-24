'use strict';
// Explicitly invoked, no scheduler installation. Default is a read-only plan.
// Copies verified, terminal, immutable batches only; never deletes or overwrites.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {findScanBatches,latestWorldIndex}=require('./find-scan-batches.js');
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function syncWorldBatches(root,destination,{apply=false,includeLegacy=false}={}){
 root=path.resolve(root);destination=path.resolve(destination);
 const inside=(base,p)=>p===base||p.startsWith(base+path.sep);
 if(inside(root,destination)||inside(destination,root))throw Error('來源與中轉站不得互相包含');
 if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw Error('來源資料夾不存在');
 if(!fs.existsSync(destination)||!fs.statSync(destination).isDirectory())throw Error('中轉站不存在；不得自行建立假同步根目錄');
 const batches=findScanBatches(root,{limit:Infinity}),plan=[],verified=[];
 for(const b of batches){
  if(b.classification!=='verified'||!b.expectedRelativeFolder||!['completed','failed','paused','cancelled'].includes(b.state)){plan.push({scanRunId:b.scanRunId,action:'review',reason:'身分或終態未確認'});continue}
  const relative=path.relative(root,b.batchFolder);
  if(relative!==b.expectedRelativeFolder&&!includeLegacy){plan.push({scanRunId:b.scanRunId,action:'review',reason:'舊路徑須明確核准複製（不搬移）'});continue}
  const sourceFiles=[b.statusPath,...Object.values(b.files)];
  const files=[...new Set(sourceFiles)].map(src=>({src,dst:path.join(destination,b.expectedRelativeFolder,path.basename(src))}));
  const status=JSON.parse(fs.readFileSync(b.statusPath,'utf8'));
  if(status.exportPending===true||Object.keys(status.files||{}).some(k=>!b.files[k])){plan.push({scanRunId:b.scanRunId,action:'review',reason:'終態檔案尚未完整'});continue}
  if(files.some(x=>path.resolve(path.dirname(x.src))!==path.resolve(b.batchFolder)||!inside(destination,x.dst)||fs.lstatSync(x.src).isSymbolicLink())){
   plan.push({scanRunId:b.scanRunId,action:'review',reason:'檔案不在同一批次或路徑不安全'});continue;
  }
  let conflict=false;
  for(const x of files){
   // Reject symlink/junction components within destination.
   for(let p=path.dirname(x.dst);inside(destination,p);p=path.dirname(p)){
    if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink()){conflict=true;break}
    if(p===destination)break;
   }
   if(fs.existsSync(x.dst)&&(!fs.lstatSync(x.dst).isFile()||digest(x.src)!==digest(x.dst)))conflict=true;
  }
  if(conflict){plan.push({scanRunId:b.scanRunId,action:'conflict',reason:'目的資料已存在且不一致；未覆蓋'});continue}
  if(apply){
   for(const x of files){
    fs.mkdirSync(path.dirname(x.dst),{recursive:true});
    if(!fs.existsSync(x.dst))fs.copyFileSync(x.src,x.dst,fs.constants.COPYFILE_EXCL);
    if(digest(x.src)!==digest(x.dst))throw Error('同步回讀雜湊不一致');
   }
   verified.push({...b,batchFolder:path.join(destination,b.expectedRelativeFolder),statusPath:files[0].dst,
    files:Object.fromEntries(Object.entries(b.files).map(([k,v])=>[k,path.join(destination,b.expectedRelativeFolder,path.basename(v))]))});
  }
  plan.push({scanRunId:b.scanRunId,archiveKey:b.archiveKey,action:apply?'verified-copy':'copy-plan',files:files.map(x=>({source:x.src,destination:x.dst}))});
 }
 return {mode:apply?'copy-only':'dry-run',plan,index:latestWorldIndex(apply?verified:batches)};
}
if(require.main===module){
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
 if(!args.includes('--root')||!args.includes('--destination'))throw Error('Usage: node sync-scan-batches.js --root LOCAL --destination EXISTING_CLOUD_BATCH_ROOT [--apply] [--include-legacy]');
 console.log(JSON.stringify(syncWorldBatches(value('--root'),value('--destination'),{apply:args.includes('--apply'),includeLegacy:args.includes('--include-legacy')}),null,2));
}
module.exports={syncWorldBatches};
