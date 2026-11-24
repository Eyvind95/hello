/* Browser-usable WHIF launcher + inline first-binding UI. */
(() => {
'use strict';
const BUTTON_ID='gal-archive-page-launcher',PANEL_ID='gal-archive-inline-binding';
if(document.getElementById(BUTTON_ID)||!/^\/chat\/[a-zA-Z0-9_-]+\/?$/.test(location.pathname))return;

const button=document.createElement('button');
button.id=BUTTON_ID;button.type='button';
button.textContent='🧭 開啟輪迴掃描助手';
button.setAttribute('aria-label','開啟輪迴掃描助手');
button.style.cssText='position:fixed;right:24px;bottom:96px;z-index:2147483645;min-width:220px;min-height:52px;padding:14px 20px;border:2px solid #bda7f4;border-radius:14px;background:#513b82;color:#fff;font:800 16px/1.25 system-ui,Microsoft JhengHei,sans-serif;letter-spacing:.02em;box-shadow:0 8px 28px #0009;cursor:pointer;touch-action:manipulation';

const CONTEXT_RELOAD_KEY='gal-archive-extension-context-reload-at';
const isContextInvalidated=value=>/Extension context invalidated/i.test(String(value?.message||value||''));
const recoverContext=()=>{
  const now=Date.now();
  let last=0;
  try{last=Number(sessionStorage.getItem(CONTEXT_RELOAD_KEY)||0)}catch(_){}
  if(now-last<15000){
    button.disabled=false;
    button.textContent='⛔ 擴充功能剛更新，請重新整理 WHIF';
    return;
  }
  try{sessionStorage.setItem(CONTEXT_RELOAD_KEY,String(now))}catch(_){}
  button.disabled=true;
  button.textContent='♻️ 擴充功能已更新，正在重新整理 WHIF…';
  setTimeout(()=>location.reload(),250);
};
const extensionContextAlive=()=>{
  try{return Boolean(globalThis.chrome?.runtime?.id)}catch(_){return false}
};
const send=message=>new Promise(resolve=>{
  if(!extensionContextAlive()){
    recoverContext();
    resolve({ok:false,contextInvalidated:true,error:'擴充功能剛更新，WHIF 正在重新整理'});
    return;
  }
  try{
    chrome.runtime.sendMessage(message,response=>{
      let error='';
      try{error=chrome.runtime.lastError?.message||''}catch(err){error=err?.message||String(err||'')}
      if(isContextInvalidated(error)){
        recoverContext();
        resolve({ok:false,contextInvalidated:true,error:'擴充功能剛更新，WHIF 正在重新整理'});
        return;
      }
      resolve(error?{ok:false,error}:response||{ok:false,error:'擴充功能沒有回應'});
    });
  }catch(error){
    if(isContextInvalidated(error)){
      recoverContext();
      resolve({ok:false,contextInvalidated:true,error:'擴充功能剛更新，WHIF 正在重新整理'});
      return;
    }
    resolve({ok:false,error:error?.message||String(error||'無法連接擴充功能')});
  }
});
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const managerList=p=>{
  const raw=Array.isArray(p?.managerNames)?p.managerNames:String(p?.manager||'').split(/[、，,;；\r\n]/u);
  return [...new Set(raw.map(x=>String(x||'').trim()).filter(Boolean))].slice(0,2);
};
const label=p=>[p?.worldName,p?.cycleTitle,managerList(p).join('、')].filter(Boolean).join('／')||p?.cycleId||'未命名';
let timer=null;
const reset=()=>{button.disabled=false;button.textContent='🧭 開啟輪迴掃描助手'};
const statusButton=(text,ms=2600)=>{button.textContent=text;clearTimeout(timer);timer=setTimeout(reset,ms)};

function removePanel(){document.getElementById(PANEL_ID)?.remove()}
function field(id){return document.getElementById(id)}
function fill(p,defaultUid=''){
  const managers=managerList(p);
  field('gal-bind-world').value=p?.worldName||'';
  field('gal-bind-title').value=p?.cycleTitle||'';
  field('gal-bind-cycle').value=p?.cycleId||'';
  field('gal-bind-manager1').value=managers[0]||'';
  field('gal-bind-manager2').value=managers[1]||'';
  field('gal-bind-uid').value=p?.uid||defaultUid||'';
}
function notice(text,warn=false){
  const n=field('gal-bind-notice');if(!n)return;
  n.textContent=text;n.style.borderColor=warn?'#e49b62':'#4d5f87';n.style.color=warn?'#ffd5ad':'#eef0ff';
}
async function openScanner(){
  const result=await send({type:'gal-page-open-assistant'});
  if(result?.ok){removePanel();statusButton('✅ 助手已開啟');return true}
  if(result?.needsBinding){await openBinding();return false}
  statusButton('⛔ '+(result?.error||'無法開啟助手'),4200);return false;
}
async function saveAndOpen(confirmReplace=false){
  const managerNames=[field('gal-bind-manager1').value.trim(),field('gal-bind-manager2').value.trim()].filter(Boolean);
  const profile={
    worldName:field('gal-bind-world').value.trim(),
    cycleTitle:field('gal-bind-title').value.trim(),
    cycleId:field('gal-bind-cycle').value.trim(),
    managerNames,manager:managerNames.join('、'),
    uid:field('gal-bind-uid').value.trim()
  };
  notice('正在儲存此 WHIF 頁面的綁定…');
  const result=await send({type:'gal-page-save-binding',profile,confirmReplace});
  if(result?.needsConfirm){
    notice('⚠ 這個 WHIF 頁面原本綁定不同輪迴。請再次按「覆蓋舊綁定並開啟助手」確認。',true);
    const b=field('gal-bind-save');b.textContent='覆蓋舊綁定並開啟助手';b.dataset.confirm='1';return;
  }
  if(!result?.ok){notice('⛔ '+(result?.error||'無法儲存綁定'),true);return}
  notice('✅ 綁定已儲存，正在開啟掃描助手…');
  const opened=await send({type:'gal-page-open-assistant'});
  if(!opened?.ok){notice('綁定已儲存，但助手開啟失敗：'+(opened?.error||'未知錯誤'),true);return}
  removePanel();statusButton('✅ 綁定完成，助手已開啟');
}
async function openBinding(){
  removePanel();
  const state=await send({type:'gal-page-binding-state'});
  if(!state?.ok){statusButton('⛔ '+(state?.error||'無法讀取綁定'),4200);return}
  const panel=document.createElement('section');panel.id=PANEL_ID;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','WHIF 輪迴首次綁定');
  panel.style.cssText='position:fixed;right:24px;bottom:164px;z-index:2147483646;width:min(440px,calc(100vw - 48px));max-height:min(72vh,720px);overflow:auto;padding:18px;border:2px solid #a98be8;border-radius:16px;background:#11192cf7;color:#f7f3ff;font:14px/1.45 system-ui,Microsoft JhengHei,sans-serif;box-shadow:0 14px 50px #000b;text-align:left';
  const presets=Array.isArray(state.presets)?state.presets:[];
  panel.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><strong style="font-size:18px">🧭 WHIF 輪迴綁定</strong><button id="gal-bind-close" type="button" aria-label="關閉綁定面板" style="font-size:20px;background:transparent;color:#fff;border:0;cursor:pointer">×</button></div>'+
    '<div style="margin:6px 0 12px;color:#c9c0ef">第一次綁定直接在 WHIF 頁面完成。Browser Use 不需要再點 Chrome 工具列。</div>'+
    '<div id="gal-bind-notice" style="white-space:pre-wrap;margin:8px 0;padding:9px;border:1px solid #4d5f87;border-radius:9px;background:#1d2944">請填入第 '+esc((state.profile?.cycleTitle||'新周目').replace(/^第?/,'').trim()||'新周目')+' 的檔案館資料。</div>'+
    (presets.length?'<label style="display:block;margin:10px 0 4px">沿用既有設定（選用）</label><select id="gal-bind-preset" style="width:100%;padding:10px;background:#1a2743;color:#fff;border:1px solid #56658f;border-radius:8px"><option value="">— 不沿用，自己填 —</option>'+presets.map((p,i)=>'<option value="'+i+'">'+esc(label(p))+'</option>').join('')+'</select>':'')+
    '<button id="gal-bind-paste" type="button" style="margin:8px 0;padding:8px">📋 貼上檔案館完整掃描綁定</button>'+
    '<label style="display:block;margin:10px 0 4px">當前世界觀（必填）</label><input id="gal-bind-world" autocomplete="off" placeholder="例如：全員精神穩定，感情除外">'+
    '<label style="display:block;margin:10px 0 4px">輪迴名稱（僅供辨識）</label><input id="gal-bind-title" autocomplete="off" placeholder="例如：第13周目・凱文">'+
    '<label style="display:block;margin:10px 0 4px">檔案館輪迴文件 ID（必填）</label><input id="gal-bind-cycle" autocomplete="off" placeholder="從檔案館複製，不要自行猜">'+
    '<label style="display:block;margin:10px 0 4px">第一位副駕駛（必填）</label><input id="gal-bind-manager1" autocomplete="off">'+
    '<label style="display:block;margin:10px 0 4px">第二位副駕駛（選填）</label><input id="gal-bind-manager2" autocomplete="off">'+
    '<label style="display:block;margin:10px 0 4px">Firebase UID（選填）</label><input id="gal-bind-uid" autocomplete="off">'+
    '<div style="display:flex;gap:9px;margin-top:14px"><button id="gal-bind-save" type="button" style="flex:1;min-height:48px;border:0;border-radius:10px;background:#6755d5;color:#fff;font-weight:800;cursor:pointer">儲存並開啟助手</button><button id="gal-bind-cancel" type="button" style="min-height:48px;border:0;border-radius:10px;background:#334260;color:#fff;font-weight:700;cursor:pointer">取消</button></div>';
  panel.querySelectorAll('input').forEach(input=>input.style.cssText='box-sizing:border-box;width:100%;padding:10px 11px;background:#1a2743;color:#fff;border:1px solid #56658f;border-radius:8px;font:14px/1.3 system-ui,Microsoft JhengHei,sans-serif');
  document.documentElement.append(panel);
  fill(state.profile||{},state.defaultUid||'');
  field('gal-bind-close').onclick=removePanel;field('gal-bind-cancel').onclick=removePanel;
  const select=field('gal-bind-preset');
  if(select)select.onchange=()=>{const i=select.value;if(i!=='')fill(presets[Number(i)]||{},state.defaultUid||'')};
  field('gal-bind-paste').onclick=async()=>{
   try{
    let raw='';try{raw=await navigator.clipboard.readText()}catch{raw=prompt('貼上檔案館完整掃描綁定 JSON')||''}
    const p=JSON.parse(raw);
    if(p.format!=='gal-archive-binding'||typeof p.worldName!=='string'||!p.worldName.trim()||
      typeof p.cycleId!=='string'||!p.cycleId.trim()||typeof p.cycleTitle!=='string'||!p.cycleTitle.trim())throw Error('不是檔案館完整綁定');
    field('gal-bind-world').value=p.worldName;field('gal-bind-cycle').value=p.cycleId;field('gal-bind-title').value=p.cycleTitle;
    field('gal-bind-save').dataset.confirm='';notice('已填入 '+p.worldName+'／'+p.cycleTitle+'，請確認目前 WHIF 聊天與目標相符後儲存。');
   }catch(e){notice('貼上失敗：'+e.message,true)}
  };
  field('gal-bind-save').onclick=()=>saveAndOpen(field('gal-bind-save').dataset.confirm==='1');
  field('gal-bind-world').focus();
}
button.oncontextmenu=event=>{event.preventDefault();openBinding()};
button.title='左鍵開啟助手；右鍵重新編輯目前 WHIF 綁定';
button.onclick=async()=>{
  if(button.disabled)return;
  if(!extensionContextAlive()){
    recoverContext();
    return;
  }
  clearTimeout(timer);button.disabled=true;button.textContent='正在開啟助手…';
  const state=await send({type:'gal-page-binding-state'});
  if(!state?.ok){statusButton('⛔ '+(state?.error||'無法讀取綁定'),4200);return}
  if(state.profile?.cycleId&&state.profile?.worldName){await openScanner();return}
  await openBinding();reset();
};
document.documentElement.append(button);
})();