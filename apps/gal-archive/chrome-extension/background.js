'use strict';
importScripts('gal-scan-status.js','predecessor-chat-core.js','predecessor-checkpoint-memory.js');
installGalScanStatus(chrome);
const ENDPOINT = 'https://asia-east1-eyvind95-182f0.cloudfunctions.net/archiveIngest';
const CHAT_PREFIX = 'https://chatgpt.com';
const WHIF_HOSTS=new Set(['whif.io','www.whif.io']);
const whifSource=url=>{
  try{
    const u=new URL(url);
    if(u.protocol==='https:'&&WHIF_HOSTS.has(u.hostname)&&/^\/chat\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname))
      return u.origin+u.pathname.replace(/\/$/,'');
  }catch(_){}
  return null;
};
const validChat = url => {
  try { const u = new URL(url); return u.origin === CHAT_PREFIX && (/^\/c\/[a-zA-Z0-9-]+\/?$/.test(u.pathname) || /^\/g\/[^/]+\/c\/[a-zA-Z0-9-]+\/?$/.test(u.pathname)); }
  catch (_) { return false; }
};
const chatKey = url => new URL(url).pathname.replace(/\/$/, '');
const storageGet = keys => new Promise(r => chrome.storage.local.get(keys, r));
const storageSet = data => new Promise(r => chrome.storage.local.set(data, r));
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const failures = {};
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(typeof message?.type==='string'&&message.type.startsWith('gal-run-'))return false;
  (async () => {
    if(message?.type==='predecessor-installed-checkpoint-import'){
      if(!sender.tab||sender.frameId!==0||!validChat(sender.url||'')||!validChat(sender.tab.url||'')||chatKey(sender.url)!==chatKey(sender.tab.url))return {ok:false,error:'僅限目前 ChatGPT 主聊天頁面'};
      const source=CHAT_PREFIX+chatKey(sender.url),expected=String(message.expectedHash||'').trim().toLowerCase();
      const result=await GalCheckpointMemory.importInstalled(chrome.storage.local,chrome.runtime,source,GalPredecessorChat,expected);
      return {ok:true,...result};
    }
    if(message?.type==='predecessor-open-checkpoint-import'){
      if(!sender.tab||sender.frameId!==0||!validChat(sender.url||'')||!validChat(sender.tab.url||'')||chatKey(sender.url)!==chatKey(sender.tab.url))return {ok:false,error:'僅限目前 ChatGPT 主聊天頁面'};
      const source=CHAT_PREFIX+chatKey(sender.url),expected=String(message.expectedHash||'').trim().toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(expected))return {ok:false,error:'請輸入原始檔 SHA-256'};
      const url=new URL(chrome.runtime.getURL('checkpoint-import.html'));
      url.searchParams.set('source',source);url.searchParams.set('sha256',expected);
      await chrome.tabs.create({url:url.href,active:true});
      return {ok:true};
    }
    if (message?.type === 'gal-page-binding-state') {
      if(!sender.tab||sender.frameId!==0) return {ok:false,error:'只能從 WHIF 主頁面讀取綁定'};
      const source=whifSource(sender.tab.url||'');
      if(!source)return {ok:false,error:'目前不是可辨識的 WHIF 聊天頁面'};
      const data=await storageGet(['galProfilesByPage','profilesByChat','profile']);
      const current=data.galProfilesByPage?.[source]||null;
      const pool=[
        ...Object.values(data.galProfilesByPage||{}),
        ...Object.values(data.profilesByChat||{})
      ].filter(p=>p?.cycleId&&p?.worldName);
      const presets=[...new Map(pool.map(p=>[
        JSON.stringify([String(p.uid||''),String(p.worldName||''),String(p.cycleId||''),String(p.cycleTitle||''),String(p.manager||''),JSON.stringify(p.managerNames||[])]),
        {uid:String(p.uid||''),worldName:String(p.worldName||''),cycleTitle:String(p.cycleTitle||''),
         cycleId:String(p.cycleId||''),manager:String(p.manager||''),managerNames:Array.isArray(p.managerNames)?p.managerNames:[]}
      ])).values()].slice(0,60);
      return {ok:true,source,profile:current,presets,defaultUid:String(data.profile?.uid||'')};
    }
    if (message?.type === 'gal-page-save-binding') {
      if(!sender.tab||sender.frameId!==0) return {ok:false,error:'只能從 WHIF 主頁面儲存綁定'};
      const source=whifSource(sender.tab.url||'');
      if(!source)return {ok:false,error:'目前不是可辨識的 WHIF 聊天頁面'};
      const p=message.profile||{};
      const clean=v=>String(v==null?'':v).trim();
      const managerNames=Array.isArray(p.managerNames)?p.managerNames.map(clean).filter(Boolean):[];
      const profile={
        uid:clean(p.uid),worldName:clean(p.worldName),cycleTitle:clean(p.cycleTitle),cycleId:clean(p.cycleId),
        managerNames:[...new Set(managerNames)],manager:[...new Set(managerNames)].join('、')
      };
      if(!profile.worldName) return {ok:false,error:'請填寫世界觀名稱'};
      if(!profile.cycleTitle) return {ok:false,error:'請填寫檔案館實際輪迴名稱'};
      if(!galBatchIdentity(profile).worldKey)return {ok:false,error:'世界觀無法辨識，請填寫完整世界觀名稱'};
      if(!/^[A-Za-z0-9_-]{5,160}$/.test(profile.cycleId))
        return {ok:false,error:'輪迴文件 ID 格式無效；請從檔案館複製，不要自行猜'};
      if(profile.managerNames.length<1||profile.managerNames.length>2)
        return {ok:false,error:'副駕駛必須至少 1 位、最多 2 位'};
      if(profile.managerNames.some(name=>/[、，,;；\r\n]/u.test(name)))
        return {ok:false,error:'每個副駕駛欄位只能填一位名稱'};
      const data=await storageGet(['galProfilesByPage']);
      const map=data.galProfilesByPage||{};
      const old=map[source];
      if(old&&(old.cycleId!==profile.cycleId||old.worldName!==profile.worldName||old.cycleTitle!==profile.cycleTitle)&&message.confirmReplace!==true)
        return {ok:false,needsConfirm:true,error:'這個 WHIF 頁面已綁定不同輪迴／世界觀'};
      map[source]=profile;
      await storageSet({galProfilesByPage:map});
      return {ok:true,source,profile};
    }
    if (message?.type === 'gal-page-open-assistant') {
      if(!sender.tab||sender.frameId!==0) return {ok:false,error:'只能從 WHIF 主頁面開啟掃描助手'};
      const source=whifSource(sender.tab.url||'');
      if(!source)return {ok:false,error:'目前不是可辨識的 WHIF 聊天頁面'};
      const data=await storageGet(['galProfilesByPage']);
      const profile=data.galProfilesByPage?.[source];
      if(!profile?.cycleId||!profile?.worldName)
        return {ok:false,needsBinding:true,error:'這個 WHIF 聊天尚未綁定輪迴'};
      try{
        await chrome.scripting.executeScript({target:{tabId:sender.tab.id},world:'MAIN',files:['gal-native-source.js']});
      }catch(_){}
      await chrome.scripting.executeScript({target:{tabId:sender.tab.id},files:['gal-core.js','gal-format-evidence.js','gal-content.js']});
      const expected=chrome.runtime.getManifest().version;
      const loaded=await chrome.tabs.sendMessage(sender.tab.id,{type:'gal-scan-ping'});
      if(loaded?.version!==expected||loaded?.coreVersion!==expected||loaded?.formatEvidenceVersion!==expected||loaded?.formatEvidenceReady!==true)
        return {ok:false,error:'分頁的掃描器或核心版本與已安裝版本不一致；請重新整理 WHIF 頁面'};
      const opened=await chrome.tabs.sendMessage(sender.tab.id,{type:'gal-scan-open',profile});
      return opened?.ok?{ok:true,opened:true}:{ok:false,error:opened?.error||'掃描助手沒有回應'};
    }
    if (message?.type === 'get-status') {
      const data = await storageGet(['watch', 'profilesByChat', 'last']);
      const path = sender.tab && validChat(sender.tab.url || '') ? chatKey(sender.tab.url) : '';
      const bound = path ? data.profilesByChat?.[path] : null;
      return { ok: true, watch: data.watch || {}, configured: !!(bound?.uid && bound?.cycleId && bound?.manager && bound?.key), last: data.last || null };
    }
    if (message?.type === 'queue-message') {
      if (!sender.tab || !validChat(sender.tab.url || '')) return {ok:false, error:'不是可歸檔的 ChatGPT 對話'};
      const path = chatKey(sender.tab.url);
      const { watch = {}, profilesByChat = {} } = await storageGet(['watch','profilesByChat']);
      const profile = profilesByChat[path] || {};
      if (watch[path] !== true) return {ok:false,error:'此對話未啟用監看'};
      if (!profile.key || !profile.uid || !profile.cycleId || !profile.manager) return {ok:false,error:'此 ChatGPT 對話未綁定輪迴；請先在擴充功能內選擇正確輪迴並儲存'};
      const role = message.role, text = message.text, identity = message.identity, order = message.order;
      const isoOrNull = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
      const sourceCreatedAt=isoOrNull(message.sourceCreatedAt);
      const sourceTimeOrigin=['dom','menu','reply-inferred'].includes(message.sourceTimeOrigin)?message.sourceTimeOrigin:null;
      const sourceTimePrecision=['minute','source','minute-estimated'].includes(message.sourceTimePrecision)?message.sourceTimePrecision:null;
      const capturedAt=isoOrNull(message.capturedAt)||new Date().toISOString();
      if (!['me','ai'].includes(role) || typeof text !== 'string' || !text.trim() || text.length > 25000 || typeof identity !== 'string' || identity.length > 256 || !Number.isInteger(order) || order<0 || order>1000000) return {ok:false,error:'訊息欄位不符合限制'};
      const unique = await sha256(path + '|' + identity + '|' + role);
      const conversationHash = (await sha256(path)).slice(0,32);
      const sourceId = 'chrome-' + unique.slice(0,48);
      const dedup = 'sent-v050:' + profile.uid + ':' + profile.cycleId + ':' + unique;
      const sent = await storageGet([dedup]);
      if(sent[dedup] && message.forceResend!==true) return {ok:true,duplicate:true};
      const body = JSON.stringify({uid:profile.uid,cycleId:profile.cycleId,manager:profile.manager,sourceId,chatKey:conversationHash,messageOrder:order,sourceCreatedAt,sourceTimeOrigin,sourceTimePrecision,capturedAt,entries:[{section:'chat',role,text}]});
      try {
        const response = await fetch(ENDPOINT, {method:'POST',headers:{'Authorization':'Bearer '+profile.key,'Content-Type':'application/json; charset=utf-8'},body,cache:'no-store'});
        const result = await response.json().catch(() => ({}));
        if(!response.ok || !result.ok) throw new Error(`HTTP ${response.status}: ${result.error||'無法接收'}`);
        const last = {at:new Date().toISOString(),ok:true,role,preview:text.slice(0,48),result:result.results?.[0]?.status||'ok',chat:path,cycleId:profile.cycleId,sourceCreatedAt,sourceTimeOrigin,sourceTimePrecision};
        const {lastByChat={}}=await storageGet(['lastByChat']);
        lastByChat[path]=last;
        await storageSet({[dedup]:true,last,lastByChat});
        return {ok:true,duplicate:result.results?.[0]?.status==='duplicate'};
      } catch (err) {
        const last={at:new Date().toISOString(),ok:false,error:String(err.message||err),chat:path,cycleId:profile.cycleId,role,preview:text.slice(0,48)};
        const {lastByChat={}}=await storageGet(['lastByChat']);
        lastByChat[path]=last;
        await storageSet({last,lastByChat});
        return {ok:false,error:last.error};
      }
    }
    return {ok:false,error:'未知指令'};
  })().then(sendResponse, e => sendResponse({ok:false,error:String(e)}));
  return true;
});