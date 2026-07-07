'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  TOOL_GAINMAP_PROBE,
  TOOL_NAMES,
  assertToolAvailable,
  ensureExecutable,
  executableName,
  getPlatformKey
} = require('../src/platform')

test('builds platform keys for supported targets', () => {
  assert.equal(getPlatformKey({ arch: 'x64', platform: 'linux' }), 'linux-x64')
  assert.equal(
    getPlatformKey({ arch: 'arm64', platform: 'darwin' }),
    'darwin-arm64'
  )
})

test('adds exe extension on Windows only', () => {
  assert.equal(
    executableName('avifgainmaputil', 'win32-x64'),
    'avifgainmaputil.exe'
  )
  assert.equal(
    executableName('avifgainmaputil', 'linux-x64'),
    'avifgainmaputil'
  )
})

test('includes the gain map probe native tool', () => {
  assert.equal(TOOL_GAINMAP_PROBE, 'avifgainmapprobe')
  assert.ok(TOOL_NAMES.includes(TOOL_GAINMAP_PROBE))
  assert.equal(
    executableName(TOOL_GAINMAP_PROBE, 'win32-x64'),
    'avifgainmapprobe.exe'
  )
})

test('rejects unsupported targets', () => {
  assert.throws(
    () => getPlatformKey({ arch: 'ia32', platform: 'linux' }),
    /Unsupported platform/
  )
})

test(
  'restores the execute bit on non-Windows binaries',
  { skip: process.platform === 'win32' },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avif-perm-'))
    const toolPath = path.join(dir, 'avifgainmapprobe')
    try {
      fs.writeFileSync(toolPath, '#!/bin/sh\nexit 0\n')
      fs.chmodSync(toolPath, 0o644) // strip the execute bit, mimicking npm packaging.

      assertToolAvailable(toolPath, TOOL_GAINMAP_PROBE)

      // Owner execute bit must be present after the availability check.
      assert.ok(fs.statSync(toolPath).mode & 0o100)
      assert.doesNotThrow(() => fs.accessSync(toolPath, fs.constants.X_OK))
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  }
)

test(
  'ensureExecutable is a no-op on Windows',
  { skip: process.platform !== 'win32' },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avif-perm-'))
    const toolPath = path.join(dir, 'avifgainmapprobe.exe')
    try {
      fs.writeFileSync(toolPath, 'binary')
      assert.doesNotThrow(() => ensureExecutable(toolPath))
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  }
)
