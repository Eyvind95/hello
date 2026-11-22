'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('./gal-core.js');

const [baselinePath, candidatePath, copiedTextPath] = process.argv.slice(2);
if (!baselinePath || Boolean(candidatePath) !== Boolean(copiedTextPath)) {
  throw new Error('Usage: node verify-cycle17.js <baseline.json> [<new-scan.json> <native-copy.txt>]');
}
const read = path => fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
const baseline = JSON.parse(read(baselinePath));

function verifyScan(scan) {
  assert.equal(scan.target.worldName, '《全員精神穩定，感情除外》');
  assert.equal(scan.rawRows, 73);
  assert.equal(scan.opening.length, 357);
  assert.equal(scan.messages.length, 70);
  assert.equal(scan.events.length, 2);
  assert.deepEqual(scan.events.map(event => event.scanIndex), [11, 46]);
  for (const [index, message] of scan.messages.entries()) {
    assert.equal(message.role, index % 2 === 0 ? 'me' : 'ai');
    assert.ok(message.gameTime);
  }
  const ordered = [...scan.messages, ...scan.events].sort((a, b) => a.scanIndex - b.scanIndex);
  for (const [index, row] of ordered.entries()) {
    assert.equal(row.scanIndex, index + 1);
    assert.equal(row.messageOrder, row.scanIndex);
    assert.ok(row.sourceEventId);
  }
  for (const event of scan.events) {
    assert.equal(event.role, 'ai');
    assert.equal(event.status, 'accepted');
  }
  const replay = GalArchiveCore.validate([
    { role: 'ai', text: scan.opening },
    ...ordered.map(row => ({
      role: row.role, text: row.text, worldName: row.worldName,
      eventType: row.status === 'accepted' ? 'event' : undefined
    }))
  ], scan.target.worldName);
  for (const validation of [scan.validation, replay]) {
    assert.equal(validation.ok, true);
    assert.equal(validation.pairs, 35);
    assert.deepEqual(validation.warnings, []);
    assert.deepEqual(validation.errors, []);
  }
  assert.deepEqual(replay.messages.map(row => row.gameTime), scan.messages.map(row => row.gameTime));
  assert.deepEqual(replay.events.map(row => row.scanIndex), [11, 46]);
  assert.deepEqual(replay.events.map(row => row.gameTime), scan.events.map(row => row.gameTime));
  return ordered;
}

const originalRows = verifyScan(baseline);
console.log('PASS cycle 17 baseline and validator replay');
if (candidatePath) {
  const candidate = JSON.parse(read(candidatePath));
  const candidateRows = verifyScan(candidate);
  const metadata = row => [
    row.role, row.scanIndex, row.messageOrder, row.gameTime, row.sourceEventId,
    row.sourcePartIndex, row.chatKey, row.status
  ];
  assert.deepEqual(candidateRows.map(metadata), originalRows.map(metadata));
  const normalized = text => text.replace(/\r\n?/g, '\n').trim();
  function withoutPresentation(text) {
    const fence = /^\x60{3}\n([\s\S]+?)\n\x60{3}\n/.exec(text);
    const image = /\n(\{\{img::[^}\n]+\}\})$/.exec(text);
    let content = image ? text.slice(0, image.index) : text;
    if (fence) content = fence[1] + '\n' + content.slice(fence[0].length);
    return { content, fencedStatus: Boolean(fence), imageMarker: image?.[1] ?? null };
  }
  const nativeCopy = withoutPresentation(normalized(read(copiedTextPath)));
  const firstReply = withoutPresentation(normalized(candidate.messages.find(row => row.role === 'ai').text));
  console.log('Status fence matches native copy:', firstReply.fencedStatus === nativeCopy.fencedStatus);
  console.log('Image marker matches native copy:', firstReply.imageMarker === nativeCopy.imageMarker);
  assert.ok(firstReply.content === nativeCopy.content, 'First AI reply status or prose differs from the native copy');
  console.log('PASS cycle 17 new scan metadata and exact status/prose comparison');
}
