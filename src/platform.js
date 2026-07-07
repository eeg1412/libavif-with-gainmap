'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TOOL_GAINMAP_UTIL = 'avifgainmaputil'
const TOOL_GAINMAP_RESIZE = 'avifgainmapresize'
const TOOL_GAINMAP_PROBE = 'avifgainmapprobe'
const TOOL_NAMES = Object.freeze([
  TOOL_GAINMAP_UTIL,
  TOOL_GAINMAP_RESIZE,
  TOOL_GAINMAP_PROBE
])

const SUPPORTED_PLATFORM_KEYS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64'
])

function packageRoot() {
  return path.resolve(__dirname, '..')
}

function getPlatformKey({
  platform = process.platform,
  arch = process.arch
} = {}) {
  const key = `${platform}-${arch}`
  if (!SUPPORTED_PLATFORM_KEYS.includes(key)) {
    throw new Error(
      `Unsupported platform ${key}. Supported platforms: ${SUPPORTED_PLATFORM_KEYS.join(', ')}`
    )
  }
  return key
}

function executableName(tool, platformKey = getPlatformKey()) {
  if (!TOOL_NAMES.includes(tool)) {
    throw new Error(`Unknown native tool "${tool}".`)
  }
  return platformKey.startsWith('win32-') ? `${tool}.exe` : tool
}

function vendorDir(platformKey = getPlatformKey()) {
  return path.join(packageRoot(), 'vendor', platformKey)
}

function resolveTool(tool, options = {}) {
  if (!TOOL_NAMES.includes(tool)) {
    throw new Error(`Unknown native tool "${tool}".`)
  }

  const platformKey = options.platformKey || getPlatformKey()
  const toolPaths = options.toolPaths || {}
  if (toolPaths[tool]) {
    return path.resolve(toolPaths[tool])
  }

  const envNames = {
    [TOOL_GAINMAP_PROBE]: 'AVIF_GAINMAPPROBE_PATH',
    [TOOL_GAINMAP_RESIZE]: 'AVIF_GAINMAPRESIZE_PATH',
    [TOOL_GAINMAP_UTIL]: 'AVIF_GAINMAPUTIL_PATH'
  }
  const envName = envNames[tool]
  if (process.env[envName]) {
    return path.resolve(process.env[envName])
  }

  const binDir = options.binDir || process.env.AVIF_GAINMAP_BIN_DIR
  if (binDir) {
    return path.resolve(binDir, executableName(tool, platformKey))
  }

  return path.join(vendorDir(platformKey), executableName(tool, platformKey))
}

function ensureExecutable(toolPath) {
  // Windows does not use the POSIX execute bit; spawn resolves via file extension.
  if (process.platform === 'win32') {
    return
  }

  // If the binary is already executable, there is nothing to do.
  try {
    fs.accessSync(toolPath, fs.constants.X_OK)
    return
  } catch {
    // Fall through to attempt granting execute permission below.
  }

  // npm/git packaging can strip the executable bit from vendored binaries,
  // which makes spawn fail with EACCES on Linux/macOS. Restore it here.
  try {
    const mode = fs.statSync(toolPath).mode
    fs.chmodSync(toolPath, mode | 0o111)
  } catch (cause) {
    throw new Error(
      `${toolPath} is not executable and its permissions could not be updated (${cause.message}). ` +
        'Run "chmod +x" on the vendored binary or reinstall the package.'
    )
  }
}

function assertToolAvailable(toolPath, tool) {
  if (!fs.existsSync(toolPath)) {
    throw new Error(
      `${tool} binary was not found at ${toolPath}. ` +
        'Run the GitHub Actions release workflow, npm run build:libavif, or set AVIF_GAINMAP_BIN_DIR.'
    )
  }
  ensureExecutable(toolPath)
  return toolPath
}

module.exports = {
  SUPPORTED_PLATFORM_KEYS,
  TOOL_GAINMAP_PROBE,
  TOOL_GAINMAP_RESIZE,
  TOOL_GAINMAP_UTIL,
  TOOL_NAMES,
  assertToolAvailable,
  ensureExecutable,
  executableName,
  getPlatformKey,
  packageRoot,
  resolveTool,
  vendorDir
}
