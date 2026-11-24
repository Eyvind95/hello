'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('./inspect-player-surplus.js');
test('V0.8.36 cannot identify two native player source IDs from global count alone',()=>{
 const report={scanRunId:'cbaad410-6316-4cbd-9e27-cfde6797f22c',
  autoContinueAudit:{
   observedUserMessages:1313,playerRows:1311,
   gaps:[{scanIndex:1536,ok:true},{scanIndex:1798,ok:true},{scanIndex:2007,ok:true}]
  },eventAudit:{exportedEvents:4,unresolvedAccepted:0,unresolvedHeaders:0}};
 const result=inspect(report);
 assert.equal(result.forensicEvidenceAvailable,false);
 assert.equal(result.countDifference,2);
 assert.deepEqual(result.autoContinueCandidates.map(x=>x.ok),[true,true,true]);
 assert.match(result.conclusion,/cannot be recovered from counts/);
 assert.ok(!result.unmappedNativeUserDetails);
});
test('V0.8.37 provides hashed source candidates and nearby scan positions, without asserting loss',()=>{
 const report={
  autoContinueAudit:{gaps:[{scanIndex:1536,ok:true}],playerSourceAudit:{
   originalUserMarkers:1313,renderedPlayerRows:1311,
   mappedNativeUserMarkers:1311,unmappedNativeUserMarkers:2,
   unmappedNativeUserDetails:[
    {sourceHash:'abc',nearFirst:{afterScanIndex:800,beforeScanIndex:801}},
    {sourceHash:'def',nearFirst:{afterScanIndex:1200,beforeScanIndex:1201}}
   ],rowsWithMultipleNativeUserSources:0,multipleNativeSourceDetails:[],
   rowsWithoutProvenUserMarker:0,rowsWithoutProvenUserMarkerIndices:[],
   sourceInMultiplePlayerRows:[],linkedButNotObserved:[]
  }}
 };
 const result=inspect(report);
 assert.equal(result.forensicEvidenceAvailable,true);
 assert.equal(result.countDifference,2);
 assert.equal(result.unmappedNativeUserDetails.length,2);
 assert.match(result.conclusion,/Verify raw WHIF message boundaries/);
});
test('V0.8.37 differentiates two native markers coalesced in a single player gap',()=>{
 const report={playerSourceAudit:{
   originalUserMarkers:1313,renderedPlayerRows:1311,
   mappedNativeUserMarkers:1313,unmappedNativeUserMarkers:0,unmappedNativeUserDetails:[],
   rowsWithMultipleNativeUserSources:1,
   multipleNativeSourceDetails:[{scanIndex:516,nativeUserSourceCount:3,
     sourceHashes:['x','y','z']}],
   rowsWithoutProvenUserMarker:0,rowsWithoutProvenUserMarkerIndices:[],
   sourceInMultiplePlayerRows:[],linkedButNotObserved:[]
 }};
 const result=inspect(report);
 assert.equal(result.unmappedNativeUserMarkers,0);
 assert.equal(result.multipleNativeSourceDetails[0].scanIndex,516);
 assert.equal(result.countDifference,2);
});
