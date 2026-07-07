'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeConvertOptions } = require('../src/options');

test('normalizes default conversion options', () => {
  const options = normalizeConvertOptions();
  assert.equal(options.quality, 80);
  assert.equal(options.gainMapQuality, 60);
  assert.equal(options.speed, 6);
  assert.equal(options.size, null);
});

test('normalizes resize dimensions', () => {
  const options = normalizeConvertOptions({ maxHeight: '720', maxWidth: 1280 });
  assert.deepEqual(options.size, {
    height: undefined,
    maxHeight: 720,
    maxWidth: 1280,
    width: undefined
  });
});

test('rejects invalid quality', () => {
  assert.throws(() => normalizeConvertOptions({ quality: 101 }), /quality must be between/);
});

test('rejects mixed exact and max sizing', () => {
  assert.throws(
    () => normalizeConvertOptions({ maxWidth: 1024, width: 800 }),
    /Use width\/height or maxWidth\/maxHeight/
  );
});

test('rejects unsupported libavif choices', () => {
  assert.throws(() => normalizeConvertOptions({ depth: 9 }), /depth must be one of/);
  assert.throws(() => normalizeConvertOptions({ yuv: '411' }), /yuv must be one of/);
});
