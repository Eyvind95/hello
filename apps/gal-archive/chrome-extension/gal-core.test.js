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
