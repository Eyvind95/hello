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
  assert.match(checked.errors.join(' '),/缺少可辨識的劇情日期和時間/);
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
