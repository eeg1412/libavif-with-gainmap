'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TOOL_GAINMAP_UTIL = 'avifgainmaputil';
const TOOL_GAINMAP_RESIZE = 'avifgainmapresize';
const TOOL_GAINMAP_PROBE = 'avifgainmapprobe';
const TOOL_NAMES = Object.freeze([TOOL_GAINMAP_UTIL, TOOL_GAINMAP_RESIZE, TOOL_GAINMAP_PROBE]);

const SUPPORTED_PLATFORM_KEYS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64'
]);

function packageRoot() {
  return path.resolve(__dirname, '..');
}

function getPlatformKey({ platform = process.platform, arch = process.arch } = {}) {
  const key = `${platform}-${arch}`;
  if (!SUPPORTED_PLATFORM_KEYS.includes(key)) {
    throw new Error(
      `Unsupported platform ${key}. Supported platforms: ${SUPPORTED_PLATFORM_KEYS.join(', ')}`
    );
  }
  return key;
}

function executableName(tool, platformKey = getPlatformKey()) {
  if (!TOOL_NAMES.includes(tool)) {
    throw new Error(`Unknown native tool "${tool}".`);
  }
  return platformKey.startsWith('win32-') ? `${tool}.exe` : tool;
}

function vendorDir(platformKey = getPlatformKey()) {
  return path.join(packageRoot(), 'vendor', platformKey);
}

function resolveTool(tool, options = {}) {
  if (!TOOL_NAMES.includes(tool)) {
    throw new Error(`Unknown native tool "${tool}".`);
  }

  const platformKey = options.platformKey || getPlatformKey();
  const toolPaths = options.toolPaths || {};
  if (toolPaths[tool]) {
    return path.resolve(toolPaths[tool]);
  }

  const envNames = {
    [TOOL_GAINMAP_PROBE]: 'AVIF_GAINMAPPROBE_PATH',
    [TOOL_GAINMAP_RESIZE]: 'AVIF_GAINMAPRESIZE_PATH',
    [TOOL_GAINMAP_UTIL]: 'AVIF_GAINMAPUTIL_PATH'
  };
  const envName = envNames[tool];
  if (process.env[envName]) {
    return path.resolve(process.env[envName]);
  }

  const binDir = options.binDir || process.env.AVIF_GAINMAP_BIN_DIR;
  if (binDir) {
    return path.resolve(binDir, executableName(tool, platformKey));
  }

  return path.join(vendorDir(platformKey), executableName(tool, platformKey));
}

function assertToolAvailable(toolPath, tool) {
  if (!fs.existsSync(toolPath)) {
    throw new Error(
      `${tool} binary was not found at ${toolPath}. ` +
        'Run the GitHub Actions release workflow, npm run build:libavif, or set AVIF_GAINMAP_BIN_DIR.'
    );
  }
  return toolPath;
}

module.exports = {
  SUPPORTED_PLATFORM_KEYS,
  TOOL_GAINMAP_PROBE,
  TOOL_GAINMAP_RESIZE,
  TOOL_GAINMAP_UTIL,
  TOOL_NAMES,
  assertToolAvailable,
  executableName,
  getPlatformKey,
  packageRoot,
  resolveTool,
  vendorDir
};
