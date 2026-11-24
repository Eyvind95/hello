'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element(tagName, display, ...children) {
  const node = {
    nodeType: 1, tagName: tagName.toUpperCase(), childNodes: children,
    children: [], style: { display }, parentElement: null,
    sourceStyles: {},
    getAttribute(name) { return this.sourceStyles[name] ?? null; },
    matches() { return false; }
  };
  for (const child of children) {
    if (child.nodeType === 1) {
      child.parentElement = node;
      node.children.push(child);
    } else child.parentElement = node;
  }
  return node;
}
function text(value) {
  return { nodeType: 3, nodeValue: value, parentElement: null };
}
const context = {
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  getComputedStyle(node) {
    return {
      display: node.style.display || 'inline',
      backgroundColor: 'transparent', fontStyle: 'normal',
      fontWeight: node.style.fontWeight || '400',
      borderTopLeftRadius: '0', borderLeftWidth: '0',
      borderLeftStyle: 'none', borderLeftColor: 'transparent'
    };
  }
};
vm.runInNewContext(fs.readFileSync(require.resolve('./gal-core.js'), 'utf8'), context);
const { markdownFromDom, parseGameTime, isEvent, validate } = context.GalArchiveCore;

test('separates a block status table from the following response body', () => {
  const status = element('div', 'block', text('｜2026年8月22日｜'));
  const body = element('span', 'block', text('正文第一段。'));
  const root = element('div', 'block', status, body);
  const result = markdownFromDom(root, { role: 'ai' });
  assert.match(result, /｜2026年8月22日｜\n正文第一段。/);
});

test('preserves boundaries between block response paragraphs', () => {
  const first = element('span', 'block', text('第一段。'));
  const second = element('span', 'block', text('第二段。'));
  const root = element('div', 'block', first, second);
  assert.equal(markdownFromDom(root, { role: 'ai' }), '第一段。\n第二段。');
});

test('does not add a paragraph break around inline spans', () => {
  const inline = element('span', 'inline', text('行內'));
  const root = element('div', 'block', text('前'), inline, text('後'));
  assert.equal(markdownFromDom(root, { role: 'ai' }), '前行內後');
});

test('preserves exact player quote color and independent italic formatting', () => {
  const quote = element('span', 'inline', text('引用。'));
  quote.sourceStyles['data-gal-source-bg'] = 'rgb(37, 12, 87)';
  const italic = element('span', 'inline', text('動作。'));
  italic.sourceStyles['data-gal-source-italic'] = 'italic';
  const other = element('span', 'inline', text('普通文字。'));
  other.sourceStyles['data-gal-source-bg'] = '#250C58';
  const root = element('div', 'block', quote, italic, other);
  assert.equal(markdownFromDom(root, { role: 'me' }), '「引用。」*動作。*普通文字。');
  assert.equal(markdownFromDom(root, { role: 'ai' }), '引用。*動作。*普通文字。');
});

test('keeps event classification, game time, and original scan order after formatting', () => {
  const format = (header, body) => markdownFromDom(element('div', 'block',
    element('div', 'block', text(header)), element('span', 'block', text(body))), { role: 'ai' });
  const later = format('｜2026年8月22日｜09:30｜', '洛倫斯 🦒 回答。');
  const event = format('事件通知｜2026年8月22日｜09:35｜', '事件內容。');
  const earlier = format('｜2026年8月22日｜09:20｜', '洛倫斯 🐆 回答。');
  assert.equal(isEvent(event), true);
  assert.equal(isEvent(later), false);
  assert.equal(parseGameTime(later).iso, '2026-08-22T01:30:00.000Z');
  const result = validate([
    { role: 'ai', text: '這裡是完整的輪迴開場。' },
    { role: 'me', text: '第一輪。' }, { role: 'ai', text: later },
    { role: 'ai', text: event },
    { role: 'me', text: '第二輪。' }, { role: 'ai', text: earlier }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.pairs, 2);
  assert.equal(result.warnings.length, 1);
  assert.equal(JSON.stringify(result.messages.map(row => row.scanIndex)), '[1,2,4,5]');
  assert.equal(result.messages[0].gameTime, result.messages[1].gameTime);
  assert.equal(result.messages[3].text, earlier);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].scanIndex, 3);
  assert.equal(result.events[0].status, 'accepted');
  assert.equal(result.events[0].gameTime, '2026-08-22T01:35:00.000Z');
});

test('projects only a matching leading WHIF template and preserves literal story markup', () => {
  const header = '｜2026年8月22日｜09:30｜';
  const prose = '他說「保留 {{literal}} 和 *斜體*」。';
  const scanned = header + '\n' + prose + '下一段。';
  const fence = String.fromCharCode(96).repeat(3);
  const source = '{{章節名稱}}\n' + fence + '\n' + header + '\n' + fence + '\n' + prose + '\n\n下一段。';
  const compare = context.GalArchiveCore.compareNativeParagraphs;
  const opts = {source:'whif-message-content', statusText:header, chapterTitle:'章節名稱'};
  const result = compare(scanned, source, opts);
  assert.equal(result.text, header + '\n\n' + prose + '\n\n下一段。');
  assert.equal(result.comparison.nativeBodyParagraphs, 2);
  assert.equal(result.comparison.nativeStatusBlankLines, 1);
  assert.equal(compare(scanned, source, {...opts, chapterTitle:'其他章節'}).text, null);
  assert.equal(compare(scanned, source, {...opts, source:'native-copy'}).text, null);
  assert.equal(compare(scanned, source.replace('{{literal}}', ''), opts).text, null);
});

test('projects only an aligned body code block and leaves literal code and real changes intact', () => {
  const header='｜2026年8月22日｜09:30｜';
  const code='【終端】\nconst literal = "{{keep}}";';
  const fence=String.fromCharCode(96).repeat(3);
  const raw=[fence,header,fence,'',fence,code,fence,'','下一段。'].join('\n');
  const scanned=header+'\n'+code+'\n下一段。';
  const compare=context.GalArchiveCore.compareNativeParagraphs;
  const result=compare(scanned,raw,{statusText:header,codeBlocks:[code]});
  assert.equal(result.text,header+'\n\n'+code+'\n\n下一段。');
  assert.equal(result.comparison.formatMarkers.at(-1).kind,'rendered-body-code-fence');
  assert.equal(compare(scanned,raw,{statusText:header}).text,null);
  assert.equal(compare(scanned,raw.replace('下一段。','另一段。'),{statusText:header,codeBlocks:[code]}).text,null);
  const literal=header+'\n'+[fence,code,fence,'下一段。'].join('\n');
  assert.equal(compare(literal,raw,{statusText:header,codeBlocks:[code]}).text.replace(/\s/g,''),
    literal.replace(/\s/g,''));
});

test('serializes WHIF q elements with visible Chinese quotation marks', () => {
  const quote = element('q', 'inline', text('紅色等級'));
  const root = element('div', 'block', text('屬於中央管理局'), quote, text('的緊急通訊信號。'));
  assert.equal(markdownFromDom(root, { role: 'ai' }), '屬於中央管理局「紅色等級」的緊急通訊信號。');
});

test('restores untimed WHIF event native paragraphs after q quote serialization', () => {
  const quote1 = element('q', 'inline', text('砰——！'));
  const quote2 = element('q', 'inline', text('緊急通報：C區邊境出現高強度精神污染源，疑似大規模暴走事件。'));
  const root = element('div', 'block',
    element('p', 'block', text('就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。')),
    element('p', 'block', quote1),
    element('p', 'block', text('一聲沉悶的爆裂聲從基地遠處的通訊頻道中傳來。')),
    element('p', 'block', quote2)
  );
  const scanned = markdownFromDom(root, { role: 'ai' });
  assert.equal(scanned,
    '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。\n「砰——！」\n一聲沉悶的爆裂聲從基地遠處的通訊頻道中傳來。\n「緊急通報：C區邊境出現高強度精神污染源，疑似大規模暴走事件。」');
  const hidden = '{{below context is ' + 'x'.repeat(148) + '}}\n';
  const native = hidden +
    '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。\n\n「砰——！」\n\n一聲沉悶的爆裂聲從基地遠處的通訊頻道中傳來。\n\n「緊急通報：C區邊境出現高強度精神污染源，疑似大規模暴走事件。」';
  const result = context.GalArchiveCore.compareNativeParagraphs(scanned, native, {
    event: true,
    eventTitle: '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。',
    source: 'whif-event-content'
  });
  assert.equal(result.comparison.contentEqual, true);
  assert.equal(result.comparison.clockEqual, true);
  assert.equal(result.comparison.formatMarkers[0].kind, 'leading-whif-event-hidden-template');
  assert.equal(result.text.replace(/\s/g,''), scanned.replace(/\s/g,''));
});

test('serializes CSS font-weight as markdown bold without requiring a strong tag', () => {
  const bold = element('span', 'inline', text('粗體。'));
  bold.style.fontWeight = '700';
  const normal = element('span', 'inline', text('普通。'));
  const root = element('div', 'block', bold, normal);
  assert.equal(markdownFromDom(root, { role: 'ai' }), '**粗體。**普通。');
});

test('restores balanced native event dialogue quotes when DOM omits only those quotes', () => {
  const compare = context.GalArchiveCore.compareNativeParagraphs;
  const scanned = [
    '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。',
    '砰——！',
    '廣播中機械化的聲音帶著不容置疑的緊迫感，',
    '7F所有成員立即進入戰備狀態！',
    '沉聲道：',
    '看來休息時間結束了。'
  ].join('\n');
  const hidden = '{{Below context is an event which has just occurred. ' + 'x'.repeat(120) + '}}\n';
  const native = hidden + [
    '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。',
    '',
    '「砰——！」',
    '',
    '廣播中機械化的聲音帶著不容置疑的緊迫感，「7F所有成員立即進入戰備狀態！」',
    '',
    '沉聲道：「看來休息時間結束了。」'
  ].join('\n');
  const result = compare(scanned, native, {
    event: true,
    eventTitle: '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。',
    source: 'whif-event-content'
  });
  assert.equal(result.comparison.contentEqual, true);
  assert.equal(result.comparison.clockEqual, true);
  assert.equal(result.comparison.eventQuoteProjection.pairs, 3);
  assert.ok(result.comparison.formatMarkers.some(marker => marker.kind === 'native-event-dialogue-quotes'));
  assert.equal((result.text.match(/「/g)||[]).length, 3);
  assert.equal(result.text, native.slice(hidden.length));

  const changed = compare(scanned, native.replace('休息時間結束了','休息時間真的結束了'), {
    event: true,
    eventTitle: '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。',
    source: 'whif-event-content'
  });
  assert.equal(changed.text, null);

  const unbalanced = compare(scanned, native.replace('「砰——！」','「砰——！'), {
    event: true,
    eventTitle: '就在米契爾試圖再次修正凱文的握法時，原本平靜的客廳空氣卻突兀地凝滯了。',
    source: 'whif-event-content'
  });
  assert.equal(unbalanced.text, null);
});

test('restores an untimed WHIF event only after an exact hidden-context projection', () => {
  const scanned = '突發事件\n「第一句。」\n「第二句。」';
  const hidden = '{{below context is ' + 'x'.repeat(148) + '}}\n';
  const compare = context.GalArchiveCore.compareNativeParagraphs;
  const ok = compare(scanned, hidden + '突發事件\n\n「第一句。」\n\n「第二句。」', {
    event: true,
    eventTitle: '突發事件',
    source: 'whif-event-content'
  });
  assert.equal(ok.comparison.contentEqual, true);
  assert.equal(ok.comparison.clockEqual, true);
  assert.equal(ok.comparison.formatMarkers[0].kind, 'leading-whif-event-hidden-template');
  assert.equal(ok.text, '突發事件\n\n「第一句。」\n\n「第二句。」');

  const changed = compare(scanned, hidden + '突發事件\n\n「第一句。」\n\n「不同內容。」', {
    event: true,
    eventTitle: '突發事件',
    source: 'whif-event-content'
  });
  assert.equal(changed.text, null);

  const placeholder = compare(scanned, '{{user}}\n' + scanned, {
    event: true,
    eventTitle: '突發事件',
    source: 'whif-event-content'
  });
  assert.equal(placeholder.text, null);
});

if(process.env.GAL_ARCHIVE_FENCED_SCAN){
  test('cycle 17 aligned fence reconstruction uses actual exported blocks at 6, 8 and 70',()=>{
    const exportData=JSON.parse(fs.readFileSync(process.env.GAL_ARCHIVE_FENCED_SCAN,'utf8'));
    const compare=context.GalArchiveCore.compareNativeParagraphs;
    const fence=String.fromCharCode(96).repeat(3);
    for(const index of [6,8,70]){
      const row=exportData.messages.find(entry=>entry.scanIndex===index);
      const audit=exportData.paragraphAudit.ai.rows.find(entry=>entry.scanIndex===index).comparison;
      const positions=[...row.text.matchAll(/\S/gu)];
      const start=audit.firstDifference.nonWhitespaceIndex-1;
      const from=positions[start].index;
      const last=positions[start+audit.remainingUnexplained.scanned-1];
      const end=last.index+last[0].length;
      assert.equal(row.text[from-1],'\n');
      assert.ok(end===row.text.length||row.text[end]==='\n');
      const status=row.text.slice(0,from).trimEnd();
      const code=row.text.slice(from,end);
      const candidate=[fence,status,fence,'',fence,code,fence].join('\n')+row.text.slice(end);
      const result=compare(row.text,candidate,{statusText:status,codeBlocks:[code]});
      assert.equal(result.comparison.contentEqual,true);
      assert.equal(result.comparison.comparableNativeNonWhitespace,audit.scannedNonWhitespace);
      assert.equal(result.comparison.formatMarkers.at(-1).nonWhitespaceChars,6);
      assert.equal(result.text.replace(/\s/g,''),row.text.replace(/\s/g,''));
    }
    assert.deepEqual(exportData.events.map(event=>event.scanIndex),[11,46]);
    assert.deepEqual(exportData.events.map(event=>(event.text.match(/「/g)||[]).length),[2,3]);
  });
}

if(process.env.GAL_ARCHIVE_EVENT_COPY&&process.env.GAL_ARCHIVE_FENCED_SCAN){
  test('cycle 17 copied events 11 and 46 verify the title and status fences independently',()=>{
    const exportData=JSON.parse(fs.readFileSync(process.env.GAL_ARCHIVE_FENCED_SCAN,'utf8'));
    const compare=context.GalArchiveCore.compareNativeParagraphs;
    for(const event of exportData.events){
      const copied=fs.readFileSync(process.env.GAL_ARCHIVE_EVENT_COPY+'/event-'+event.scanIndex+'.txt','utf8');
      const opts={event:true,eventTitle:event.title,source:'whif-event-content'};
      const result=compare(event.text,copied,opts);
      assert.equal(result.comparison.contentEqual,true);
      assert.equal(result.comparison.nativeBodyParagraphs,3);
      assert.equal(result.text.replace(/\s/g,''),event.text.replace(/\s/g,''));
      assert.equal(parseGameTime(result.text).iso,event.gameTime);
      assert.equal((result.text.match(/「/g)||[]).length,event.scanIndex===11?2:3);
      assert.equal(result.comparison.formatMarkers[0].kind,event.scanIndex===11?'event-title-code-fence':'status-code-fence');
      // Reconstruct a source with the measured excess prefix length; no private
      // template contents are assumed or committed to the repository.
      const prefix=event.scanIndex===11?'{{'+'x'.repeat(162)+'}}\n\n':
        '{{'+'x'.repeat(80)+'}}\n{{'+'y'.repeat(89)+'}}\n';
      const projected=compare(event.text,prefix+copied,opts);
      const audit=exportData.paragraphAudit.events.rows.find(row=>row.scanIndex===event.scanIndex).comparison;
      assert.equal(projected.comparison.nativeNonWhitespace,audit.nativeNonWhitespace);
      assert.equal(projected.comparison.remainingUnexplained.native,0);
      assert.equal(projected.text,result.text);
      assert.equal(compare(event.text,prefix+copied+'不同的原文。',opts).text,null);
      if(event.scanIndex===46){
        // The actual diagnostic locates both templates in the title/status
        // prefix, but does not expose their contents or exact line placement.
        const context='{{below context is '+('x'.repeat(148))+'}}';
        const companion='{{speaker}}';
        const titleLine=copied.split('\n')[0];
        for(const native of [context+'\n'+companion+copied,
          context+'\n'+titleLine+companion+copied.slice(titleLine.length)]){
          const aligned=compare(event.text,native,opts);
          assert.equal(aligned.text,result.text);
          assert.equal(aligned.comparison.nativeNonWhitespace,628);
          assert.equal(aligned.comparison.comparableNativeNonWhitespace,445);
          assert.equal(JSON.stringify(aligned.comparison.formatMarkers.map(m=>m.nonWhitespaceChars)),'[166,11,6]');
          assert.equal(aligned.comparison.remainingUnexplained.native,0);
          assert.equal(compare(event.text,native+'真正不同的正文。',opts).text,null);
          assert.equal(compare(event.text,native.replace(companion,'{{user}}'),opts).text,null);
        }
      }
    }
  });
}

test('cycle 13 event 421 restores omitted quote pairs but keeps its original trailing closer', () => {
  const compare=context.GalArchiveCore.compareNativeParagraphs;
  const hidden='{{Below context is an event which has just occurred. Please respond.}}\n';
  const native=hidden+'警報響起：「警告，B3有污染。」\n\n米契爾看向凱文：「B3怎麼會……」故事繼續。……我們必須立刻過去。」';
  const scanned='警報響起：\n警告，B3有污染。\n米契爾看向凱文：\nB3怎麼會……\n故事繼續。……我們必須立刻過去。」';
  const opts={source:'whif-event-content',event:true,eventTitle:'警報響起'};
  const result=compare(scanned,native,opts);
  assert.equal(result.comparison.contentEqual,true);
  assert.equal(result.comparison.clockEqual,true);
  assert.equal(result.comparison.formatMarkers[0].kind,'leading-whif-event-hidden-template');
  assert.equal(result.comparison.formatMarkers[1].kind,'native-event-dialogue-quotes');
  assert.equal(result.comparison.formatMarkers[1].tokens,4);
  assert.equal(result.comparison.eventQuoteProjection.pairs,2);
  assert.equal(result.comparison.eventQuoteProjection.preservedVisibleQuotes,1);
  assert.equal(result.comparison.remainingUnexplained.scanned,0);
  assert.equal(result.comparison.remainingUnexplained.native,0);
  assert.equal(result.text,native.slice(hidden.length));
  assert.equal((result.text.match(/「/g)||[]).length,2);
  assert.equal((result.text.match(/」/g)||[]).length,3);
  assert.equal(compare(scanned,native.replace('B3有污染','B3無污染'),opts).text,null);
  assert.equal(compare(scanned.replace(/」$/,''),native,opts).text,null);
  assert.equal(compare(scanned,native.slice(hidden.length),opts).text,null);
  assert.equal(compare(scanned,'{{user}}\n'+native.slice(hidden.length),opts).text,null);
});
if(process.env.GAL_ARCHIVE_CYCLE13_EVENT_THREE_ROW){
  test('cycle 13 event 421 real preview restores native paragraphs without editing content',()=>{
    const preview=JSON.parse(fs.readFileSync(process.env.GAL_ARCHIVE_CYCLE13_EVENT_THREE_ROW,'utf8'));
    const event=preview.rows.find(row=>row.eventEvidence?.kind==='event-message');
    assert.ok(event);
    const compare=context.GalArchiveCore.compareNativeParagraphs;
    const result=compare(event.scannedText,event.nativeText,{
      source:'whif-event-content',event:true,eventTitle:''
    });
    const original=event.nativeText.replace(/^\{\{[^{}\n]+\}\}[ \t]*\n(?:[ \t]*\n)*/u,'');
    assert.equal(result.text,original);
    assert.equal(result.comparison.eventQuoteProjection.pairs,2);
    assert.equal(result.comparison.eventQuoteProjection.preservedVisibleQuotes,1);
    assert.equal(result.comparison.remainingUnexplained.scanned,0);
    assert.equal(result.comparison.remainingUnexplained.native,0);
    assert.equal(result.comparison.formatMarkers[1].tokens,4);
  });
}

test('historical 2026年8月22日 18:42 opening accepts both zero-padded and original month/day spelling', () => {
  const original=[
    '｜2026年8月22日（星期六）｜',
    '｜🕒18:42｜🌤️晴轉多雲｜',
    '｜📍基甫納前線基地・7F宿舍客廳｜',
    '｜🍿暴走值：8%｜',
    '基甫納前線基地，7F。',
    '電梯停下時，門外沒有尋常宿舍走廊。'
  ].join('\n');
  const plain='｜2026/8/22（星期六）｜\n｜🕒18:42｜\n'+original.split('\n').slice(2).join('\n');
  const padded='｜2026/08/22（星期六）｜\n｜🕒18:42｜\n'+original.split('\n').slice(2).join('\n');
  const clock='2026-08-22T10:42:00.000Z';
  for(const text of [original,plain,padded]){
    assert.equal(parseGameTime(text)?.iso,clock);
    assert.equal(context.GalArchiveCore.isAllowedOpeningRow({role:'ai',text}),true);
    const result=validate([
      {role:'ai',text},
      {role:'me',text:'我走進客廳。'},
      {role:'ai',text:'｜2026年8月22日｜\n｜🕒18:45｜\n洛倫斯向我點頭。'}
    ]);
    assert.equal(result.ok,true,JSON.stringify(result.errors));
    assert.equal(result.opening,text);
    assert.equal(result.pairs,1);
    assert.equal(result.messages.length,2);
    assert.equal(result.messages[0].role,'me');
    assert.equal(result.messages[1].role,'ai');
    assert.equal(result.messages[1].gameTime,'2026-08-22T10:45:00.000Z');
    assert.equal(result.messages.some(row=>row.text===text),false);
  }
});

test('historical timed opener exception refuses adjacent minutes, dates, roles and events', () => {
  const sample='｜2026年8月22日（星期六）｜\n｜🕒18:42｜\n基甫納前線基地，7F。';
  const invalid=[
    sample.replace('18:42','18:41'),
    sample.replace('18:42','18:43'),
    sample.replace('22日','23日'),
    sample.replace('2026年','2025年'),
    sample.replace('18:42','19:42')
  ];
  for(const text of invalid){
    assert.equal(context.GalArchiveCore.isAllowedOpeningRow({role:'ai',text}),false);
    const result=validate([{role:'ai',text},{role:'me',text:'我進門。'},
      {role:'ai',text:'｜2026年8月22日｜\n｜🕒18:45｜\n米契爾歡迎新來的人。'}]);
    assert.equal(result.ok,false);
    assert.match(result.errors.join('、'),/首則不是可辨識的輪迴開場/);
  }
  assert.equal(context.GalArchiveCore.isAllowedOpeningRow({role:'me',text:sample}),false);
  assert.equal(context.GalArchiveCore.isAllowedOpeningRow({role:'ai',text:'事件通知\n'+sample}),false);
  assert.equal(context.GalArchiveCore.isAllowedOpeningRow({role:'ai',text:'這是無時間輪迴開場。'}),true);
});


test('cycle 3 final two replies explicitly say 日期不詳／時間不詳 and remain paired with null clocks',()=>{
 const opening='｜2026年8月22日（星期六）｜\n｜🕒18:42｜\n基甫納前線基地，7F。開場。';
 const aiKnown=(time,body)=>'｜2026年8月23日（星期日）｜\n｜🕒'+time+'｜\n'+body;
 const aiUnknown=(state,body)=>'｜日期不詳｜\n｜🕒時間不詳｜🚨'+state+'｜\n｜📍維度夾縫｜\n'+body;
 const a=aiUnknown('意識崩潰','劇情中的時間與空間已不再可確認。');
 const b=aiUnknown('維度抹除','虛無之海中的故事仍然按原文先後發生。');
 const rows=[
  {role:'ai',text:opening},
  {role:'me',text:'第一則玩家訊息。'},
  {role:'ai',text:aiKnown('07:28','第一則已知時間的 AI 回覆。')},
  {role:'me',text:'第二則玩家訊息。'},
  {role:'ai',text:aiKnown('07:29','第二則已知時間的 AI 回覆。')},
  {role:'me',text:'第三則玩家訊息。'},
  {role:'ai',text:a},
  {role:'me',text:'第四則玩家訊息。'},
  {role:'ai',text:b}
 ];
 const result=validate(rows);
 assert.equal(result.ok,true,JSON.stringify(result.errors));
 assert.equal(result.pairs,4);
 assert.equal(result.messages.length,8);
 assert.equal(result.unknownGameTimeCount,4);
 assert.equal(result.messages[4].gameTime,null);
 assert.equal(result.messages[5].gameTime,null);
 assert.equal(result.messages[6].gameTime,null);
 assert.equal(result.messages[7].gameTime,null);
 assert.equal(result.messages[5].text,a);
 assert.equal(result.messages[7].text,b);
 assert.equal(result.warnings.filter(w=>w.includes('日期不詳')).length,2);
 assert.equal(context.GalArchiveCore.isExplicitUnknownGameTime(a),true);
 assert.equal(context.GalArchiveCore.isExplicitUnknownGameTime(b),true);
 assert.equal(parseGameTime(a),null);
 assert.equal(parseGameTime(b),null);
});

test('unknown-time allowance requires both header lines and never fills missing dates by guessing',()=>{
 const unknown='｜日期不詳｜\n｜🕒時間不詳｜\n故事內容。';
 const incomplete=[
  '｜日期不詳｜\n｜🕒07:29｜\n故事內容。',
  '｜2026年8月23日｜\n｜🕒時間不詳｜\n故事內容。',
  '｜日期不詳｜\n故事裡提到時間不詳。'
 ];
 for(const x of incomplete){
  assert.equal(context.GalArchiveCore.isExplicitUnknownGameTime(x),false);
  const checked=validate([
   {role:'ai',text:'這是無時間輪迴開場。'},
   {role:'me',text:'玩家提問。'},
   {role:'ai',text:x}
  ]);
  assert.equal(checked.ok,false);
  assert.match(checked.errors.join(' '),/沒有可辨識劇情時間.*原生無時間來源未通過/);
 }
 const prose='故事正文的開始。\n｜日期不詳｜\n｜🕒時間不詳｜\n這是故事中的引用，不是狀態欄。';
 assert.equal(context.GalArchiveCore.isExplicitUnknownGameTime(prose),false);
 assert.equal(context.GalArchiveCore.isExplicitUnknownGameTime(unknown),true);
 const result=validate([
  {role:'ai',text:'這是無時間輪迴開場。'},
  {role:'me',text:'玩家說話。'},
  {role:'ai',text:unknown}
 ]);
 assert.equal(result.ok,true);
 assert.equal(result.messages[0].gameTime,null);
 assert.equal(result.messages[1].gameTime,null);
});

test('native paragraphs remain comparable when both sides explicitly declare time unknown',()=>{
 const text='｜日期不詳｜\n｜🕒時間不詳｜🚨意識崩潰｜\n｜📍維度夾縫｜\n\n第一段。\n\n第二段。';
 const fromDom=text.replace(/\n\n/g,'\n');
 const result=context.GalArchiveCore.compareNativeParagraphs(fromDom,text);
 assert.equal(result.comparison.clockEqual,true);
 assert.equal(result.comparison.contentEqual,true);
 assert.equal(result.text,text);
});


test('cycle 3 historic chapter HUD restores hidden template, status fence and balanced dialogue quotes',()=>{
 const title='《全員精神穩定，感情除-外》:';
 const status='｜2026年8月22日（星期六）｜\n｜🕒19:13｜🚨紅色警戒｜\n｜📍基甫納前線基地・中央指揮部｜\n｜🍿暴走值：16%｜';
 const rendered=title+'\n'+status+'\n那聲簡潔有力的\n好\n字甫一落下。洛倫斯沉聲道：\n維諾，回報。\n在呢，隊長。';
 const native=title+'\n{{隱藏的章節說明}}\n'+
  '\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n那聲簡潔有力的「好」字甫一落下。\n\n洛倫斯沉聲道：「維諾，回報。」\n\n「在呢，隊長。」';
 const expected=title+'\n'+status+'\n\n那聲簡潔有力的「好」字甫一落下。\n\n洛倫斯沉聲道：「維諾，回報。」\n\n「在呢，隊長。」';
 const comparison=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  source:'whif-message-content',statusText:status,codeBlocks:[]
 });
 assert.equal(comparison.comparison.contentEqual,true);
 assert.equal(comparison.comparison.clockEqual,true);
 assert.equal(comparison.comparison.legacyMessageProjection.omittedQuotePairs,3);
 assert.equal(comparison.comparison.legacyMessageProjection.statusRows,4);
 assert.deepEqual(JSON.parse(JSON.stringify(comparison.comparison.formatMarkers.map(x=>x.kind))),[
  'whif-legacy-hidden-template','whif-legacy-status-code-fence',
  'whif-legacy-balanced-dialogue-quotes'
 ]);
 assert.equal(comparison.text,expected);
});

test('cycle 3 historic HUD preserves already visible quotes and recovers only missing quote pairs',()=>{
 const title='《全員精神穩定，感情除-外》:';
 const status='｜2026年8月23日（星期日）｜\n｜🕒07:21｜🚨污染入侵警報｜\n｜📍基甫納前線基地・7F走廊｜';
 const body='「你過來。」洛倫斯看著對方，說：好。\n洛倫斯將手按在門邊。';
 const restored='「你過來。」洛倫斯看著對方，說：「好」。\n\n洛倫斯將手按在門邊。';
 const native=title+'\n{{舊式段落}}\n\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n'+restored;
 const result=context.GalArchiveCore.compareNativeParagraphs(title+'\n'+status+'\n'+body,native,{
  source:'whif-message-content',statusText:status
 });
 assert.equal(result.comparison.contentEqual,true);
 assert.equal(result.comparison.legacyMessageProjection.omittedQuotePairs,1);
 assert.equal(result.comparison.legacyMessageProjection.preservedVisibleQuotes,2);
 assert.equal(result.text,title+'\n'+status+'\n\n'+restored);
});

test('cycle 3 unknown-time final two replies restore legacy HUD without forging story clocks',()=>{
 for(const [status,body] of [
  ['｜日期不詳｜\n｜🕒時間不詳｜🚨狀態：意識崩潰｜\n｜📍維度夾縫｜',
    '那片黑暗中，時間失去了意義。米契爾……'],
  ['｜日期不詳｜\n｜🕒時間不詳｜🚨維度抹除｜\n｜📍虛無之海｜',
    '那根金色的絲線斷了。']
 ]){
  const scanned=status+'\n'+body;
  const source='{{歷史章節狀態}}\n\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n'+body;
  const result=context.GalArchiveCore.compareNativeParagraphs(scanned,source,{
   source:'whif-message-content',statusText:status
  });
  assert.equal(result.comparison.contentEqual,true);
  assert.equal(result.comparison.clockEqual,true);
  assert.equal(result.comparison.legacyMessageProjection.omittedQuotePairs,0);
  assert.equal(result.text,status+'\n\n'+body);
  assert.equal(parseGameTime(result.text),null);
  assert.equal(context.GalArchiveCore.isExplicitUnknownGameTime(result.text),true);
 }
});

test('legacy WHIF projection refuses body tampering, wrong dates, placeholders and mismatched context',()=>{
 const title='《全員精神穩定，感情除-外》:';
 const status='｜2026年8月22日（星期六）｜\n｜🕒19:13｜🚨紅色警戒｜\n｜📍指揮部｜';
 const rendered=title+'\n'+status+'\n可靠正文。';
 const source=(ctx,body='可靠正文。')=>
  title+'\n{{'+ctx+'}}\n\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n'+body;
 const invalid=[
  source('章節','故事被悄悄改掉。'),
  source('user'),
  source('img:123.png'),
  source('章節').replace('19:13','19:14'),
  source('章節').replace('可靠正文。','「可靠正文。'),
  source('章節').replace('可靠正文。','可靠正文。接續捏造。'),
  title+'\n{{章節甲}}\n{{章節乙}}\n\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n可靠正文。'
 ];
 for(const native of invalid){
  const result=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
   source:'whif-message-content',statusText:status
  });
  assert.equal(result.text,null,'reject '+native.slice(0,80));
  assert.equal(result.comparison.contentEqual,false);
 }
});

test('historical WHIF projection does not apply to ordinary message without required fenced HUD',()=>{
 const status='｜2026年8月22日｜\n｜🕒19:13｜';
 const native='{{模板}}\n'+status+'\n正文。';
 const rendered=status+'\n正文。';
 const result=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{source:'whif-message-content',statusText:status});
 // The older preamble-only handler legitimately removes this exact,
 // pre-verified template, but the NEW fenced-HUD projection must not run.
 assert.equal(result.text,rendered);
 assert.equal(result.comparison.legacyMessageProjection,undefined);
 assert.ok(result.comparison.formatMarkers.some(x=>x.kind==='leading-whif-template'));
});


test('historic WHIF hidden chapter template can share the visible world label line',()=>{
 const title='《全員精神穩定，感情除-外》:';
 const status='｜2026年8月22日（星期六）｜\n｜🕒19:13｜🚨紅色警戒｜\n｜📍基甫納前線基地・中央指揮部｜';
 const body='那聲簡潔有力的\n好\n字甫一落下。';
 const sourceBody='那聲簡潔有力的「好」字甫一落下。';
 for(const prefix of [
  title+'{{隱藏章節}}',
  title+' {{隱藏章節}}',
  title+'\n{{隱藏章節}}',
  title+'\n  {{隱藏章節}}'
 ]){
  const original=prefix+'\n\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n'+sourceBody;
  const result=context.GalArchiveCore.compareNativeParagraphs(title+'\n'+status+'\n'+body,original,{
   source:'whif-message-content',statusText:status
  });
  assert.equal(result.comparison.contentEqual,true,JSON.stringify(result.comparison.legacyProjectionTrace));
  assert.equal(result.comparison.legacyMessageProjection.omittedQuotePairs,1);
  assert.equal(result.text,title+'\n'+status+'\n\n'+sourceBody);
 }
});

test('historic WHIF failed projections report safe stage diagnostics without source story content',()=>{
 const title='《全員精神穩定，感情除-外》:';
 const status='｜2026年8月22日｜\n｜🕒19:13｜\n｜📍基地｜';
 const rendered=title+'\n'+status+'\n原文。';
 const native=title+'{{隱藏章節}}\n\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n變造。';
 const result=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  source:'whif-message-content',statusText:status
 });
 assert.equal(result.text,null);
 assert.equal(result.comparison.contentEqual,false);
 assert.equal(result.comparison.legacyProjectionTrace.stage,'full-text-compare');
 assert.equal(result.comparison.legacyProjectionTrace.valid,false);
 assert.equal(JSON.stringify(result.comparison.legacyProjectionTrace).includes('變造'),false);
});


test('historical opening keeps original paragraph boundaries, not a flattened DOM block',()=>{
 const status=[
  '｜2026年8月22日（星期六）｜',
  '｜🕒18:42｜🌤️晴轉多雲｜',
  '｜📍基甫納前線基地・7F宿舍客廳｜',
  '｜🍿暴走值：8%｜',
  '｜🐆嚮導值：96%｜💭：先觀察。｜'
 ].join('\n');
 const body=[
  '基甫納前線基地，7F。',
  '電梯停下時，門外沒有尋常宿舍走廊。',
  '正前方只有一道需要權限開啟的深色門。',
  '門鎖亮起綠燈。',
  '「房間在右側。」',
  '7F的第一天，就這樣開始了。'
 ].join('\n\n');
 const rendered=status+'\n'+body.replace(/\n/g,'');
 const expected=status+'\n\n'+body;
 const native='\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n'+body;
 const result=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  opening:true,source:'whif-message-content',statusText:status
 });
 assert.equal(result.comparison.contentEqual,true);
 assert.equal(result.comparison.clockEqual,true);
 assert.equal(result.text,expected);
 assert.equal((result.text.match(/\n\n/g)||[]).length,6);
 assert.equal(parseGameTime(result.text)?.iso,'2026-08-22T10:42:00.000Z');
 const check=validate([{role:'ai',text:result.text},
  {role:'me',text:'「你們好。」'},
  {role:'ai',text:'｜2026年8月22日｜\n｜🕒18:44｜\n隊員點頭。'}]);
 assert.equal(check.ok,true,JSON.stringify(check.errors));
 assert.equal(check.opening,result.text);
 assert.equal(check.pairs,1);
 assert.equal(check.messages.length,2);
});

test('generic untimed opener restores native paragraphs without inventing a time',()=>{
 const rendered='這裡是一座古老的城市。第一聲鐘響後，旅人走進大門。有人站在廣場等候。';
 const source='這裡是一座古老的城市。\n\n第一聲鐘響後，旅人走進大門。\n\n有人站在廣場等候。';
 const restored=context.GalArchiveCore.compareNativeParagraphs(rendered,source,{
  opening:true,source:'whif-message-content'
 });
 assert.equal(restored.comparison.contentEqual,true);
 assert.equal(restored.comparison.clockEqual,true);
 assert.equal(restored.text,source);
 assert.equal(parseGameTime(restored.text),null);
});

test('generic untimed opening can include fenced narrative HUD and verified hidden context',()=>{
 const status='｜地點：古堡大廳｜\n｜天空：陰天｜';
 const visible=status+'\n晨光照進大廳。有人輕敲門扉。';
 const source='{{世界開場背景}}\n\n'+
  '\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n'+
  '晨光照進大廳。\n\n有人輕敲門扉。';
 const restored=context.GalArchiveCore.compareNativeParagraphs(visible,source,{
  opening:true,source:'whif-message-content'
 });
 assert.equal(restored.comparison.contentEqual,true);
 assert.equal(restored.comparison.clockEqual,true);
 assert.equal(restored.text,status+'\n\n晨光照進大廳。\n\n有人輕敲門扉。');
 assert.equal(restored.comparison.formatMarkers.some(x=>x.kind==='opening-leading-whif-template'),true);
});

test('opening native restoration rejects modified text, changed clocks and dangerous placeholders',()=>{
 const status='｜2026年8月22日｜\n｜🕒18:42｜';
 const rendered=status+'\n真正的開場。';
 const invalid=[
  '\x60\x60\x60\n'+status+'\n\x60\x60\x60\n\n被換掉的開場。',
  '\x60\x60\x60\n'+status.replace('18:42','18:43')+'\n\x60\x60\x60\n\n真正的開場。',
  '{{image:secret.png}}\n'+rendered,
  '{{user}}\n'+rendered
 ];
 for(const candidate of invalid){
  const result=context.GalArchiveCore.compareNativeParagraphs(rendered,candidate,{
   opening:true,source:'whif-message-content'
  });
  assert.equal(result.text,null,'reject '+candidate.slice(0,45));
 }
 const nonWhitelist='｜2026年8月25日｜\n｜🕒18:42｜\n開場。';
 const denied=context.GalArchiveCore.compareNativeParagraphs(nonWhitelist,nonWhitelist,{
  opening:true,source:'whif-message-content'
 });
 assert.equal(denied.text,null);
 assert.equal(denied.comparison.clockEqual,false);
});


test('full scanner obtains opening native source even when it has no game clock',()=>{
 const source=fs.readFileSync(require.resolve('./gal-content.js'),'utf8');
 assert.match(source,/function boundaryFragmentText\([\s\S]*?if\(metadata\)\{/);
 assert.match(source,/function messageText\([\s\S]*?if\(metadata\)\{/);
 assert.match(source,/const openingEntry=\{role:'ai',text:validation\.opening,scanIndex:0,/);
 assert.match(source,/const openingFormat=applyNativeFormat\(openingEntry,collected,sourceCounts,scanMode,'',false,true\)/);
 assert.match(source,/validation\.opening=openingEntry\.text/);
 assert.match(source,/paragraphAudit=\{opening:openingFormat\.check,/);
 assert.match(source,/openingCheck:openingFormat\.check/);
 assert.match(source,/lastResult\.openingCheck=openingFormat\.check/);
 assert.match(source,/lastResult\.paragraphAudit=paragraphAudit/);
 assert.match(source,/opening:valid\.opening,messages,events/);
 const app=fs.readFileSync(require.resolve('../index.html'),'utf8');
 assert.match(app,/updated\.opening=v\.opening/);
});


test('cycle 12 opening restores four source-only dialogue quote pairs, image wrapper and 19 original blank paragraphs',()=>{
 const rendered=[
 '基甫納前線基地，7F。',
 '電梯停下時，門外沒有尋常宿舍走廊。',
 '正前方只有一道需要權限開啟的深色門。',
 '門鎖亮起綠燈。',
 '進門後，寬敞客廳與後方開放式廚房一覽無遺。沙發旁散著幾件訓練用品，桌上還留著沒收走的終端與水杯。',
 '這裡顯然已經有人生活很久。',
 '米契爾正盤腿坐在地毯上打遊戲，肩上的蜜袋鼯突然抬起頭。',
 '格里安站在廚房前倒水，視線隨聲音轉來。',
 '維諾倚著吧台，像是早就在等著看新隊員長什麼樣。',
 '客廳另一側，諾伊斯沒有說話，只從書頁上方抬了眼。',
 '最後才是洛倫斯。',
 '淺銀金長髮低束在身後，他合上手裡的資料，翠灰綠眼眸從晏序身上掃過，停留片刻。',
 '房間在右側。',
 '他將一張新的7F門卡放上桌面。',
 '其他規矩之後再說。',
 '米契爾從遊戲畫面裡抬頭。',
 '隊長，你這樣很像在嚇新室友。',
 '洛倫斯淡淡看他一眼。',
 '那你閉嘴。',
 '7F的第一天，就這樣開始了。'
 ].join('\n');
 const originalWithQuotes=rendered.replace(/(房間在右側。|其他規矩之後再說。|隊長，你這樣很像在嚇新室友。|那你閉嘴。)/gu,'「$1」');
 const native=originalWithQuotes.replace(/\n/g,'\n\n')+'\n{{image:archive01.png}}';
 const check=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  opening:true,source:'whif-message-content'
 });
 assert.equal(check.comparison.clockEqual,true);
 assert.equal(check.comparison.contentEqual,true);
 assert.equal(check.comparison.openingQuoteProjection.omittedQuotePairs,4);
 assert.equal(check.comparison.openingQuoteProjection.preservedVisibleQuotes,0);
 assert.equal(check.comparison.remainingUnexplained.scanned,0);
 assert.equal(check.comparison.remainingUnexplained.native,0);
 assert.equal((check.text.match(/\n\n/g)||[]).length,19);
 assert.equal((check.text.match(/「/g)||[]).length,4);
 assert.equal(check.text,originalWithQuotes.replace(/\n/g,'\n\n'));
 assert.equal(check.comparison.formatMarkers.some(x=>x.kind==='terminal-image-marker'),true);
 assert.equal(check.comparison.formatMarkers.some(x=>x.kind==='opening-balanced-dialogue-quotes'),true);
 assert.equal(validate([{role:'ai',text:check.text},{role:'me',text:'玩家。'},
   {role:'ai',text:'｜2026年8月22日｜\n｜🕒18:43｜\n正常回覆。'}]).ok,true);
});

test('opening quote restoration protects visible quotes and rejects body changes or unpaired source quotes',()=>{
 const rendered='門打開了。\n「這裡。」他說。\n走廊另一端有人道：進來。';
 const native='門打開了。\n\n「這裡。」他說。\n\n走廊另一端有人道：「進來。」';
 const verified=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  opening:true,source:'whif-message-content'
 });
 assert.equal(verified.comparison.contentEqual,true);
 assert.equal(verified.comparison.openingQuoteProjection.omittedQuotePairs,1);
 assert.equal(verified.comparison.openingQuoteProjection.preservedVisibleQuotes,2);
 assert.equal(verified.text,native);
 for(const altered of [
  native.replace('進來','騙你'),
  native.replace('「進來。」','「進來。'),
  native.replace('「進來。」','進來。」'),
  native.replace('「進來。」','「進來！'),
  '另一個世界的開場。'
 ]){
  const denied=context.GalArchiveCore.compareNativeParagraphs(rendered,altered,{
   opening:true,source:'whif-message-content'
  });
  assert.equal(denied.comparison.contentEqual,false,'Reject '+altered);
  assert.equal(denied.text,null);
 }
 const ordinary=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  opening:false,source:'whif-message-content'
 });
 assert.equal(ordinary.text,null);
});

test('opening quote projection requires verified exact reply and keeps status time intact',()=>{
 const visible='｜2026年8月22日｜\n｜🕒18:42｜\n洛倫斯說：房間在右側。';
 const native='｜2026年8月22日｜\n｜🕒18:42｜\n\n洛倫斯說：「房間在右側。」';
 const restored=context.GalArchiveCore.compareNativeParagraphs(visible,native,{
  opening:true,source:'whif-message-content'
 });
 assert.equal(restored.comparison.contentEqual,true);
 assert.equal(restored.comparison.clockEqual,true);
 assert.equal(restored.text,native);
 const wrongTime=context.GalArchiveCore.compareNativeParagraphs(visible,native.replace('18:42','18:43'),{
  opening:true,source:'whif-message-content'
 });
 assert.equal(wrongTime.text,null);
 assert.equal(wrongTime.comparison.clockEqual,false);
});


test('cycle 5 Yaoban historic 18:42 opening passes structurally with a genuine adjacent timed AI reply',()=>{
 const opening=[
  '｜2026年8月22日（星期六）｜',
  '｜🕒18:42｜🌤️晴轉多雲｜',
  '｜📍基甫納前線基地・7F宿舍客廳｜',
  '｜🍿暴走值：8%｜',
  '｜🐆嚮導值：96%｜💭：先觀察。｜',
  '｜🐿️暴走值：6%｜💭：新隊友耶。｜',
  '｜🐻暴走值：4%｜💭：看起來還好。｜',
  '｜🦊暴走值：9%｜💭：有意思。｜',
  '｜🐦‍⬛暴走值：12%｜💭：……在看。｜',
  '基甫納前線基地，7F。',
  '淺銀金長髮低束在身後，他合上手裡的資料，翠灰綠眼眸從耀斑身上掃過。',
  '「房間在右側。」',
  '7F的第一天，就這樣開始了。'
 ].join('\n');
 const rows=[
  {role:'ai',text:opening},
  {role:'me',text:'嗯，你們好。\n打了聲招呼後，進到房間。'},
  {role:'ai',text:'｜2026年8月22日（星期六）｜\n｜🕒18:43｜\n歡迎來到7F。'}
 ];
 assert.equal(parseGameTime(opening)?.iso,'2026-08-22T10:42:00.000Z');
 assert.equal(context.GalArchiveCore.isAllowedOpeningRow(rows[0]),true);
 const valid=validate(rows,'全員精神穩定，感情除外');
 assert.equal(valid.ok,true,JSON.stringify(valid.errors));
 assert.equal(valid.pairs,1);
 assert.equal(valid.scannedRows,3);
 assert.equal(valid.opening,opening);
 assert.equal(valid.messages.length,2);
});

test('cycle 5 preview does not invent missing first reply clock; reports the underlying validator reason',()=>{
 const rows=[
  {role:'ai',text:'｜2026年8月22日｜\n｜🕒18:42｜\n輪迴開場。'},
  {role:'me',text:'嗯，你們好。\n打了聲招呼後，進到房間。'},
  {role:'ai',text:'洛倫斯看向新隊友。'}
 ];
 const v=validate(rows,'全員精神穩定，感情除外');
 assert.equal(v.ok,false);
 assert.equal(v.pairs,0);
 assert.equal(v.scannedRows,3);
 assert.match(v.errors.join('\n'),/第 3 則 Gal AI 回覆沒有可辨識劇情時間.*原生無時間來源未通過/);
 assert.equal(context.GalArchiveCore.isAllowedOpeningRow(rows[0]),true);
});


test('cycle 5 source-backed untimed first reply is paired with null clock and native paragraph formatting',()=>{
 const opening='｜2026年8月22日（星期六）｜\n｜🕒18:42｜🌤️晴轉多雲｜\n基甫納前線基地，7F。';
 const rendered='新隊員的身影消失在走廊盡頭，房門輕輕闔上。\n米契爾小聲地說：他走路真的好安靜喔。\n洛倫斯淡淡回答：行了。';
 const native='新隊員的身影消失在走廊盡頭，房門輕輕闔上。\n\n米契爾小聲地說：「他走路真的好安靜喔。」\n\n洛倫斯淡淡回答：「行了。」';
 const rows=[
  {role:'ai',text:opening},
  {role:'me',text:'嗯，你們好\n打了聲招呼後，進到房間'},
  {role:'ai',text:rendered,formatSource:{nativeReply:{
   reason:'available',markerCount:1,messageId:'original-first-reply',
   scannedText:rendered,text:native
  }}}
 ];
 const v=validate(rows,'全員精神穩定，感情除外');
 assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.equal(v.pairs,1);
 assert.equal(v.verifiedUntimedCount,1);
 assert.equal(v.unknownGameTimeCount,2);
 assert.equal(v.messages[0].gameTime,null);
 assert.equal(v.messages[1].gameTime,null);
 assert.equal(v.messages[1].verifiedUntimedNative,true);
 const cmp=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(cmp.comparison.contentEqual,true);
 assert.equal(cmp.comparison.clockEqual,true);
 assert.equal(cmp.comparison.verifiedNoClock,true);
 assert.equal(cmp.comparison.openingQuoteProjection.omittedQuotePairs,2);
 assert.equal(cmp.text,native);
 assert.ok(v.warnings.some(w=>w.includes('保留 null')));
});

test('untimed WHIF content can carry one hidden leading context only after entire source comparison',()=>{
 const rendered='門輕輕闔上。米契爾說：很好。';
 const native='{{舊格式章節}}\n\n門輕輕闔上。\n\n米契爾說：「很好。」';
 const make=(text,id='unique',scannedText=rendered)=>({
  role:'ai',text:rendered,formatSource:{nativeReply:{
   reason:'available',messageId:id,markerCount:1,scannedText,text
  }}
 });
 const rows=[
  {role:'ai',text:'這是獨立輪迴開場。'},
  {role:'me',text:'我走進房間。'},
  make(native)
 ];
 const v=validate(rows);
 assert.equal(v.ok,true,JSON.stringify(v.errors));
 const cmp=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(cmp.comparison.contentEqual,true);
 assert.equal(cmp.comparison.clockEqual,true);
 assert.equal(cmp.text,'門輕輕闔上。\n\n米契爾說：「很好。」');
 assert.equal(cmp.comparison.formatMarkers.some(m=>m.kind==='verified-untimed-leading-context'),true);
});

test('unclocked AI requires unique matching original; cannot hide source time or tamper prose',()=>{
 const rendered='洛倫斯淡淡看他一眼。';
 const good='洛倫斯淡淡看他一眼。';
 const make=(source={},text=rendered)=>({role:'ai',text,formatSource:{nativeReply:{
  reason:'available',messageId:'same',markerCount:1,scannedText:text,text:good,...source
 }}});
 const prefix=[{role:'ai',text:'原始無時間開場。'},{role:'me',text:'你們好。'}];
 const cases=[
  make({reason:'native-reader-unavailable'}),
  make({markerCount:2}),
  make({messageId:null}),
  make({scannedText:'別的訊息'}),
  make({text:'洛倫斯冷冷看他一眼。'}),
  make({text:'｜2026年8月22日｜\n｜🕒18:43｜\n'+good}),
  make({text:'｜2026年8月22日｜\n'+good}),
  make({text:'{{image:secret.png}}\n'+good}),
  make({text:'洛倫斯「淡淡看他一眼。'}),
  make({text:good+'其他故事'})
 ];
 for(const row of cases){
  const v=validate([...prefix,row]);
  assert.equal(v.ok,false,JSON.stringify(row.formatSource.nativeReply));
  assert.match(v.errors.join(' '),/原生無時間來源未通過/);
 }
 const dup=validate([...prefix,make(),make()]);
 assert.equal(dup.ok,false);
 assert.match(dup.errors.join(' '),/non-unique-native-message-id/);
 const noProof=validate([...prefix,{role:'ai',text:rendered}]);
 assert.equal(noProof.ok,false);
 assert.equal(noProof.verifiedUntimedCount,0);
});

test('source-proven untimed replies do not weaken regular timed AI or explicit unknown-clock handling',()=>{
 const opening='這裡是獨立開場。';
 const p='玩家打聲招呼。';
 const timed='｜2026年8月22日｜\n｜🕒18:43｜\n米契爾回應。';
 const original=[
  {role:'ai',text:opening},{role:'me',text:p},{role:'ai',text:timed}
 ];
 const v=validate(original);
 assert.equal(v.ok,true);
 assert.equal(v.verifiedUntimedCount,0);
 assert.equal(v.messages[1].gameTime,'2026-08-22T10:43:00.000Z');
 const wronglyLabeled=context.GalArchiveCore.compareNativeParagraphs(
  '回應的狀態欄被隱藏。','｜2026年8月22日｜\n｜🕒18:43｜\n回應的狀態欄被隱藏。',
  {source:'whif-message-content',verifiedUntimedNative:true}
 );
 assert.equal(wronglyLabeled.text,null);
});


test('V0.8.35 accepts one exactly proven untimed WHIF wrapper/fence/image projection across 756 characters',()=>{
 const title='【舊式無時間回覆】';
 const first='隊員們回到走廊。';
 const last='沒有任何遺失的正文。';
 const filler='字'.repeat(756-[...title].length-[...first].length-[...last].length);
 const displayed=[title,first,filler,last].join('\n');
 const native=[title,'{{合法隱藏情境參照}}',first,
  '\x60\x60\x60\n'+filler+'\n\x60\x60\x60',last,'{{img:scene-picture}}'].join('\n');
 assert.equal([...displayed.replace(/\s/g,'')].length,756);
 const reply={role:'ai',text:displayed,formatSource:{nativeReply:{
  reason:'available',markerCount:1,messageId:'unique-whif-1685',
  scannedText:displayed,text:native
 }}};
 const rows=[{role:'ai',text:'這是一則無時間開場。'},
  {role:'me',text:'玩家繼續。'},reply];
 const v=validate(rows);
 assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.equal(v.pairs,1);
 assert.equal(v.verifiedUntimedCount,1);
 assert.equal(v.unknownGameTimeCount,2);
 assert.equal(v.messages[0].gameTime,null);
 assert.equal(v.messages[1].gameTime,null);
 assert.equal(v.messages[1].verifiedUntimedNative,true);
 const result=context.GalArchiveCore.compareNativeParagraphs(displayed,native,{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(result.comparison.contentEqual,true);
 assert.equal(result.comparison.clockEqual,true);
 assert.equal(result.comparison.verifiedNoClock,true);
 assert.equal(result.comparison.untimedWrappedProjection.templateCount,1);
 assert.equal(result.comparison.untimedWrappedProjection.bareFencePairs,1);
 assert.equal(result.comparison.untimedWrappedProjection.terminalImageMarker,true);
 assert.deepEqual(Array.from(result.comparison.formatMarkers,v=>v.kind),[
  'terminal-image-marker','untimed-verified-hidden-context','untimed-verified-bare-fence'
 ]);
 assert.equal(result.comparison.remainingUnexplained.scanned,0);
 assert.equal(result.comparison.remainingUnexplained.native,0);
 assert.equal(result.text.replace(/\s/g,''),displayed.replace(/\s/g,''));
 assert.ok(v.warnings.some(w=>w.includes('保留 null')));
});

test('V0.8.35 never allows untimed story changes or unverified wrapper removal',()=>{
 const title='【標題】';
 const display=title+'\n甲段\n內文仍是原文\n乙段';
 const good=title+'\n{{合法情境}}\n甲段\n\x60\x60\x60\n內文仍是原文\n\x60\x60\x60\n乙段\n{{img:tail}}';
 const reply=(src,overrides={})=>({
  role:'ai',text:display,formatSource:{nativeReply:{
   reason:'available',markerCount:1,messageId:'unique-id',
   scannedText:display,text:src,...overrides
  }}
 });
 const prefix=[{role:'ai',text:'原生開場內容。'},{role:'me',text:'走進去。'}];
 const failures=[
  good.replace('仍是原文','已被更改'),
  good.replace('\x60\x60\x60\n內文','\x60\x60\x60js\n內文'),
  good.replace('\n{{img:tail}}',''),
  good.replace('{{合法情境}}','{{第一模板}}\n{{第二模板}}'),
  good.replace('{{合法情境}}','{{img:not-a-hidden-context}}'),
  good.replace('{{合法情境}}','{{合法情境}}\n｜2026年8月22日｜\n｜🕒18:43｜'),
  good.replace('{{合法情境}}','真實正文{{合法情境}}'),
 ];
 for(const text of failures){
  const v=validate([...prefix,reply(text)]);
  assert.equal(v.ok,false,text.slice(0,100));
  assert.match(v.errors.join(' '),/原生無時間來源未通過/);
 }
 assert.equal(validate([...prefix,reply(good,{markerCount:2})]).ok,false);
 assert.equal(validate([...prefix,reply(good,{messageId:null})]).ok,false);
 assert.equal(validate([...prefix,reply(good),reply(good)]).ok,false);
 assert.equal(validate([...prefix,reply(good,{scannedText:'另一則訊息'})]).ok,false);
 const ordinaryTimed='｜2026年8月22日｜\n｜🕒18:45｜\n'+display;
 const cmp=context.GalArchiveCore.compareNativeParagraphs(ordinaryTimed,good,{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(cmp.text,null);
});

test('V0.8.35 does not silently reinterpret events as untimed ordinary messages',()=>{
 const visible='【事件】\n內容';
 const source='{{隱藏}}\n'+visible;
 const result=context.GalArchiveCore.compareNativeParagraphs(visible,source,{
  source:'whif-event-content',event:true,verifiedUntimedNative:true
 });
 assert.equal(result.comparison.untimedWrappedProjection,null);
 const rows=[{role:'ai',text:'獨立開場。'},{role:'me',text:'開始。'},
  {role:'ai',text:visible,eventType:'event',formatSource:{nativeReply:{
   reason:'available',markerCount:1,messageId:'event-123',scannedText:visible,text:source
  }}}];
 const v=validate(rows);
 assert.equal(v.verifiedUntimedCount,0);
});


function cycle9CombinedFixture(){
 const prefix='{{ctx-test}}\n'; // exactly 12 non-whitespace context chars
 const marker='{{img:abcdefg}}'; // exactly 15 non-whitespace image marker chars
 const start='小智看向走廊。洛倫斯說：你確定嗎？米契爾回答：我已經確認。';
 const tail='望著窗外，繼續記錄每一個事件與當下的回應。';
 const filler='觀'.repeat(447-[...(start+tail).replace(/\s/g,'')].length);
 const rendered=start+'\n\n'+filler+'\n'+tail;
 const nativeBody=start.replace('你確定嗎？','「你確定嗎？」')
  .replace('我已經確認。','「我已經確認。」')+'\n\n'+filler+'\n'+tail;
 const native=prefix+nativeBody+'\n'+marker;
 assert.equal([...rendered.replace(/\s/g,'')].length,447);
 assert.equal([...native.replace(/\s/g,'')].length,478);
 return {rendered,native,prefix,marker,nativeBody};
}
function cycle9SourceRows(nativeOverride,sourceOverride={}){
 const {rendered,native}=cycle9CombinedFixture();
 return [
  {role:'ai',text:'這是一則沒有劇情時間的合法開場。'},
  {role:'me',text:'小智，請繼續。'},
  {role:'ai',text:rendered,formatSource:{nativeReply:{
    reason:'available',messageId:'cycle9-native-230',
    markerCount:1,scannedText:rendered,text:nativeOverride===undefined?native:nativeOverride,
    ...sourceOverride
  }}}
 ];
}
test('V0.8.39: cycle 9 combined hidden context, trailing image and 2 balanced quote pairs preserve every body character',()=>{
 const {rendered,native,nativeBody}=cycle9CombinedFixture();
 const rows=cycle9SourceRows();
 const v=validate(rows,'全員精神穩定，感情除外');
 assert.equal(v.ok,true,JSON.stringify(v.errors));
 assert.equal(v.pairs,1);
 assert.equal(v.verifiedUntimedCount,1);
 assert.equal(v.messages[0].gameTime,null);
 assert.equal(v.messages[1].gameTime,null);
 const cmp=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(cmp.comparison.contentEqual,true);
 assert.equal(cmp.comparison.clockEqual,true);
 assert.equal(cmp.comparison.verifiedNoClock,true);
 assert.equal(cmp.comparison.scannedNonWhitespace,447);
 assert.equal(cmp.comparison.nativeNonWhitespace,478);
 assert.equal(cmp.comparison.remainingUnexplained.native,0);
 assert.equal(cmp.comparison.remainingUnexplained.scanned,0);
 assert.equal(cmp.comparison.untimedCombinedProjection.hiddenContextCount,1);
 assert.equal(cmp.comparison.untimedCombinedProjection.omittedQuotePairs,2);
 assert.equal(cmp.comparison.untimedCombinedProjection.terminalImageMarker,true);
 assert.deepEqual(Array.from(cmp.comparison.formatMarkers,x=>x.kind),[
  'terminal-image-marker',
  'verified-untimed-leading-context-after-image',
  'verified-untimed-balanced-native-quotes'
 ]);
 assert.equal(cmp.text,nativeBody);
 assert.match(cmp.text,/「你確定嗎？」/);
 assert.match(cmp.text,/「我已經確認。」/);
 assert.ok(cmp.text.includes('\n\n'));
 assert.ok(v.warnings.some(w=>w.includes('保留 null')));
});
test('V0.8.39: cycle 9 combined formatting fails closed for prose edits, duplicate ID, missing HUD, unbalanced quotes and visible placeholders',()=>{
 const {rendered,native,prefix,marker}=cycle9CombinedFixture();
 const cases=[
  ['prose swapped',native.replace('記錄每一個事件','遺忘每一個事件'),{}],
  ['hidden prose',native.replace(prefix,prefix+'真實正文不得隱藏'),{}],
  ['changed image marker in narration',native.replace('看向走廊','看向{{img:inner}}走廊'),{}],
  ['trailing marker visible',native,{scannedText:rendered+marker}],
  ['unbalanced native open quote',native.replace('「我已經確認。」','「我已經確認。'),{}],
  ['unbalanced native close quote',native.replace('「你確定嗎？」','你確定嗎？」'),{}],
  ['time exists native only',prefix+'｜2026年8月22日｜\n｜🕒11:15｜\n'+native.slice(prefix.length),{}],
  ['fake context placeholder',native.replace(prefix,'{{user}}\n'),{}],
  ['nested visible placeholders',native.replace(prefix,'{{user|name}}\n'),{}],
  ['multiple hidden templates',native.replace(prefix,prefix+'{{another}}\n'),{}],
  ['unique ID missing',native,{messageId:null}],
  ['two markers same ID',native,{markerCount:2}],
  ['source content not matching scanned DOM',native,{scannedText:'其他回覆'}]
 ];
 for(const [reason,source,overrides] of cases){
  const v=validate(cycle9SourceRows(source,overrides));
  assert.equal(v.ok,false,reason);
  assert.match(v.errors.join(' '),/原生無時間來源未通過/,reason);
 }
 const duplicate=cycle9SourceRows();
 duplicate[0].formatSource={nativeReply:{
  reason:'available',messageId:'cycle9-native-230',markerCount:1,
  scannedText:duplicate[0].text,text:duplicate[0].text
 }};
 assert.equal(validate(duplicate).ok,false,'duplicate original WHIF ID must not be accepted');
 const noOption=context.GalArchiveCore.compareNativeParagraphs(rendered,native,{
  source:'whif-message-content'
 });
 assert.equal(noOption.text,null,'only verified untimed replies may project invisible context');
});
test('V0.8.39: visible curly tokens survive and cannot be consumed as a hidden context',()=>{
 const {rendered,native,marker}=cycle9CombinedFixture();
 const prefix='{{ctx-test}}\n';
 const visible=rendered.replace('小智看向走廊。','小智看向走廊。{{user}}');
 const original=native.replace('小智看向走廊。','小智看向走廊。{{user}}');
 const check=context.GalArchiveCore.compareNativeParagraphs(visible,original,{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(check.comparison.contentEqual,true);
 assert.ok(check.text.includes('{{user}}'));
 const tampered=context.GalArchiveCore.compareNativeParagraphs(visible,original.replace('{{user}}',''),{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(tampered.text,null,'visible player placeholders must not be silently removed');
 const markerBody=context.GalArchiveCore.compareNativeParagraphs(visible,
  original.replace(prefix,'{{img:shadow}}\n'),{
  source:'whif-message-content',verifiedUntimedNative:true
 });
 assert.equal(markerBody.text,null,'leading image marker is never eligible hidden context');
 assert.ok(original.endsWith(marker));
});


function syntheticCycle11Event(){
 const eventTitle='【前線緊急通知】';
 const base=['｜2026年8月23日（星期日）｜','｜🕒08:15｜🌤️晴朗｜'];
 const prefixLen=[...(eventTitle+base.join('')).replace(/\s/g,'')].length;
 const extraLen=165-prefixLen-2;
 assert.ok(extraLen>0);
 const status=[...base,'｜'+'狀'.repeat(extraLen)+'｜'].join('\n');
 const header=eventTitle+'\n'+status+'\n';
 const quoteBodies=Array.from({length:5},(_,i)=>'隊員'+i+'通報：「第'+i+'項已查證。」').join('\n');
 const visibleQuote='請保留「現場原有可見的引號」，不允許被移除。';
 const intro='事件公告：所有隊員依照既有命令執行。';
 const fixed=intro+'\n'+quoteBodies+'\n'+visibleQuote;
 const domBeforePadding=header+fixed.replace(/：「([^」]*)」/g,'：$1');
 const filler='章'.repeat(665-[...domBeforePadding.replace(/\s/g,'')].length);
 const dom=domBeforePadding+'\n'+filler;
 const body=intro+'\n'+quoteBodies+'\n'+visibleQuote+'\n'+filler;
 const leading='{{'+'X'.repeat(162)+'}}\n';
 const post='{{midstatus}}\n'; // 13 non-whitespace characters
 const native=leading+header+post+body;
 assert.equal([...dom.replace(/\s/g,'')].length,665);
 assert.equal([...native.replace(/\s/g,'')].length,854);
 return {dom,native,leading,post,header,body,eventTitle,status};
}
test('cycle 11 synthetic 854-to-665 event: first 166 context, then 13 post-HUD token and 5 missing native quote pairs',()=>{
 const x=syntheticCycle11Event();
 const cmp=context.GalArchiveCore.compareNativeParagraphs(x.dom,x.native,{
  source:'whif-event-content',event:true,eventTitle:x.eventTitle,
  statusText:x.status
 });
 assert.equal(cmp.text!==null,true,JSON.stringify(cmp.comparison.firstDifference));
 assert.equal(cmp.comparison.contentEqual,true);
 assert.equal(cmp.comparison.clockEqual,true);
 assert.equal(cmp.comparison.nativeNonWhitespace,854);
 assert.equal(cmp.comparison.scannedNonWhitespace,665);
 assert.equal(cmp.comparison.eventPostStatusProjection.templateNonWhitespaceChars,13);
 assert.equal(cmp.comparison.eventPostStatusProjection.omittedQuotePairs,5);
 assert.equal(cmp.comparison.eventPostStatusProjection.provenEntireEventText,true);
 assert.equal(cmp.comparison.remainingUnexplained.native,0);
 assert.equal(cmp.comparison.remainingUnexplained.scanned,0);
 assert.equal(cmp.comparison.formatMarkers.some(x=>x.kind==='verified-event-post-status-hidden-template'),true);
 assert.equal(cmp.comparison.formatMarkers.some(x=>x.kind==='verified-event-balanced-native-quotes'),true);
 assert.equal(cmp.text.includes('「現場原有可見的引號」'),true);
 assert.equal((cmp.text.match(/「/g)||[]).length,6);
 assert.equal(cmp.text.includes(x.post.trim()),false);
 assert.equal(cmp.text.includes(x.leading.trim()),false);
 assert.equal(cmp.text.includes('｜🕒08:15｜'),true);
});
test('cycle 11 rejects modified event body, time, status, misplaced context, unbalanced quotes and visible marker loss',()=>{
 const x=syntheticCycle11Event();
 const opts={source:'whif-event-content',event:true,eventTitle:x.eventTitle,statusText:x.status};
 const reject=[
  x.native.replace('第0項已查證','第0項未查證'),
  x.native.replace('08:15','08:16'),
  x.native.replace('晴朗','陰雨'),
  x.native.replace(x.post,'{{user|role}}\n'),
  x.native.replace(x.post,'{{img:missing}}\n'),
  x.native.replace(x.post,'{{midstatus}}\n{{another}}\n'),
  x.native.replace(x.post,'').replace('第0項','{{midstatus}}第0項'),
  x.native.replace('：「第2項已查證。」','：「第2項已查證。'),
  x.native.replace('：「第3項已查證。」','：第3項已查證。」'),
  x.native.replace('「現場原有可見的引號」','現場原有可見的引號'),
  x.native+'附加被刪除的劇情',
  x.native.replace(x.leading,'{{user}}\n')
 ];
 for(const original of reject){
  const cmp=context.GalArchiveCore.compareNativeParagraphs(x.dom,original,opts);
  assert.equal(cmp.text,null,'case should be rejected: '+original.slice(0,20));
 }
});
if(process.env.GAL_ARCHIVE_CYCLE11_EVENT_TEST){
 test('cycle 11 real source data never passes without exact full-text evidence',()=>{
  const f=JSON.parse(fs.readFileSync(process.env.GAL_ARCHIVE_CYCLE11_EVENT_TEST,'utf8'));
  const target=(f.rows||[]).find(r=>r.eventType==='event'||r.position==='event');
  assert.ok(target?.nativeText&&target?.scannedText,'event-three test must have both full strings');
  const opts={source:'whif-event-content',event:true,
   eventTitle:target.scannedText.split('\n')[0]};
  const compare=context.GalArchiveCore.compareNativeParagraphs(target.scannedText,target.nativeText,opts);
  assert.equal(compare.comparison.contentEqual,true,
   JSON.stringify(compare.comparison.firstDifference));
  assert.equal(compare.comparison.clockEqual,true);
  assert.equal(compare.comparison.remainingUnexplained.native,0);
  assert.equal(compare.comparison.remainingUnexplained.scanned,0);
 });
}


test('timed notification HUD restores native quotes on both sides, with exact text and clock',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const status='｜2026年8月23日｜\n｜🕒10:30｜\n｜📍測試區｜';
 const prefix='【終端】\n📢基地公告：測試。\n👥群組：無。\n💬私人訊息：甲\n早安。\n📨任務通知：完成。';
 const dom=prefix+'\n'+status+'\n你好。\n正文與「原有引用」。';
 const native=prefix.replace('甲\n早安。','甲 「早安。」')+'\n\n'+fence+'\n'+status+'\n'+fence+'\n\n{{測試模板}}\n\n「你好。」正文與「原有引用」。';
 const opts={source:'whif-message-content',statusText:status,codeBlocks:[status]};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.contentEqual,true);assert.equal(v.comparison.clockEqual,true);
 assert.equal(v.comparison.timedCompositeProjection.prefixQuotePairs,1);
 assert.equal(v.comparison.timedCompositeProjection.bodyQuotePairs,1);
 assert.match(v.text,/「早安。」/);assert.match(v.text,/「你好。」/);assert.match(v.text,/「原有引用」/);
 assert.equal(v.text.includes('{{測試模板}}'),false);
 for(const wrong of [native.replace('早安。','晚安。'),native.replace('10:30','10:31'),native.replace('測試區','另一區'),native.replace('「你好。」','「你好。'),native.replace('「原有引用」','原有引用'),native.replace('{{測試模板}}','{{user|role}}'),native.replace('{{測試模板}}','{{img:asset}}'),native.replace('{{測試模板}}','{{甲}}\n{{乙}}'),native.replace('{{測試模板}}\n\n','').replace('正文與','{{測試模板}}正文與')]){
  assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
 }
 assert.equal(core.compareNativeParagraphs(dom,native,{...opts,codeBlocks:[]}).text,null);
});
test('timed event title inline opening fence retains original literal fences and balanced quotes',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const status='｜2026年8月23日｜\n｜🕒13:35｜\n｜📍測試區｜';
 const title='《測試世界》: '+fence;
 const dom=title+'\n'+status+'\n'+fence+'\n警報。\n正文。\n「既有引用」';
 const native='{{Below context is an event which has just occurred. Synthetic test.}}\n'+title+'\n'+status+'\n'+fence+'\n\n{{測試模板}}\n\n「警報。」正文。「既有引用」';
 const opts={source:'whif-event-content',event:true,eventTitle:title};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.timedCompositeProjection.eventFencePreserved,true);
 assert.equal(v.comparison.timedCompositeProjection.omittedQuotePairs,1);
 assert.match(v.text,/「警報。」/);assert.match(v.text,/「既有引用」/);
 assert.equal(v.text.split(fence).length,3);
 assert.equal(v.text.includes('{{'),false);
 for(const wrong of [native.replace('警報。','警告。'),native.replace('13:35','13:36'),native.replace('測試區','其他區'),native.replace('「警報。」','警報。」'),native.replace('「既有引用」','既有引用'),native.replace('{{測試模板}}','{{user}}'),native.replace('{{測試模板}}','{{img:asset}}'),native.replace('{{測試模板}}','{{甲}}\n{{乙}}'),native.replace('Below context is an event which has just occurred.','Unknown wrapper'),native.replace('《測試世界》','《別的世界》'),native.replace('{{測試模板}}\n\n','').replace('正文。','{{測試模板}}正文。')]){
  assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
 }
});


test('long news and terminal prefixes retain the actual consecutive HUD clock',()=>{
 const hud='｜2026年8月25日｜\n｜🕒17:18｜晴朗｜\n｜📍測試｜';
 const news='【基甫納熱搜】\n'+Array.from({length:20},(_,i)=>'新聞 '+i).join('\n')+'\n***\n';
 const terminal='【終端】\n'+Array(20).fill('通知').join('\n')+'\n📨任務通知：無\n';
 const fence=String.fromCharCode(96).repeat(3);
 assert.equal(parseGameTime(news+hud).civil,'2026/08/25 17:18');
 assert.equal(parseGameTime(news+'{{測試模板}}\n\n'+fence+'\n'+hud+'\n'+fence).civil,'2026/08/25 17:18');
 assert.equal(parseGameTime(terminal+fence+'\n'+hud+'\n'+fence).civil,'2026/08/25 17:18');
 assert.equal(parseGameTime(news+'一般正文\n'+hud),null);
 assert.equal(parseGameTime('一般敘述\n'+Array(20).fill('文字').join('\n')+'\n'+hud),null);
});
test('strict prefixed HUD projections cover terminal, news, schedule and literal title',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const hud='｜2026年8月25日｜\n｜🕒17:18｜晴朗｜\n｜📍測試｜';
 const news='【基甫納熱搜】\n'+Array.from({length:20},(_,i)=>'新聞 '+i).join('\n')+'\n***';
 const terminal='【終端】\n📢基地公告：測試。\n📨任務通知：無';
 const schedule='【7F今日行程】\n隊員：測試。';
 const label='《系統測試》';
 const domBody='通報。\n正文「原有引用」。';
 const nativeBody='「通報。」正文「原有引用」。';
 const opts={source:'whif-message-content',statusText:hud,codeBlocks:[hud]};
 for(const [prefix,before,after,image] of [[terminal,true,false,false],[news,true,false,true],[schedule,false,true,false],[label,false,false,false],[label,false,true,false]]){
  const dom=prefix+'\n'+hud+'\n'+domBody;
  const native=prefix+'\n'+(before?'{{測試模板}}\n\n':'')+fence+'\n'+hud+'\n'+fence+'\n\n'+(after?'{{測試模板}}\n\n':'')+nativeBody+(image?'\n{{img:test}}':'');
  const v=core.compareNativeParagraphs(dom,native,opts);
  assert.equal(v.comparison.contentEqual,true);
  assert.equal(v.comparison.clockEqual,true);
  assert.match(v.text,/「通報。」/);
  assert.match(v.text,/「原有引用」/);
  for(const wrong of [native.replace('通報。','改動。'),native.replace('17:18','17:19'),native.replace('測試｜','其他｜'),native.replace('「通報。」','「通報。'),native.replace('「原有引用」','原有引用')]){
   assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
  }
  if(before||after){
   for(const wrong of [native.replace('{{測試模板}}','{{user|role}}'),native.replace('{{測試模板}}','{{img:asset}}'),native.replace('{{測試模板}}','{{甲}}\n{{乙}}')]){
    assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
   }
  }
  assert.equal(core.compareNativeParagraphs(dom,native,{...opts,codeBlocks:[]}).text,null);
 }
});
test('genuinely untimed terminal requires a unique matching native source and preserves null',()=>{
 const core=context.GalArchiveCore;
 const pre='【終端】\n📢基地公告：測試。\n📨任務通知：無';
 const dom=pre+'\n通報。\n正文。';
 const native=pre+'\n{{測試模板}}\n\n「通報。」正文。';
 const opts={source:'whif-message-content',verifiedUntimedNative:true};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.prefixedHudProjection.untimed,true);
 assert.equal(v.comparison.clockEqual,true);
 assert.equal(parseGameTime(v.text),null);
 const row={role:'ai',text:dom,formatSource:{nativeReply:{reason:'available',markerCount:1,messageId:'synthetic-untimed',scannedText:dom,text:native}}};
 const rows=[{role:'ai',text:'這是測試用輪迴開場。'},{role:'me',text:'測試玩家。'},row];
 const checked=validate(rows);
 assert.equal(checked.ok,true,JSON.stringify(checked.errors));
 assert.equal(checked.messages.at(-1).gameTime,null);
 assert.equal(checked.messages.at(-1).verifiedUntimedNative,true);
 assert.equal(validate([...rows,{role:'me',text:'另一則'},row]).ok,false);
 assert.equal(validate([rows[0],rows[1],{...row,formatSource:{nativeReply:{...row.formatSource.nativeReply,markerCount:2}}}]).ok,false);
 assert.equal(core.compareNativeParagraphs(dom,native,{source:'whif-message-content'}).text,null);
 for(const wrong of [native.replace('通報。','改動。'),native.replace('{{測試模板}}','{{user|role}}'),native.replace('「通報。」','「通報。'),native.replace('{{測試模板}}','{{甲}}\n{{乙}}')])assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
});
test('literal event title and closing fence can restore quotes without a second template',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const hud='｜2026年8月25日｜\n｜🕒17:18｜晴朗｜\n｜📍測試｜';
 const title='《測試世界》: '+fence;
 const header=title+'\n'+hud+'\n'+fence+'\n';
 const dom=header+'通報。\n正文。';
 const native='{{Below context is an event which has just occurred. Test.}}\n'+header+'\n「通報。」正文。';
 const opts={source:'whif-event-content',event:true,eventTitle:title};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.contentEqual,true);
 assert.equal(v.comparison.prefixedHudProjection.omittedQuotePairs,1);
 assert.equal(v.text.split(fence).length,3);
 assert.equal(core.compareNativeParagraphs(dom,native.replace('通報。','改動。'),opts).text,null);
 assert.equal(core.compareNativeParagraphs(dom,native.replace('Below context is an event which has just occurred.','Other wrapper'),opts).text,null);
});

test('bare HUD with hidden prefix or post-HUD template restores only balanced native quotes',()=>{
 const core=context.GalArchiveCore;
 const hud='｜2026年8月25日｜\n｜🕒17:18｜晴朗｜\n｜📍測試｜\n｜🍿暴走值：0｜';
 const dom=hud+'\n通報。\n原有「引用」。';
 const opts={source:'whif-message-content'};
 for(const native of [hud+'\n\n「通報。」原有「引用」。',
  '{{測試模板}}\n\n'+hud+'\n\n「通報。」原有「引用」。',
  hud+'\n\n{{測試模板}}\n\n「通報。」原有「引用」。\n{{img::test}}']){
  const v=core.compareNativeParagraphs(dom,native,opts);
  assert.equal(v.comparison.contentEqual,true);
  assert.equal(v.comparison.clockEqual,true);
  assert.equal(v.comparison.prefixedHudProjection.bareHud,true);
  assert.match(v.text,/「通報。」/);
  assert.match(v.text,/原有「引用」。/);
  for(const wrong of [native.replace('通報。','改動。'),native.replace('17:18','17:19'),
   native.replace('「通報。」','「通報。'),native.replace('「引用」','引用'),
   native.replace('測試｜','不同｜'),native+'\n無法核對的正文']){
   assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
  }
 }
 const a='{{甲}}\n\n'+hud+'\n\n{{乙}}\n\n「通報。」原有「引用」。';
 assert.equal(core.compareNativeParagraphs(dom,a,opts).text,null);
 const b='{{user|role}}\n\n'+hud+'\n\n「通報。」原有「引用」。';
 assert.equal(core.compareNativeParagraphs(dom,b,opts).text,null);
});
test('bare HUD quote wrapping is proven across lines without changing the clock or status',()=>{
 const core=context.GalArchiveCore;
 const hud='｜2026年8月25日｜\n｜🕒17:18｜晴朗｜\n｜📍測試｜\n｜🐆嚮導值：30｜💭：他說「好了」。｜\n｜🐿️暴走值：0｜';
 const native='{{測試模板}}\n\n'+hud+'\n\n「通報。」正文。';
 const dom=hud.replace('「好了」','\n好了\n')+'\n通報。\n正文。';
 const v=core.compareNativeParagraphs(dom,native,{source:'whif-message-content'});
 assert.equal(v.comparison.prefixedHudProjection.bareHud,true);
 assert.match(v.text,/他說「好了」/);
 assert.equal(parseGameTime(v.text).civil,'2026/08/25 17:18');
 assert.equal(core.compareNativeParagraphs(dom,native.replace('嚮導值：30','嚮導值：31'),{source:'whif-message-content'}).text,null);
});


test('V0.8.46 late structured news clock and player pairing, no separator needed',()=>{
 const core=context.GalArchiveCore;
 const hud='｜2026年8月27日（星期四）｜\n｜🕒06:22｜晴朗｜\n｜📍測試房間｜\n｜🍿暴走值：0｜';
 const prefix='【基甫納熱搜】\n'+Array.from({length:5},(_,i)=>
  '#'+(i+1)+' 測試新聞\n🔥熱度：100\n💬匿名留言：測試內容\n').join('\n')+'\n\n';
 const full=prefix+hud+'\n正文。',iso='2026-08-26T22:22:00.000Z',fence=String.fromCharCode(96).repeat(3);
 for(const t of [full,full.replace('晴朗','☀️晴朗'),'{{測試上下文}}\n'+full,
  prefix+'{{測試上下文}}\n'+fence+'\n'+hud+'\n'+fence+'\n正文。'])assert.equal(parseGameTime(t).iso,iso);
 const checked=validate([{role:'ai',text:'輪迴測試開場正文。'},{role:'me',text:'測試玩家。'},{role:'ai',text:full}]);
 assert.equal(checked.ok,true);assert.equal(checked.messages[0].gameTime,iso);assert.equal(checked.messages[1].gameTime,iso);
 assert.equal(checked.verifiedUntimedCount,0);
 for(const t of [prefix+'一般正文\n'+hud,prefix.replace('#3 測試新聞','#8 測試新聞')+hud,prefix.replace('🔥熱度：100','不明欄位')+hud])assert.equal(parseGameTime(t),null);
 assert.equal(parseGameTime(prefix+'***\n'+hud.replace('06:22','17:18')).civil,'2026/08/27 17:18');
 assert.equal(core.compareNativeParagraphs(full,full,{source:'whif-message-content'}).comparison.clockEqual,true);
});
test('V0.8.46 independent HUD evidence rejects falsely untimed source, but preserves genuinely absent clock',()=>{
 const core=context.GalArchiveCore;
 const hud='｜2026年8月27日｜\n｜🕒06:22｜晴朗｜\n｜📍測試房間｜';
 const late=Array(25).fill('一般敘述。').join('\n')+'\n'+hud,ordinary='真正無時間的普通測試正文。';
 const row=text=>({role:'ai',text,formatSource:{nativeReply:{reason:'available',markerCount:1,messageId:'test-id',scannedText:text,text}}});
 const prefix=[{role:'ai',text:'輪迴測試開場正文。'},{role:'me',text:'測試玩家。'}];
 assert.equal(parseGameTime(late),null);assert.equal(validate([...prefix,row(late)]).ok,false);
 assert.equal(core.compareNativeParagraphs(late,late,{source:'whif-message-content',verifiedUntimedNative:true}).text,null);
 assert.equal(core.isAllowedOpeningRow(row(late)),false);
 assert.equal(validate([...prefix,row(ordinary),{role:'ai',eventType:'event',text:late}]).ok,false);
 const genuine=validate([...prefix,row(ordinary)]);
 assert.equal(genuine.ok,true);assert.equal(genuine.messages[0].gameTime,null);assert.equal(genuine.messages[1].gameTime,null);assert.equal(genuine.verifiedUntimedCount,1);
});
test('V0.8.46 multiline HUD requires complete status and code evidence, keeps literal title and HUD quotes',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const label='《測試-世界》:',hud='｜2026年8月23日｜\n｜🕒08:27｜晴朗｜\n｜📍測試地點｜\n｜🐆嚮導值：95｜「收到。」｜\n｜🐿️暴走值：0｜';
 const visibleHud=hud.replace('「收到。」','\n「收到。」\n'),dom=label+'\n'+visibleHud+'\n通報。\n正文。';
 const native=label+' {{測試上下文}}\n'+fence+'\n'+hud+'\n'+fence+'\n\n「通報。」正文。';
 const options={source:'whif-message-content',statusText:visibleHud,codeBlocks:[visibleHud]},v=core.compareNativeParagraphs(dom,native,options);
 assert.equal(v.comparison.prefixedHudProjection.legacyBoundary,'multiline-hud');assert.equal(v.comparison.clockEqual,true);
 assert.ok(v.text.startsWith(label));assert.ok(v.text.includes('｜🐆嚮導值：95｜「收到。」｜'));assert.ok(v.text.includes('「通報。」'));assert.equal(v.text.includes(fence),false);
 for(const wrong of [native.replace('通報。','改動。'),native.replace('08:27','08:28'),native.replace('95','96'),native.replace('「收到。」','收到。'),native.replace('「通報。」','「通報。'),native.replace('測試-世界','測試世界'),native.replace('{{測試上下文}}','{{user|role}}'),native.replace('{{測試上下文}}','{{甲}}{{乙}}')])assert.equal(core.compareNativeParagraphs(dom,wrong,options).text,null);
 for(const wrong of [{...options,codeBlocks:[]},{...options,statusText:visibleHud.replace('95','96')},{...options,codeBlocks:[visibleHud,'other']}])assert.equal(core.compareNativeParagraphs(dom,native,wrong).text,null);
 assert.equal(core.compareNativeParagraphs(dom.replace(':','：'),native.replace(':','：'),options).comparison.clockEqual,true);
});
test('V0.8.46 unmatched literal fence is preserved exactly',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const hud='｜2026年8月22日｜\n｜🕒19:10｜晴朗｜\n｜📍測試地點｜\n｜🍿暴走值：8%｜';
 const dom=fence+'\n'+hud+'\n【測試公告】\n正文。\n通報。',native='{{測試上下文}}\n'+fence+'\n'+hud+'\n\n【測試公告】\n正文。\n\n「通報。」',opts={source:'whif-message-content'};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.prefixedHudProjection.legacyBoundary,'unclosed-fence');assert.equal(v.text.split(fence).length,2);assert.ok(v.text.startsWith(fence+'\n'));assert.ok(v.text.includes('「通報。」'));
 for(const wrong of [native+'\n'+fence,native.replace('19:10','19:11'),native.replace('8%','9%'),native.replace('正文。','不符。'),native.replace('「通報。」','「通報。'),native.replace('{{測試上下文}}','{{user}}')])assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
 assert.equal(core.compareNativeParagraphs(dom.slice(fence.length+1),native,opts).text,null);
});


test('clockless trending header proves one hidden context and one bare leading fence pair only',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const header='｜測試基地・內部網路｜\n｜🔥熱搜榜・即時更新｜';
 const body=['','`系統提示`','','---','','**1. 測試標題**','','> 引用內容','',fence,'測試程式碼',fence,'','{{visible-template}}'].join('\n');
 const dom=header+body;
 const native='{{系統顯示熱搜介面｜測試上下文}}\n'+fence+'\n'+header+'\n'+fence+body;
 const opts={source:'whif-message-content',verifiedUntimedNative:true};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.prefixedHudProjection.legacyBoundary,'untimed-trending-header');
 assert.equal(v.comparison.clockEqual,true);
 assert.equal(v.text,dom);
 assert.equal(parseGameTime(v.text),null);
 const row={role:'ai',text:dom,formatSource:{nativeReply:{reason:'available',markerCount:1,messageId:'synthetic-trending',scannedText:dom,text:native}}};
 const prefix=[{role:'ai',text:'輪迴開場測試正文。'},{role:'me',text:'玩家測試'}];
 const suffix=[{role:'me',text:'下一回合'},{role:'ai',text:'｜2026年8月22日｜\n｜🕒18:45｜\n正常回覆。'}];
 const checked=validate([...prefix,row,...suffix]);
 assert.equal(checked.ok,true,JSON.stringify(checked.errors));
 assert.equal(checked.messages[0].gameTime,null);
 assert.equal(checked.messages[1].gameTime,null);
 assert.equal(checked.messages[2].gameTime,'2026-08-22T10:45:00.000Z');
 for(const wrong of [native+'額外文字',native.replace('熱搜榜・即時更新','熱搜榜・其他更新'),native.replace('系統顯示熱搜介面','其他模板'),native.replace(fence,fence+'js'),native.replace(fence,''),native.replace('**1.','1.'),native.replace('> 引用','引用'),native.replace('{{visible-template}}',''),native.replace('測試程式碼','其他程式碼'),native.replace('{{系統顯示熱搜介面｜測試上下文}}','{{user|role}}')]){
  assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
 }
 assert.equal(core.compareNativeParagraphs(dom,native,{source:'whif-message-content'}).text,null);
 assert.equal(validate([...prefix,{...row,formatSource:{nativeReply:{...row.formatSource.nativeReply,markerCount:2}}},...suffix]).ok,false);
});


test('V0.8.47 quote-wrapped trending and two separate fenced blocks require complete matching evidence',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const news='【基甫納熱搜】\n'+Array.from({length:5},(_,i)=>
  '#'+(i+1)+' 測試「標題」內容\n🔥熱度：1,000\n💬匿名留言：測試「留言」內容').join('\n\n');
 const visible=news.replaceAll('「標題」','\n「標題」\n').replaceAll('「留言」','\n「留言」\n');
 const hud='｜2026年8月27日（星期四）｜\n｜🕒06:22｜晴朗｜\n｜📍測試地點｜\n｜🍿暴走值：0｜';
 const body='\n\n普通正文。\n\n> 保留引用\n\n**粗體**';
 const dom=visible+'\n'+hud+body;
 const native=fence+'\n'+news+'\n'+fence+'\n\n{{測試上下文}}\n\n'+fence+'\n'+hud+'\n'+fence+body;
 const iso='2026-08-26T22:22:00.000Z';
 const options={source:'whif-message-content',statusText:hud,codeBlocks:[visible,hud]};
 assert.equal(parseGameTime(dom).iso,iso);
 assert.equal(parseGameTime(native).iso,iso);
 const result=core.compareNativeParagraphs(dom,native,options);
 assert.equal(result.comparison.prefixedHudProjection.legacyBoundary,'dual-fenced-news-hud');
 assert.equal(result.text,news+'\n\n'+hud+body);
 assert.equal(result.comparison.clockEqual,true);
 for(const wrong of [native+'新增正文',native.replace('06:22','06:23'),native.replace('1,000','1,001'),
  native.replace(fence,fence+'js'),native.replace('{{測試上下文}}','{{user|role}}'),
  native.replace('> 保留引用','保留引用'),native.replace('**粗體**','粗體')]){
  assert.equal(core.compareNativeParagraphs(dom,wrong,options).text,null);
 }
 for(const wrong of [{...options,codeBlocks:[hud]},{...options,codeBlocks:[hud,visible]},
  {...options,statusText:hud.replace('0｜','1｜')}]){
  assert.equal(core.compareNativeParagraphs(dom,native,wrong).text,null);
 }
 const validated=validate([{role:'ai',text:'輪迴開場測試正文。'},{role:'me',text:'玩家測試'},{role:'ai',text:dom}]);
 assert.equal(validated.ok,true);assert.equal(validated.messages[0].gameTime,iso);assert.equal(validated.messages[1].gameTime,iso);
 assert.equal(parseGameTime(visible+'\n\n任意額外敘述\n'+hud),null);
 assert.equal(parseGameTime(visible.replace('#3 ','#8 ')+'\n'+hud),null);
});


test('V0.8.48 combined clock/location line proves multiline HUD including literal location quotes',()=>{
 const core=context.GalArchiveCore,fence=String.fromCharCode(96).repeat(3);
 const title='《測試-世界》:',hud='｜2026年8月24日｜\n｜🕒20:17｜測試「房間」與走廊｜\n｜🍿暴走值：37%｜\n｜🐆嚮導值：100%｜';
 const visibleHud=hud.replace('「房間」','\n「房間」\n');
 const dom=title+'\n'+visibleHud+'\n第一句。\n第二句。',native=title+' {{測試上下文}}\n'+fence+'\n'+hud+'\n'+fence+'\n\n「第一句。」\n\n「第二句。」';
 const opts={source:'whif-message-content',statusText:visibleHud,codeBlocks:[visibleHud]};
 const v=core.compareNativeParagraphs(dom,native,opts);
 assert.equal(v.comparison.prefixedHudProjection.legacyBoundary,'multiline-hud');
 assert.equal(v.comparison.clockEqual,true);
 assert.equal(v.comparison.prefixedHudProjection.omittedQuotePairs,2);
 assert.ok(v.text.includes('測試「房間」與走廊'));
 assert.ok(v.text.includes('「第一句。」\n\n「第二句。」'));
 assert.equal(parseGameTime(v.text).iso,'2026-08-24T12:17:00.000Z');
 for(const wrong of [native+'新增',native.replace('37%','38%'),native.replace('20:17','20:18'),
 native.replace('「房間」','房間'),native.replace('「第一句。」','「第一句。'),
 native.replace('{{測試上下文}}','{{甲}}{{乙}}')])assert.equal(core.compareNativeParagraphs(dom,wrong,opts).text,null);
 for(const wrong of [{...opts,codeBlocks:[]},{...opts,statusText:''},{...opts,codeBlocks:[visibleHud.replace('37%','38%')]}])
 assert.equal(core.compareNativeParagraphs(dom,native,wrong).text,null);
});
