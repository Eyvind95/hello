#!/usr/bin/env node
/* Read-only two-user-source forensic diagnostic, never imports archive data. */
'use strict';
const fs=require('node:fs');
function inspect(report){
 const a=report?.playerSourceAudit||report?.autoContinueAudit?.playerSourceAudit;
 const auto=report?.autoContinueAudit||{};
 const observed=a?.originalUserMarkers??auto.observedUserMessages??null;
 const rows=a?.renderedPlayerRows??auto.playerRows??null;
 const difference=observed!=null&&rows!=null?observed-rows:null;
 const gap=auto.gaps||[];
 return {
  inputRunId:report?.scanRunId||null,
  forensicEvidenceAvailable:!!a,
  observedNativeUserMarkers:observed,
  renderedPlayerRows:rows,
  countDifference:difference,
  autoContinueCandidates:gap.map(x=>({scanIndex:x.scanIndex,ok:x.ok,errors:x.errors||[]})),
  acceptedEvents:report?.eventAudit?.exportedEvents??null,
  unresolvedAccepted:report?.eventAudit?.unresolvedAccepted??null,
  unresolvedHeaders:report?.eventAudit?.unresolvedHeaders??null,
  ...(a?{
   mappedNativeUserMarkers:a.mappedNativeUserMarkers,
   unmappedNativeUserMarkers:a.unmappedNativeUserMarkers,
   unmappedNativeUserDetails:a.unmappedNativeUserDetails,
   rowsWithMultipleNativeUserSources:a.rowsWithMultipleNativeUserSources,
   multipleNativeSourceDetails:a.multipleNativeSourceDetails,
   rowsWithoutProvenUserMarker:a.rowsWithoutProvenUserMarker,
   rowsWithoutProvenUserMarkerIndices:a.rowsWithoutProvenUserMarkerIndices,
   sourceInMultiplePlayerRows:a.sourceInMultiplePlayerRows,
   linkedButNotObserved:a.linkedButNotObserved,
   conclusion:'Only source-position hypotheses are reported. Verify raw WHIF message boundaries before changing extraction or allowing import.'
  }:{
   conclusion:'This V0.8.36-or-earlier diagnostic contains only global counts, not per-user-source-to-player-gap identities. The two source IDs and their row positions cannot be recovered from counts. Save an unimportable checkpoint and preserve the diagnostic; do not guess or approve import.'
  })
 };
}
if(require.main===module){
 const name=process.argv[2];
 if(!name||!fs.existsSync(name)){
  console.error('Usage: node apps/gal-archive/tools/inspect-player-surplus.js "<V0.8.36-or-later diagnostic.json>"');
  process.exitCode=2;
 }else{
  try{
   const d=JSON.parse(fs.readFileSync(name,'utf8'));
   process.stdout.write(JSON.stringify(inspect(d),null,2)+'\n');
  }catch(error){console.error(String(error.message||error));process.exitCode=1;}
 }
}
module.exports={inspect};
