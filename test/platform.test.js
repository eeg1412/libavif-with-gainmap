'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { executableName, getPlatformKey } = require('../src/platform');

test('builds platform keys for supported targets', () => {
  assert.equal(getPlatformKey({ arch: 'x64', platform: 'linux' }), 'linux-x64');
  assert.equal(getPlatformKey({ arch: 'arm64', platform: 'darwin' }), 'darwin-arm64');
});

test('adds exe extension on Windows only', () => {
  assert.equal(executableName('avifgainmaputil', 'win32-x64'), 'avifgainmaputil.exe');
  assert.equal(executableName('avifgainmaputil', 'linux-x64'), 'avifgainmaputil');
});

test('rejects unsupported targets', () => {
  assert.throws(() => getPlatformKey({ arch: 'ia32', platform: 'linux' }), /Unsupported platform/);
});
