'use strict'

// One-shot version bump: updates the main package version AND keeps every
// platform package reference in optionalDependencies in sync, so the JS wrapper
// and the native binary packages always publish at the exact same version.
//
// Usage:
//   npm run set-version -- 0.1.14      # set an explicit version
//   npm run set-version -- patch       # bump patch (default when omitted)
//   npm run set-version -- minor
//   npm run set-version -- major

const fs = require('node:fs')
const path = require('node:path')

const manifestPath = path.join(__dirname, '..', 'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const BUMP_KEYWORDS = new Set(['major', 'minor', 'patch'])

function bump(current, keyword) {
  const match = SEMVER.exec(current)
  if (!match) {
    throw new Error(
      `Current version "${current}" is not a plain x.y.z version; pass an explicit version instead.`
    )
  }
  let [major, minor, patch] = match.slice(1).map(Number)
  if (keyword === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (keyword === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

function resolveTargetVersion(input, currentVersion) {
  if (!input || BUMP_KEYWORDS.has(input)) {
    return bump(currentVersion, input || 'patch')
  }
  if (!SEMVER.test(input)) {
    throw new Error(
      `Invalid version "${input}". Use x.y.z or one of: major, minor, patch.`
    )
  }
  return input
}

const requested = process.argv[2]
const nextVersion = resolveTargetVersion(requested, manifest.version)

manifest.version = nextVersion
if (manifest.optionalDependencies) {
  for (const name of Object.keys(manifest.optionalDependencies)) {
    manifest.optionalDependencies[name] = nextVersion
  }
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

process.stdout.write(`Set libavif-with-gainmap to version ${nextVersion}.\n`)
if (manifest.optionalDependencies) {
  process.stdout.write('Synced optionalDependencies:\n')
  for (const [name, version] of Object.entries(manifest.optionalDependencies)) {
    process.stdout.write(`  ${name}@${version}\n`)
  }
}
