/* Browser-usable WHIF launcher for the Gal AI scanner. */
(() => {
'use strict';
const ID='gal-archive-page-launcher';
if(document.getElementById(ID)||!/^\/chat\/[a-zA-Z0-9_-]+\/?$/.test(location.pathname))return;
const button=document.createElement('button');
button.id=ID;
button.type='button';
button.textContent='🧭 開啟輪迴掃描助手';
button.setAttribute('aria-label','開啟輪迴掃描助手');
button.style.cssText='position:fixed;right:24px;bottom:96px;z-index:2147483645;min-width:220px;min-height:52px;padding:14px 20px;border:2px solid #bda7f4;border-radius:14px;background:#513b82;color:#fff;font:800 16px/1.25 system-ui,Microsoft JhengHei,sans-serif;letter-spacing:.02em;box-shadow:0 8px 28px #0009;cursor:pointer;touch-action:manipulation';
let timer=null;
const reset=()=>{button.disabled=false;button.textContent='🧭 開啟輪迴掃描助手'};
button.onclick=()=>{
 if(button.disabled)return;
 clearTimeout(timer);button.disabled=true;button.textContent='正在開啟助手…';
 chrome.runtime.sendMessage({type:'gal-page-open-assistant'},response=>{
  if(chrome.runtime.lastError||!response?.ok){
   button.textContent='⛔ '+(response?.error||chrome.runtime.lastError?.message||'無法開啟助手');
   timer=setTimeout(reset,3500);return;
  }
  button.textContent='✅ 助手已開啟';
  timer=setTimeout(reset,2200);
 });
};
document.documentElement.append(button);
})();