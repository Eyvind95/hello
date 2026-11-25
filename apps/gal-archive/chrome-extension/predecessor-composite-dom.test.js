'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),p=require('node:path');
const s=fs.readFileSync(p.join(__dirname,'content.js'),'utf8'),block=s.slice(s.indexOf("  const HISTORY_STRUCT="),s.indexOf("  function historyRead(host)"));
function fixture(){
 let order=0;
 const make=(tag,text='',attrs={})=>{
  const n={nodeType:1,tagName:tag.toUpperCase(),attrs,children:[],childNodes:[],parentElement:null,order:order++,getAttribute:k=>attrs[k]??null,contains(other){return other===this||this.childNodes.some(c=>c.contains(other))},matches(selector){return selector.split(',').some(x=>{x=x.trim();return x===tag||(x==='button'&&tag==='button')||(x==='[data-testid="turn-actions"]'&&attrs['data-testid']==='turn-actions')||(x==='[hidden]'&&attrs.hidden!==undefined)})},closest(selector){for(let x=this;x;x=x.parentElement)if(x.matches(selector))return x;return null},compareDocumentPosition(other){return other.order>this.order?4:2},add(...items){for(const i of items){i.parentElement=this;this.childNodes.push(i);if(i.nodeType===1)this.children.push(i)}return this},get innerText(){return this.childNodes.map(c=>c.nodeType===3?c.nodeValue:c.innerText).join('')},get textContent(){return this.innerText}};
  if(text)n.add({nodeType:3,nodeValue:text,order:order++,contains(other){return other===this}});
  return n;
 };
 const ctx={Node:{ELEMENT_NODE:1,TEXT_NODE:3,DOCUMENT_POSITION_FOLLOWING:4},FALLBACK_SKIP:'button,[hidden]',RESPONSE_LABEL:/^(?:ChatGPT 說|你說)$/,getComputedStyle:n=>({display:['SPAN','A','CODE','STRONG','BR','IMG'].includes(n.tagName)?'inline':'block',visibility:'visible'}),historyVisible:n=>!n.closest('[hidden]'),isUserDescendant:n=>!!n.closest('[data-testid="user"]')};
 vm.createContext(ctx);vm.runInContext(block+';globalThis.read=historyCompositeRead;',ctx);
 const owner=make('div','',{'data-turn-key':'stable'}),user=make('div','玩家秘密正文',{'data-testid':'user'});owner.add(user);
 return {make,owner,user,read:ctx.read};
}
test('composite GPT full DOM read has no legacy 30000 limit, preserves literal text and formatting after user',()=>{
 const f=fixture(),{make,owner,user}=f;
 const huge='長'.repeat(41000);
 owner.add(make('h2','ChatGPT 說'),make('p','原文 '+huge).add(make('strong','粗體')),make('pre','保留\\n  縮排'),make('p','ChatGPT 說'),make('button','複製'),make('div','工具文字',{'data-testid':'turn-actions'}),make('img','',{src:'blob:attachment',alt:'圖'}));
 const r=f.read(owner,[user]);
 assert.ok(r.text.includes(huge));assert.ok(r.text.includes('保留\\n  縮排'));assert.ok(r.text.includes('ChatGPT 說'));
 assert.doesNotMatch(r.text,/玩家秘密正文|工具文字|複製/);
 assert.equal(r.structure.find(x=>x.tag==='strong').text,'粗體');assert.equal(r.attachments[0].url,'blob:attachment');assert.ok(r.sourceTextCharacters>41000);assert.equal(r.segments.map(s=>s.text).join('').includes(huge),true);
});
test('composite boundary rejects missing stable source, ambiguous user or only UI',()=>{
 const f=fixture();f.owner.add(f.make('button','複製'));
 assert.throws(()=>f.read(f.owner,[f.user]),/未找到/);
 assert.throws(()=>f.read(f.owner,[]),/唯一玩家/);
 f.owner.attrs['data-turn-key']=null;assert.throws(()=>f.read(f.owner,[f.user]),/穩定回合 ID/);
});
