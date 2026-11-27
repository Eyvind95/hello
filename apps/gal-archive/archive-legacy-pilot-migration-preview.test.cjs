'use strict';
const test=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{previewLegacy,previewUnbound}=require('./archive-legacy-pilot-migration-preview.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const buf=x=>Buffer.from(JSON.stringify(x));
const row=(i,role,text)=>({index:i,id:'source-'+i,role,text,identityBasis:'turn-key',sourceCreatedAt:null,structure:[],attachments:[]});
const rows=[row(0,'user','A B'),row(1,'user','A B'),row(2,'assistant','C D'),row(3,'user','😀尾'),row(4,'assistant','X')];
const raw={format:'gal-predecessor-chat',version:1,status:'completed',canonical:false,chatId:'chat',count:rows.length,rows,evidence:{topReached:true,bottomReached:true,continuity:true}};
const target={worldKey:'sentinel',cycleId:'cycle',cycleTitle:'第17輪迴'};
const old=(id,role,text,manager='暗夢後輩')=>({id,role,text,manager,sourceEventId:'legacy-'+id,chatKey:'old',sourcePartIndex:0,sourceCreatedAt:'old-time',messageOrder:3,attachments:[{label:'old'}]});
const backup={id:target.cycleId,world:target.worldKey,title:target.cycleTitle,pilotMessages:[old('1','me','A B'),old('2','ai','CD'),old('3','me','😀尾'),old('4','me','😀尾'),old('5','me','C D'),old('6','ai','C D','暗夢前輩'),old('7','ai','X',''),old('8','ai','missing')]};
const candidateRefs=rows.map(r=>({sourceId:r.id,rangeUtf16:[0,r.text.length]}));
function input(overrides={}){const sourceBytes=buf(raw),backupBytes=buf(backup);return {sourceBytes,sourceSha256:sha(sourceBytes),backupBytes,backupSha256:sha(backupBytes),target,manager:'暗夢後輩',candidateRefs,...overrides}}
test('same manager/role only, exact vs whitespace, ambiguity in both directions; no writes',()=>{
 const x=previewLegacy(input());a.equal(x.counts.oldTotal,8);a.equal(x.counts.oldManager,6);a.equal(x.counts.normalizedOld,4);a.equal(x.counts.exactOld,3);a.equal(x.counts.mutualUnique,1);a.equal(x.oldMatches[0].hits.length,2);a.equal(x.oldMatches[2].disposition,'multiple-old-to-one-review');a.deepEqual(x.protectedOldOrdinals,[5,6]);a.deepEqual(x.oldMatches[1].oldRecord,backup.pilotMessages[1]);a.ok(x.oldMatches.every(r=>r.automaticDelete===false));a.deepEqual(x.operations,[]);a.equal(x.importable,false);a.deepEqual(previewLegacy(input()),x);
});
test('reject wrong hashes, target, source, duplicate ranges and surrogate splits',()=>{
 for(const i of [input({backupSha256:'a'.repeat(64)}),input({sourceSha256:'a'.repeat(64)}),input({target:{...target,cycleId:'wrong'}}),input({candidateRefs:[{sourceId:'missing',rangeUtf16:[0,1]}]}),input({candidateRefs:[{sourceId:'source-3',rangeUtf16:[1,3]}]}),input({candidateRefs:[candidateRefs[0],candidateRefs[0]]})])a.throws(()=>previewLegacy(i));
 const broken=buf({...raw,evidence:{...raw.evidence,continuity:false}});a.throws(()=>previewLegacy(input({sourceBytes:broken,sourceSha256:sha(broken)})));
});
test('unbound source retains text and null cycle, no invented UUID or write',()=>{
 const i=input(),refs=[{...candidateRefs[2],index:2,cycle:null,tab:'realChatLogs'}],x=previewUnbound({...i,refs});a.equal(x.records[0].text,'C D');a.equal(x.records[0].cycleId,null);a.deepEqual(x.operations,[]);a.throws(()=>previewUnbound({...i,refs:[{...refs[0],cycleId:'invented'}]}));a.throws(()=>previewUnbound({...i,refs:[{...refs[0],cycle:17}]}));
});
