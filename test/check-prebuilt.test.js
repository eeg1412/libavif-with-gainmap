'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseMachO } = require('../scripts/check-prebuilt');

const MACHO_MAGIC_64_LE = 0xfeedfacf;
const MACHO_CPU_ARM64 = 0x0100000c;
const MACHO_LC_LOAD_DYLIB = 0x0c;
const MACHO_LC_BUILD_VERSION = 0x32;
const MACHO_PLATFORM_MACOS = 1;

function encodeMachOVersion(major, minor, patch = 0) {
  return (major << 16) | (minor << 8) | patch;
}

function align8(value) {
  return (value + 7) & ~7;
}

function makeDylibCommand(name) {
  const nameBuffer = Buffer.from(`${name}\0`, 'utf8');
  const commandSize = align8(24 + nameBuffer.length);
  const buffer = Buffer.alloc(commandSize);
  buffer.writeUInt32LE(MACHO_LC_LOAD_DYLIB, 0);
  buffer.writeUInt32LE(commandSize, 4);
  buffer.writeUInt32LE(24, 8);
  nameBuffer.copy(buffer, 24);
  return buffer;
}

function makeBuildVersionCommand(major, minor) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32LE(MACHO_LC_BUILD_VERSION, 0);
  buffer.writeUInt32LE(buffer.length, 4);
  buffer.writeUInt32LE(MACHO_PLATFORM_MACOS, 8);
  buffer.writeUInt32LE(encodeMachOVersion(major, minor), 12);
  buffer.writeUInt32LE(encodeMachOVersion(15, 0), 16);
  buffer.writeUInt32LE(0, 20);
  return buffer;
}

function writeFixture(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libavif-gainmap-test-'));
  const file = path.join(dir, 'fixture');
  fs.writeFileSync(file, buffer);
  return file;
}

test('parses macOS Mach-O build version and dylib load commands', () => {
  const commands = [makeBuildVersionCommand(12, 0), makeDylibCommand('/usr/lib/libSystem.B.dylib')];
  const commandBytes = Buffer.concat(commands);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(MACHO_MAGIC_64_LE, 0);
  header.writeUInt32LE(MACHO_CPU_ARM64, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(commandBytes.length, 20);

  const parsed = parseMachO(writeFixture(Buffer.concat([header, commandBytes])));

  assert.equal(parsed.cpuType, MACHO_CPU_ARM64);
  assert.deepEqual(parsed.minVersions, [[12, 0, 0]]);
  assert.deepEqual(parsed.dylibs, ['/usr/lib/libSystem.B.dylib']);
});
