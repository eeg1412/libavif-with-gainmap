'use strict'

// Generates the per-platform npm packages (libavif-with-gainmap-<platformKey>)
// from the built vendor/<platformKey> directories. Each generated package only
// ships the native binaries for a single os/cpu, and is referenced by the main
// package through optionalDependencies. npm then installs only the binary that
// matches the current platform instead of every platform's build.

const fs = require('node:fs')
const path = require('node:path')

const {
  SUPPORTED_PLATFORM_KEYS,
  packageRoot,
  platformPackageName
} = require('../src/platform')

const PLATFORM_METADATA = Object.freeze({
  'darwin-arm64': { os: ['darwin'], cpu: ['arm64'] },
  'darwin-x64': { os: ['darwin'], cpu: ['x64'] },
  'linux-arm64': { os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
  'linux-x64': { os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'win32-x64': { os: ['win32'], cpu: ['x64'] }
})

const root = packageRoot()
const outputRoot = path.join(root, 'platform-packages')

function readMainManifest() {
  const manifestPath = path.join(root, 'package.json')
  return {
    manifestPath,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  }
}

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      copyDir(from, to)
    } else {
      fs.copyFileSync(from, to)
    }
  }
}

function generatePlatformPackage(platformKey, mainManifest) {
  const metadata = PLATFORM_METADATA[platformKey]
  if (!metadata) {
    throw new Error(
      `No os/cpu metadata configured for platform "${platformKey}".`
    )
  }

  const packageName = platformPackageName(platformKey)
  const packageDir = path.join(outputRoot, packageName)
  const vendorSource = path.join(root, 'vendor', platformKey)

  fs.rmSync(packageDir, { force: true, recursive: true })
  fs.mkdirSync(packageDir, { recursive: true })

  copyDir(vendorSource, path.join(packageDir, 'vendor', platformKey))

  const manifest = {
    name: packageName,
    version: mainManifest.version,
    description: `Prebuilt libavif gain map binaries for ${platformKey}. Installed automatically by libavif-with-gainmap.`,
    license: mainManifest.license,
    repository: mainManifest.repository,
    bugs: mainManifest.bugs,
    homepage: mainManifest.homepage,
    publishConfig: mainManifest.publishConfig,
    os: metadata.os,
    cpu: metadata.cpu,
    ...(metadata.libc ? { libc: metadata.libc } : {}),
    files: ['vendor']
  }

  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  )

  const licenseSource = path.join(root, 'LICENSE')
  if (fs.existsSync(licenseSource)) {
    fs.copyFileSync(licenseSource, path.join(packageDir, 'LICENSE'))
  }

  fs.writeFileSync(
    path.join(packageDir, 'README.md'),
    `# ${packageName}\n\n` +
      `Prebuilt \`libavif\` gain map binaries for \`${platformKey}\`.\n\n` +
      'This is a platform-specific optional dependency of ' +
      '[`libavif-with-gainmap`](https://www.npmjs.com/package/libavif-with-gainmap). ' +
      'Install the main package instead; npm resolves this binary automatically.\n'
  )

  return packageDir
}

function syncMainOptionalDependencies(mainManifest, manifestPath) {
  const optionalDependencies = { ...(mainManifest.optionalDependencies || {}) }
  for (const platformKey of SUPPORTED_PLATFORM_KEYS) {
    optionalDependencies[platformPackageName(platformKey)] =
      mainManifest.version
  }
  mainManifest.optionalDependencies = optionalDependencies
  fs.writeFileSync(manifestPath, `${JSON.stringify(mainManifest, null, 2)}\n`)
}

function main() {
  const requireAll = process.argv.includes('--require-all')
  const { manifest: mainManifest, manifestPath } = readMainManifest()

  fs.mkdirSync(outputRoot, { recursive: true })

  const generated = []
  const missing = []
  for (const platformKey of SUPPORTED_PLATFORM_KEYS) {
    const vendorSource = path.join(root, 'vendor', platformKey)
    if (
      !fs.existsSync(vendorSource) ||
      fs.readdirSync(vendorSource).length === 0
    ) {
      missing.push(platformKey)
      continue
    }
    generated.push(generatePlatformPackage(platformKey, mainManifest))
  }

  if (requireAll && missing.length > 0) {
    throw new Error(
      `Missing vendor binaries for: ${missing.join(', ')}. ` +
        'Build every platform before packing a release.'
    )
  }

  syncMainOptionalDependencies(mainManifest, manifestPath)

  process.stdout.write(
    `Generated ${generated.length} platform package(s) under ${path.relative(root, outputRoot)}:\n`
  )
  for (const dir of generated) {
    process.stdout.write(`  ${path.relative(root, dir)}\n`)
  }
  if (missing.length > 0) {
    process.stdout.write(
      `Skipped (no vendor binaries): ${missing.join(', ')}\n`
    )
  }
}

main()
