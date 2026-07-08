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

test('gain map probe checks freopen return value', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapprobe.cc'), 'utf8');

  assert.match(source, /FILE\s*\*\s*ignored\s*=\s*freopen\("\/dev\/null",\s*"w",\s*stdout\)/);
  assert.match(source, /if\s*\(\s*ignored\s*==\s*nullptr\s*\)/);
  assert.doesNotMatch(source, /^\s*freopen\("\/dev\/null",\s*"w",\s*stdout\);/m);
});

test('single-pass gain map convert reads JPEG gain maps directly', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');

  assert.match(source, /avif::ReadImage\(/);
  assert.match(source, /ignore_gain_map.*false/);
  assert.match(source, /avifEncoderWrite\(/);
  assert.doesNotMatch(source, /avifDecoderReadFile\(/);
});

test('single-pass gain map convert does not link libavif CLI swapbase command', () => {
  const nativeSource = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');
  const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-libavif.js'), 'utf8');

  assert.doesNotMatch(nativeSource, /swapbase_command\.h/);
  assert.doesNotMatch(buildScript, /apps\/avifgainmaputil\/swapbase_command\.cc/);
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

test('single-pass gain map convert has no function-scope initialized declarations after cleanup gotos', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');
  const mainStart = source.indexOf('int main(');
  const bodyStart = source.indexOf('{', mainStart);
  const firstCleanupGoto = source.indexOf('goto cleanup;', bodyStart);
  const cleanupLabel = source.indexOf('cleanup:', bodyStart);

  assert.ok(mainStart !== -1);
  assert.ok(bodyStart !== -1);
  assert.ok(firstCleanupGoto !== -1);
  assert.ok(cleanupLabel !== -1);

  let depth = 1;
  let line = 1 + source.slice(0, bodyStart).split(/\r?\n/).length;
  let afterFirstCleanupGoto = false;
  const lines = source.slice(bodyStart + 1, cleanupLabel).split(/\r?\n/);
  const mainScopeInitializers = [];
  const declarationWithInitializer =
    /^\s*(?:const\s+)?(?:avif[A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_:<>]*)\s*(?:[*&]\s*)+[A-Za-z_][A-Za-z0-9_]*\s*=|^\s*(?:const\s+)?(?:avif[A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_:<>]*)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/;

  for (const text of lines) {
    if (afterFirstCleanupGoto && depth === 1 && declarationWithInitializer.test(text)) {
      mainScopeInitializers.push(`${line}: ${text.trim()}`);
    }
    if (text.includes('goto cleanup;')) {
      afterFirstCleanupGoto = true;
    }
    for (const char of text) {
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    line += 1;
  }

  assert.deepEqual(mainScopeInitializers, []);
});

test('single-pass gain map convert can strip Exif and XMP metadata', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');

  assert.match(source, /--strip-metadata/);
  assert.match(source, /avifRWDataFree\(&image->exif\)/);
  assert.match(source, /avifRWDataFree\(&image->xmp\)/);
  assert.match(source, /avifRWDataFree\(&image->gainMap->image->exif\)/);
  assert.match(source, /avifRWDataFree\(&image->gainMap->image->xmp\)/);
});

test('single-pass gain map convert bakes orientation before resize', () => {
  const source = fs.readFileSync(path.join(root, 'native', 'avifgainmapconvert.cc'), 'utf8');

  assert.match(source, /bakeImageOrientation\(image\)/);
  assert.match(source, /bakeOrientationIntoPixels\(image->gainMap->image,\s*transformFlags,\s*irot,\s*imir\)/);
  assert.match(source, /AVIF_TRANSFORM_IROT \| AVIF_TRANSFORM_IMIR/);
  assert.match(source, /avifGetExifOrientationOffset/);
  assert.match(source, /image->exif\.data\[orientationOffset\] = 1/);
  assert.ok(source.indexOf('bakeImageOrientation(image)') < source.indexOf('resizeGainMapImage(image, options)'));
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
