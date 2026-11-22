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
 const id=node.getAttribute('data-selection-copy-message-id');
 if(!id)return;
 const key=Object.keys(node).find(name=>name.startsWith('__reactFiber$'));
 let fiber=key?node[key]:null;
 let result={reason:'message-content-unavailable'};
 for(let depth=0;fiber&&depth<40;depth++,fiber=fiber.return){
  const message=fiber.memoizedProps?.message;
  if(message?.id===id&&typeof message.content==='string'){
   if(message.content.trim()&&message.content.length<=30000){
    const title=message.metadata?.chapter_title||message.metadata?.chapterTitle;
    result={reason:'available',text:message.content,
     chapterTitle:typeof title==='string'&&title.length<=200?title:undefined};
   }
   break;
  }
 }
 node.dispatchEvent(new CustomEvent(response,{detail:JSON.stringify(result)}));
},true);
})();
