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

test('serializes CSS font-weight as markdown bold without requiring a strong tag', () => {
  const bold = element('span', 'inline', text('粗體。'));
  bold.style.fontWeight = '700';
  const normal = element('span', 'inline', text('普通。'));
  const root = element('div', 'block', bold, normal);
  assert.equal(markdownFromDom(root, { role: 'ai' }), '**粗體。**普通。');
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
