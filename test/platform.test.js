'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { TOOL_GAINMAP_PROBE, TOOL_NAMES, executableName, getPlatformKey } = require('../src/platform');

test('builds platform keys for supported targets', () => {
  assert.equal(getPlatformKey({ arch: 'x64', platform: 'linux' }), 'linux-x64');
  assert.equal(getPlatformKey({ arch: 'arm64', platform: 'darwin' }), 'darwin-arm64');
});

test('adds exe extension on Windows only', () => {
  assert.equal(executableName('avifgainmaputil', 'win32-x64'), 'avifgainmaputil.exe');
  assert.equal(executableName('avifgainmaputil', 'linux-x64'), 'avifgainmaputil');
});

test('includes the gain map probe native tool', () => {
  assert.equal(TOOL_GAINMAP_PROBE, 'avifgainmapprobe');
  assert.ok(TOOL_NAMES.includes(TOOL_GAINMAP_PROBE));
  assert.equal(executableName(TOOL_GAINMAP_PROBE, 'win32-x64'), 'avifgainmapprobe.exe');
});

test('rejects unsupported targets', () => {
  assert.throws(() => getPlatformKey({ arch: 'ia32', platform: 'linux' }), /Unsupported platform/);
});
