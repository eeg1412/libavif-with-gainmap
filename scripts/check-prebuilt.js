'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

for (const key of keys) {
  for (const tool of TOOL_NAMES) {
    const file = path.join(packageRoot(), 'vendor', key, executableName(tool, key));
    if (!fs.existsSync(file)) {
      missing.push(file);
    }
  }
}

if (missing.length > 0) {
  process.stderr.write(`Missing native binaries:\n${missing.map((file) => `  - ${file}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Prebuilt binary check passed for ${keys.join(', ')}.\n`);
}
