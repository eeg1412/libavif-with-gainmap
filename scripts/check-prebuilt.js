'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SUPPORTED_PLATFORM_KEYS,
  TOOL_NAMES,
  executableName,
  getPlatformKey,
  packageRoot
} = require('../src/platform');

const mode = process.argv.includes('--all') ? 'all' : 'current';
const keys = mode === 'all' ? SUPPORTED_PLATFORM_KEYS : [process.env.TARGET_PLATFORM_KEY || getPlatformKey()];
const missing = [];
const invalid = [];
const skipped = [];

const MAX_LINUX_GLIBC = [2, 35]; // Ubuntu 22.04 baseline.
const MAX_MACOS_MIN_VERSION = [12, 0];

const FORBIDDEN_WINDOWS_RUNTIME_DLLS = new Set([
  'libgcc_s_seh-1.dll',
  'libgcc_s_dw2-1.dll',
  'libgcc_s_sjlj-1.dll',
  'libstdc++-6.dll',
  'libwinpthread-1.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll'
]);

const ALLOWED_WINDOWS_DLLS = new Set([
  'advapi32.dll',
  'bcrypt.dll',
  'combase.dll',
  'crypt32.dll',
  'gdi32.dll',
  'imm32.dll',
  'kernel32.dll',
  'msvcrt.dll',
  'ntdll.dll',
  'ole32.dll',
  'oleaut32.dll',
  'rpcrt4.dll',
  'sechost.dll',
  'shell32.dll',
  'shlwapi.dll',
  'user32.dll',
  'version.dll',
  'winmm.dll',
  'ws2_32.dll'
]);

const ALLOWED_LINUX_NEEDED = new Set([
  'libc.so.6',
  'libdl.so.2',
  'ld-linux-aarch64.so.1',
  'ld-linux-x86-64.so.2',
  'libm.so.6',
  'libpthread.so.0',
  'libresolv.so.2',
  'librt.so.1'
]);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function versionParts(value) {
  return value.split('.').map((part) => Number(part));
}

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i] || 0;
    const b = right[i] || 0;
    if (a !== b) {
      return a - b;
    }
  }
  return 0;
}

function parsePe(file) {
  const buffer = fs.readFileSync(file);
  const u16 = (offset) => buffer.readUInt16LE(offset);
  const u32 = (offset) => buffer.readUInt32LE(offset);
  const peOffset = u32(0x3c);
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${file} is not a PE executable.`);
  }

  const coffOffset = peOffset + 4;
  const machine = u16(coffOffset);
  const sectionCount = u16(coffOffset + 2);
  const optionalHeaderSize = u16(coffOffset + 16);
  const optionalHeaderOffset = coffOffset + 20;
  const optionalMagic = u16(optionalHeaderOffset);
  const dataDirectoryOffset = optionalHeaderOffset + (optionalMagic === 0x20b ? 112 : 96);
  const importTableRva = u32(dataDirectoryOffset + 8);
  if (importTableRva === 0) {
    return { imports: [], machine };
  }

  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const offset = sectionTableOffset + i * 40;
    sections.push({
      rawOffset: u32(offset + 20),
      rawSize: u32(offset + 16),
      rva: u32(offset + 12),
      virtualSize: u32(offset + 8)
    });
  }

  function rvaToOffset(rva) {
    for (const section of sections) {
      const size = Math.max(section.rawSize, section.virtualSize);
      if (rva >= section.rva && rva < section.rva + size) {
        return section.rawOffset + (rva - section.rva);
      }
    }
    throw new Error(`RVA not mapped in ${file}: 0x${rva.toString(16)}`);
  }

  function readCString(offset) {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
      end += 1;
    }
    return buffer.toString('ascii', offset, end);
  }

  const imports = [];
  let descriptorOffset = rvaToOffset(importTableRva);
  while (true) {
    const originalFirstThunk = u32(descriptorOffset);
    const nameRva = u32(descriptorOffset + 12);
    const firstThunk = u32(descriptorOffset + 16);
    if (!originalFirstThunk && !nameRva && !firstThunk) {
      break;
    }
    imports.push(readCString(rvaToOffset(nameRva)).toLowerCase());
    descriptorOffset += 20;
  }
  return { imports, machine };
}

function isAllowedWindowsImport(name) {
  return (
    ALLOWED_WINDOWS_DLLS.has(name) ||
    name.startsWith('api-ms-win-') ||
    name.startsWith('ext-ms-win-')
  );
}

function checkWindows(file, key) {
  const pe = parsePe(file);
  if (key === 'win32-x64' && pe.machine !== 0x8664) {
    invalid.push(`${file}: expected PE x64 machine 0x8664, got 0x${pe.machine.toString(16)}`);
  }

  const forbidden = pe.imports.filter((name) => FORBIDDEN_WINDOWS_RUNTIME_DLLS.has(name));
  if (forbidden.length > 0) {
    invalid.push(`${file}: imports forbidden runtime DLLs ${forbidden.join(', ')}`);
  }

  const unexpected = pe.imports.filter((name) => !isAllowedWindowsImport(name));
  if (unexpected.length > 0) {
    invalid.push(`${file}: imports unexpected DLLs ${unexpected.join(', ')}`);
  }
}

function parseElfHeader(file) {
  const buffer = fs.readFileSync(file);
  if (buffer[0] !== 0x7f || buffer.toString('ascii', 1, 4) !== 'ELF') {
    throw new Error(`${file} is not an ELF executable.`);
  }
  const elfClass = buffer[4];
  const endian = buffer[5];
  if (elfClass !== 2 || endian !== 1) {
    throw new Error(`${file} must be 64-bit little-endian ELF.`);
  }
  return { machine: buffer.readUInt16LE(18) };
}

function checkLinux(file, key) {
  const elf = parseElfHeader(file);
  const expectedMachine = key === 'linux-x64' ? 62 : 183;
  if (elf.machine !== expectedMachine) {
    invalid.push(`${file}: expected ELF machine ${expectedMachine}, got ${elf.machine}`);
  }

  const dynamic = run('readelf', ['-d', file]);
  const needed = [...dynamic.matchAll(/Shared library: \[(.+?)\]/g)].map((match) => match[1]);
  const unexpected = needed.filter((name) => !ALLOWED_LINUX_NEEDED.has(name));
  if (unexpected.length > 0) {
    invalid.push(`${file}: links unexpected Linux shared libraries ${unexpected.join(', ')}`);
  }

  const versionInfo = run('readelf', ['--version-info', file]);
  const glibcVersions = [...versionInfo.matchAll(/GLIBC_(\d+)\.(\d+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2])
  ]);
  const tooNew = glibcVersions.filter((version) => compareVersions(version, MAX_LINUX_GLIBC) > 0);
  if (tooNew.length > 0) {
    const unique = [...new Set(tooNew.map((version) => version.join('.')))].sort();
    invalid.push(`${file}: requires GLIBC newer than ${MAX_LINUX_GLIBC.join('.')}: ${unique.join(', ')}`);
  }
}

function checkMac(file, key) {
  const expectedArch = key === 'darwin-x64' ? 'x86_64' : 'arm64';
  const archs = run('lipo', ['-archs', file]).trim().split(/\s+/).filter(Boolean);
  if (archs.length !== 1 || archs[0] !== expectedArch) {
    invalid.push(`${file}: expected single Mach-O arch ${expectedArch}, got ${archs.join(', ') || 'none'}`);
  }

  const linked = run('otool', ['-L', file])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().replace(/\s+\(.+$/, ''))
    .filter(Boolean);

  const unexpected = linked.filter(
    (name) => !(name.startsWith('/usr/lib/') || name.startsWith('/System/Library/'))
  );
  if (unexpected.length > 0) {
    invalid.push(`${file}: links non-system macOS libraries ${unexpected.join(', ')}`);
  }

  const loadCommands = run('otool', ['-l', file]);
  const minVersions = [];
  for (const block of loadCommands.split(/\nLoad command \d+\n/)) {
    if (/\bcmd LC_BUILD_VERSION\b/.test(block) && /\bplatform\s+macos\b/i.test(block)) {
      const match = block.match(/\bminos\s+([0-9.]+)/i);
      if (match) {
        minVersions.push(versionParts(match[1]));
      }
    } else if (/\bcmd LC_VERSION_MIN_MACOSX\b/.test(block)) {
      const match = block.match(/\bversion\s+([0-9.]+)/i);
      if (match) {
        minVersions.push(versionParts(match[1]));
      }
    }
  }
  if (minVersions.length === 0) {
    invalid.push(`${file}: missing macOS minimum deployment target load command`);
  }
  const tooNew = minVersions.filter((version) => compareVersions(version, MAX_MACOS_MIN_VERSION) > 0);
  if (tooNew.length > 0) {
    invalid.push(
      `${file}: minimum macOS version exceeds ${MAX_MACOS_MIN_VERSION.join('.')}: ` +
        tooNew.map((version) => version.join('.')).join(', ')
    );
  }
}

function inspectBinary(file, key) {
  if (key.startsWith('win32-')) {
    checkWindows(file, key);
  } else if (key.startsWith('linux-')) {
    if (process.platform !== 'linux') {
      skipped.push(`${file}: Linux dependency inspection requires readelf on Linux.`);
      return;
    }
    checkLinux(file, key);
  } else if (key.startsWith('darwin-')) {
    if (process.platform !== 'darwin') {
      skipped.push(`${file}: macOS dependency inspection requires otool/lipo on macOS.`);
      return;
    }
    checkMac(file, key);
  }
}

for (const key of keys) {
  for (const tool of TOOL_NAMES) {
    const file = path.join(packageRoot(), 'vendor', key, executableName(tool, key));
    if (!fs.existsSync(file)) {
      missing.push(file);
      continue;
    }
    inspectBinary(file, key);
  }
}

if (missing.length > 0) {
  process.stderr.write(`Missing native binaries:\n${missing.map((file) => `  - ${file}`).join('\n')}\n`);
  process.exitCode = 1;
} else if (invalid.length > 0) {
  process.stderr.write(`Invalid native binaries:\n${invalid.map((file) => `  - ${file}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Prebuilt binary check passed for ${keys.join(', ')}.\n`);
  if (skipped.length > 0) {
    process.stdout.write(`Skipped cross-OS inspections:\n${skipped.map((line) => `  - ${line}`).join('\n')}\n`);
  }
}
