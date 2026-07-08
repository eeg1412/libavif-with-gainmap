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

test('single-pass gain map convert reads JPEG gain maps directly', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');

  assert.match(source, /avif::ReadImage\(/);
  assert.match(source, /ignore_gain_map.*false/);
  assert.match(source, /avifEncoderWrite\(/);
  assert.doesNotMatch(source, /avifDecoderReadFile\(/);
});

test('single-pass gain map convert declares result before cleanup gotos', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');
  const resultDeclaration = source.indexOf('avifResult result = AVIF_RESULT_OK;');
  const firstCleanupGoto = source.indexOf('goto cleanup;');

  assert.ok(resultDeclaration !== -1);
  assert.ok(firstCleanupGoto !== -1);
  assert.ok(resultDeclaration < firstCleanupGoto);
  assert.doesNotMatch(source, /avifResult\s+result\s*=\s*avif::ReadImage/);
});

test('single-pass gain map convert can strip Exif and XMP metadata', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');

  assert.match(source, /--strip-metadata/);
  assert.match(source, /avifRWDataFree\(&image->exif\)/);
  assert.match(source, /avifRWDataFree\(&image->xmp\)/);
  assert.match(source, /avifRWDataFree\(&image->gainMap->image->exif\)/);
  assert.match(source, /avifRWDataFree\(&image->gainMap->image->xmp\)/);
});

test('JS conversion path does not use two-stage AVIF resize fallback', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');

  assert.match(source, /TOOL_GAINMAP_CONVERT/);
  assert.doesNotMatch(source, /TOOL_GAINMAP_RESIZE/);
  assert.doesNotMatch(source, /converted\.avif/);
  assert.doesNotMatch(source, /mkdtemp/);
});

test('CLI exposes metadata stripping option', () => {
  const source = fs.readFileSync(path.join(root, 'bin', 'avif-gainmap.js'), 'utf8');

  assert.match(source, /--strip-metadata/);
  assert.match(source, /--strip-privacy/);
  assert.match(source, /options\.stripMetadata = true/);
});
