/* Read the message already backing a visible WHIF reply. Runs in MAIN. */
(() => {
'use strict';
const request='gal-archive-native-reply-request-v1';
const response='gal-archive-native-reply-response-v1';
if(globalThis.__galArchiveNativeReplyReader)return;
globalThis.__galArchiveNativeReplyReader=true;
document.addEventListener(request,event=>{
 const node=event.target;
 if(!(node instanceof Element))return;
 const historyOnly=event.detail==='history-source-evidence';
 const playerDetail=event.detail==='player-anchor-evidence';
 const evidenceOnly=historyOnly||event.detail==='event-evidence'||playerDetail;
 const id=node.getAttribute('data-selection-copy-message-id')||
  (evidenceOnly?node.getAttribute('data-message-id'):null);
 if(!id&&!evidenceOnly)return;
 const key=Object.keys(node).find(name=>name.startsWith('__reactFiber$'));
 let fiber=key?node[key]:null;
 let result={reason:'message-content-unavailable'};
 for(let depth=0;fiber&&depth<40;depth++,fiber=fiber.return){
  const props=fiber.memoizedProps;
  const card=evidenceOnly&&!id?props?.event:null;
  const message=card||props?.message;
  if((id?message?.id===id:card&&typeof card.id==='string')&&typeof message.content==='string'){
   const sender=message.sender_type||message.type;
   const kind=card?'event-card':sender==='deg_event'?'event-message':
    ['user','character','assistant','chapter','dm'].includes(sender)?'ordinary-message':'unknown-message';
   if(playerDetail){
    if(sender==='user'&&kind==='ordinary-message'&&message.content.length<=30000){
     const meta=message.metadata;
     const entries=meta&&typeof meta==='object'&&!Array.isArray(meta)?Object.entries(meta).slice(0,100):[];
     // Capture only bounded scalar metadata locally. Never export other message objects.
     result={reason:'player-anchor-evidence',text:message.content,
      eventEvidence:{messageId:message.id,kind,sender,accepted:typeof meta?.accept==='boolean'?meta.accept:null},
      metadataKeys:entries.map(([k])=>k),
      metadataScalars:Object.fromEntries(entries.filter(([k,v])=>typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||v===null||typeof v==='string'&&v.length<=500)),
      metadataTruncated:!!meta&&Object.keys(meta).length>entries.length};
    }
    break;
   }
   if(evidenceOnly){
    result={reason:'evidence',eventEvidence:{messageId:message.id,
     kind,sender:typeof sender==='string'?sender:null,
     accepted:typeof message.metadata?.accept==='boolean'?message.metadata.accept:null}};
    if(historyOnly){
     const hash=s=>{let a=2166136261,b=0x811c9dc5;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619)>>>0;b=Math.imul(b^s.charCodeAt(i),2246822519)>>>0}return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0')};
     result.nativeHash=hash(message.content);result.nativeNormHash=hash(message.content.replace(/\s/gu,''));result.nativeLength=message.content.length;
    }
    break;
   }
   if(message.content.trim()&&message.content.length<=30000){
    const title=message.metadata?.chapter_title||message.metadata?.chapterTitle;
    result={reason:'available',text:message.content,
     chapterTitle:typeof title==='string'&&title.length<=200?title:undefined,
     eventEvidence:{messageId:message.id,kind,sender:typeof sender==='string'?sender:null,
      accepted:typeof message.metadata?.accept==='boolean'?message.metadata.accept:null}};
   }
   break;
  }
 }
 node.dispatchEvent(new CustomEvent(response,{detail:JSON.stringify(result)}));
},true);
})();