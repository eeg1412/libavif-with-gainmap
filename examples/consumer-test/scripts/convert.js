#!/usr/bin/env node
'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')

const { convertJpegGainMap, probeJpegGainMap } = require('libavif-with-gainmap')

const projectRoot = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const options = {
    gainMapQuality: 65,
    input: path.join(projectRoot, 'images', 'input.jpg'),
    jobs: 'all',
    maxHeight: 1920,
    maxWidth: 1920,
    mode: 'both',
    outputDir: path.join(projectRoot, 'outputs'),
    quality: 80,
    yuv: '420'
  }

  function readValue(index, flag) {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value.`)
    }
    return value
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]

    switch (flag) {
      case '--input':
        options.input = path.resolve(projectRoot, readValue(i, flag))
        i += 1
        break
      case '--output-dir':
        options.outputDir = path.resolve(projectRoot, readValue(i, flag))
        i += 1
        break
      case '--mode':
        options.mode = readValue(i, flag)
        i += 1
        break
      case '--quality':
        options.quality = Number(readValue(i, flag))
        i += 1
        break
      case '--gain-map-quality':
        options.gainMapQuality = Number(readValue(i, flag))
        i += 1
        break
      case '--max-width':
        options.maxWidth = Number(readValue(i, flag))
        i += 1
        break
      case '--max-height':
        options.maxHeight = Number(readValue(i, flag))
        i += 1
        break
      case '--jobs':
        options.jobs = readValue(i, flag)
        i += 1
        break
      case '--yuv':
        options.yuv = readValue(i, flag)
        i += 1
        break
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }

  if (!['api', 'cli', 'both'].includes(options.mode)) {
    throw new Error('--mode must be api, cli, or both.')
  }
  return options
}

function cliBin() {
  return path.join(
    projectRoot,
    'node_modules',
    'libavif-with-gainmap',
    'bin',
    'avif-gainmap.js'
  )
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin(), ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(`CLI conversion failed with code ${code}, signal ${signal}.`)
      )
    })
  })
}

async function assertReadableInput(input) {
  try {
    const stat = await fs.stat(input)
    if (!stat.isFile()) {
      throw new Error(`${input} is not a file.`)
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Input image not found: ${input}\n` +
          'Put a JPEG gain map image at examples/consumer-test/images/input.jpg, or pass --input <path>.'
      )
    }
    throw error
  }
}

async function assertAvifOutput(output) {
  const stat = await fs.stat(output)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Output is missing or empty: ${output}`)
  }

  const handle = await fs.open(output, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(64, stat.size))
    await handle.read(buffer, 0, buffer.length, 0)
    const header = buffer.toString('latin1')
    const hasFileTypeBox = header.includes('ftyp')
    const hasAvifBrand =
      header.includes('avif') ||
      header.includes('avis') ||
      header.includes('mif1')
    if (!hasFileTypeBox || !hasAvifBrand) {
      throw new Error(`Output does not look like an AVIF file: ${output}`)
    }
  } finally {
    await handle.close()
  }
}

async function assertJpegGainMap(options) {
  const probe = await probeJpegGainMap(options.input, { jobs: options.jobs })
  if (!probe.hasGainMap) {
    throw new Error(`Input JPEG does not contain a gain map: ${options.input}`)
  }
  process.stdout.write(
    `Input gain map detected: ${probe.width}x${probe.height}, ` +
      `gain map ${probe.gainMap.width}x${probe.gainMap.height}\n`
  )
}

async function convertWithApi(options, output) {
  await convertJpegGainMap(options.input, output, {
    gainMapQuality: options.gainMapQuality,
    jobs: options.jobs,
    maxHeight: options.maxHeight,
    maxWidth: options.maxWidth,
    quality: options.quality,
    verbose: true,
    yuv: options.yuv
  })
}

async function convertWithCli(options, output) {
  await runCli([
    'convert',
    options.input,
    output,
    '--quality',
    String(options.quality),
    '--gain-map-quality',
    String(options.gainMapQuality),
    '--max-width',
    String(options.maxWidth),
    '--max-height',
    String(options.maxHeight),
    '--jobs',
    String(options.jobs),
    '--yuv',
    String(options.yuv),
    '--verbose'
  ])
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await assertReadableInput(options.input)
  await assertJpegGainMap(options)
  await fs.mkdir(options.outputDir, { recursive: true })

  const runId = `${Date.now()}-${process.pid}`
  const outputs = []
  if (options.mode === 'api' || options.mode === 'both') {
    const output = path.join(options.outputDir, `api-output-${runId}.avif`)
    await convertWithApi(options, output)
    await assertAvifOutput(output)
    outputs.push(output)
  }

  if (options.mode === 'cli' || options.mode === 'both') {
    const output = path.join(options.outputDir, `cli-output-${runId}.avif`)
    await convertWithCli(options, output)
    await assertAvifOutput(output)
    outputs.push(output)
  }

  process.stdout.write(
    `Conversion test passed:\n${outputs.map(file => `  - ${file}`).join('\n')}\n`
  )
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
