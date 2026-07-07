'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('gain map probe accepts libavif fraction variants', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapprobe.cc'), 'utf8');

  assert.match(source, /template\s*<\s*typename\s+Fraction\s*>/);
  assert.doesNotMatch(source, /fractionToDouble\s*\(\s*const\s+avifFraction\s*&/);
  assert.match(source, /fractionToDouble\(gainMap->baseHdrHeadroom\)/);
  assert.match(source, /fractionToDouble\(gainMap->alternateHdrHeadroom\)/);
});
